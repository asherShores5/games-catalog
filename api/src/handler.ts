import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { AppSyncIdentityCognito, AppSyncResolverEvent } from "aws-lambda";
import {
  SEED_PLATFORMS, STEAM_PLATFORM, accountLabel, afterCopyAdded, byAccountLabel, byName, canWishlist, isOwned, isUnknownCopy,
  samePlatformName, type Account, type Copy, type Format, type Game, type Platform, type PlayStatus,
  type SteamImportSummary, type Store,
} from "@games/shared";
import {
  UserError, validateAccountNickname, validateEdition, validateFormat, validateGameName, validatePlatformName,
  validateCopyAccount, validatePlayStatus, validateSteamId, validateStore,
} from "./rules";
import { SteamError, type SteamLibrary } from "./steam";
import { planSteamImport, type ImportStep } from "./steamImport";
import { secretsManagerKey, steamWebApi } from "./steamWebApi";
import { parseSeedRows, seedKey, seedState } from "./seed";

const TABLE = process.env.TABLE_NAME!;

type DocClient = Pick<DynamoDBDocumentClient, "send">;

let ddb: DocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/** Test seam: swap the document client (see src/testing/harness.ts). Production never calls this. */
export function setDocClient(client: DocClient) {
  ddb = client;
}

// The real Steam client is built on first Import, so other resolvers never touch Secrets Manager.
// The key's secret NAME comes from the environment; the key itself only ever lives in memory.
let steamLibrary: SteamLibrary | undefined;

/** Test seam: swap the Steam client (see src/testing/fakeSteam.ts). Production never calls this. */
export function setSteamLibrary(library: SteamLibrary) {
  steamLibrary = library;
}

function steam(): SteamLibrary {
  steamLibrary ??= steamWebApi({ getKey: secretsManagerKey(process.env.STEAM_KEY_SECRET_NAME) });
  return steamLibrary;
}

/** The signed-in caller. Every record key is derived from `userId`, never from arguments. */
interface Ctx {
  userId: string;
}

const ownerPk = (ctx: Ctx) => `OWNER#${ctx.userId}`;

async function queryPrefix(ctx: Ctx, prefix: string) {
  const out: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
        ExpressionAttributeValues: { ":pk": ownerPk(ctx), ":p": prefix },
        ExclusiveStartKey,
      }),
    );
    out.push(...(r.Items ?? []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

type Rec = Record<string, unknown>;

// ---- Games and Copies --------------------------------------------------------
//
// A Game is `SK = GAME#<id>` and each of its Copies is `SK = GAME#<id>#COPY#<copyId>`, so one
// begins_with("GAME#") query loads every Game with its Copies. The Game record stores its own
// fields (name, wishlist, playStatus); Owned is never stored, it is derived from the Copies.
//
// Every write that depends on a Game's Copies (addCopy, removeCopy, setWishlist) rewrites the
// Game record conditioned on the `updatedAt` it read, so two racing writes can't both win
// (e.g. Wishlist set on a Game while a Copy is being added). `updatedAt` always moves forward.

const gameSk = (id: string) => `GAME#${id}`;
const copyPrefix = (gameId: string) => `GAME#${gameId}#COPY#`;
const isCopyRec = (rec: Rec) => String(rec.SK).includes("#COPY#");

/** The Game record fields we store. Ticket 01 records lack wishlist/playStatus; they default here. */
interface GameRec {
  id: string;
  name: string;
  wishlist: boolean;
  playStatus: PlayStatus | null;
  /** Set when a Steam Import created or matched this Game. */
  steamAppId?: number;
  createdAt: number;
  updatedAt: number;
}

function gameRec(rec: Rec): GameRec {
  return {
    id: rec.id as string,
    name: rec.name as string,
    wishlist: rec.wishlist === true,
    playStatus: (rec.playStatus as PlayStatus | undefined) ?? null,
    steamAppId: rec.steamAppId as number | undefined,
    createdAt: rec.createdAt as number,
    updatedAt: rec.updatedAt as number,
  };
}

function copyOut(rec: Rec): Copy {
  return {
    id: rec.id as string,
    // Both absent on an Unknown Copy (from the Seed) until it is filled in.
    platformId: rec.platformId as string | undefined,
    format: rec.format as Format | undefined,
    // Absent on Physical Copies, and on Digital Copies saved before Accounts existed.
    accountId: rec.accountId as string | undefined,
    edition: rec.edition as string | undefined,
    createdAt: rec.createdAt as number,
  };
}

/** The Put for a brand-new Copy record of `gameId` (the Seed's Unknown Copies; writeCopy builds the same Put). */
function putNewCopy(ctx: Ctx, gameId: string, copy: Copy) {
  return {
    Put: {
      TableName: TABLE,
      Item: { PK: ownerPk(ctx), SK: copyPrefix(gameId) + copy.id, gameId, ...copy },
      ConditionExpression: "attribute_not_exists(PK)",
    },
  };
}

/** A Copy whose Platform and Format are known (anything but an Unknown Copy). */
type KnownCopy = Copy & { platformId: string; format: Format };

const oldestFirst = (a: Copy, b: Copy) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);

function gameOut(game: GameRec, copies: Copy[]): Game {
  const sorted = [...copies].sort(oldestFirst);
  return { ...game, copies: sorted, owned: isOwned(sorted) };
}

/** Next `updatedAt`: now, but always later than the last write (it doubles as a version). */
const nextUpdatedAt = (game: GameRec) => Math.max(Date.now(), game.updatedAt + 1);

/** Write the Game record only if nobody changed it since we read it. */
function putGameIfUnchanged(ctx: Ctx, read: GameRec, next: GameRec) {
  return {
    Put: {
      TableName: TABLE,
      Item: { PK: ownerPk(ctx), SK: gameSk(next.id), ...next, playStatus: next.playStatus ?? undefined },
      ConditionExpression: "updatedAt = :read",
      ExpressionAttributeValues: { ":read": read.updatedAt },
    },
  };
}

const changedMeanwhile = () => new UserError("Conflict", "The Game changed while saving; reload and try again");

async function loadGame(ctx: Ctx, id: unknown): Promise<{ game: GameRec; copies: Copy[] }> {
  if (typeof id !== "string" || id.includes("#")) throw new UserError("NotFound", "No such Game");
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: ownerPk(ctx), SK: gameSk(id) } }));
  if (!r.Item) throw new UserError("NotFound", "No such Game");
  return { game: gameRec(r.Item), copies: (await queryPrefix(ctx, copyPrefix(id))).map(copyOut) };
}

/** Every Game with its Copies, in name order. */
async function allGames(ctx: Ctx): Promise<Game[]> {
  const recs = await queryPrefix(ctx, "GAME#");
  const copies = new Map<string, Copy[]>();
  for (const rec of recs.filter(isCopyRec)) {
    const list = copies.get(rec.gameId as string) ?? [];
    list.push(copyOut(rec));
    copies.set(rec.gameId as string, list);
  }
  return recs
    .filter((r) => !isCopyRec(r))
    .map((r) => gameOut(gameRec(r), copies.get(r.id as string) ?? []))
    .sort(byName);
}

function cancellationCodes(e: unknown): string[] | undefined {
  if ((e as Error).name !== "TransactionCanceledException") return undefined;
  return ((e as { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? []).map((r) => r.Code ?? "None");
}

// ---- resolvers ---------------------------------------------------------------

async function games(ctx: Ctx) {
  return allGames(ctx);
}

async function addGame(ctx: Ctx, args: { name: string }) {
  const name = validateGameName(args.name);
  const now = Date.now();
  const game: GameRec = { id: randomUUID(), name, wishlist: false, playStatus: null, createdAt: now, updatedAt: now };
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: { PK: ownerPk(ctx), SK: gameSk(game.id), ...game, playStatus: undefined },
      ConditionExpression: "attribute_not_exists(PK)",
    }),
  );
  return gameOut(game, []);
}

async function addCopy(
  ctx: Ctx,
  args: { gameId: string; platformId: string; format: string; accountId?: string | null; edition?: string | null },
) {
  const format = validateFormat(args.format);
  const accountId = validateCopyAccount(format, args.accountId);
  const edition = validateEdition(args.edition);
  const { game, copies } = await loadGame(ctx, args.gameId);
  const platform = await getPlatform(ctx, args.platformId);
  const account = accountId === undefined ? undefined : await getAccount(ctx, accountId);

  const copy: KnownCopy = { id: randomUUID(), platformId: platform.id, format, accountId: account?.id, edition, createdAt: Date.now() };
  const next: GameRec = { ...game, ...afterCopyAdded(game), updatedAt: nextUpdatedAt(game) };
  await writeCopy(ctx, { read: game, next, copy });
  return gameOut(next, [...copies, copy]);
}

/**
 * Write a Copy and its Game in one transaction: the Game record is rewritten only if unchanged
 * since `read` (or created, when there's no `read`), and the Copy's Platform and Account must
 * still exist, since a delete may be racing us. Validation is the caller's job (rules.ts).
 * `copyExtra` holds stored-only Copy fields (an Import's `steamAppId`). `fill` overwrites an
 * existing Copy (an Unknown Copy being filled in) instead of adding one.
 */
async function writeCopy(
  ctx: Ctx,
  w: { read?: GameRec; next: GameRec; copy: KnownCopy; copyExtra?: Rec; fill?: boolean },
) {
  const { read, next, copy } = w;
  const mustExist = (SK: string) => ({
    ConditionCheck: { TableName: TABLE, Key: { PK: ownerPk(ctx), SK }, ConditionExpression: "attribute_exists(PK)" },
  });
  const gameWrite = read
    ? putGameIfUnchanged(ctx, read, next)
    : {
        Put: {
          TableName: TABLE,
          Item: { PK: ownerPk(ctx), SK: gameSk(next.id), ...next, playStatus: next.playStatus ?? undefined },
          ConditionExpression: "attribute_not_exists(PK)",
        },
      };
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          gameWrite,
          {
            Put: {
              TableName: TABLE,
              Item: { PK: ownerPk(ctx), SK: copyPrefix(next.id) + copy.id, gameId: next.id, ...w.copyExtra, ...copy },
              ConditionExpression: w.fill ? "attribute_exists(PK)" : "attribute_not_exists(PK)",
            },
          },
          mustExist(platformSk(copy.platformId)),
          ...(copy.accountId ? [mustExist(accountSk(copy.accountId))] : []),
        ],
      }),
    );
  } catch (e) {
    const codes = cancellationCodes(e);
    if (codes?.[2] === "ConditionalCheckFailed") throw new UserError("NotFound", "No such Platform");
    if (codes?.[3] === "ConditionalCheckFailed") throw new UserError("NotFound", "No such Account");
    if (codes) throw changedMeanwhile();
    throw e;
  }
}

/**
 * Give an Unknown Copy its Platform and Format (and Account if Digital), keeping its id. The same
 * rules as addCopy (validateCopyAccount, Platform/Account must exist, at index 2/3 of the
 * transaction); Owned, Wishlist and Play status don't change since it was already a Copy.
 */
async function fillUnknownCopy(
  ctx: Ctx,
  args: { gameId: string; copyId: string; platformId: string; format: string; accountId?: string | null; edition?: string | null },
) {
  const format = validateFormat(args.format);
  const accountId = validateCopyAccount(format, args.accountId);
  const edition = validateEdition(args.edition);
  const { game, copies } = await loadGame(ctx, args.gameId);
  const unknown = copies.find((c) => c.id === args.copyId);
  if (!unknown) throw new UserError("NotFound", "No such Copy on this Game");
  if (!isUnknownCopy(unknown)) {
    throw new UserError("ValidationError", "That Copy's location is already known; remove it and add a new Copy instead");
  }
  const platform = await getPlatform(ctx, args.platformId);
  const account = accountId === undefined ? undefined : await getAccount(ctx, accountId);

  const copy: KnownCopy = { ...unknown, platformId: platform.id, format, accountId: account?.id, edition: edition ?? unknown.edition };
  const next: GameRec = { ...game, updatedAt: nextUpdatedAt(game) };
  await writeCopy(ctx, { read: game, next, copy, fill: true });
  return gameOut(next, copies.map((c) => (c.id === copy.id ? copy : c)));
}

async function removeCopy(ctx: Ctx, args: { gameId: string; copyId: string }) {
  const { game, copies } = await loadGame(ctx, args.gameId);
  const copy = copies.find((c) => c.id === args.copyId);
  if (!copy) throw new UserError("NotFound", "No such Copy on this Game");

  const next: GameRec = { ...game, updatedAt: nextUpdatedAt(game) };
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          putGameIfUnchanged(ctx, game, next),
          { Delete: { TableName: TABLE, Key: { PK: ownerPk(ctx), SK: copyPrefix(game.id) + copy.id } } },
        ],
      }),
    );
  } catch (e) {
    if (cancellationCodes(e)) throw changedMeanwhile();
    throw e;
  }
  return gameOut(next, copies.filter((c) => c.id !== copy.id));
}

async function setPlayStatus(ctx: Ctx, args: { gameId: string; playStatus?: string | null }) {
  const playStatus = validatePlayStatus(args.playStatus);
  const { game, copies } = await loadGame(ctx, args.gameId);
  const next: GameRec = { ...game, playStatus, updatedAt: nextUpdatedAt(game) };
  await saveGame(ctx, game, next);
  return gameOut(next, copies);
}

async function setWishlist(ctx: Ctx, args: { gameId: string; wishlist: boolean }) {
  if (typeof args.wishlist !== "boolean") throw new UserError("ValidationError", "wishlist must be true or false");
  const { game, copies } = await loadGame(ctx, args.gameId);
  if (args.wishlist && !canWishlist(copies)) {
    throw new UserError("ValidationError", "An Owned Game can't be on the Wishlist; remove its Copies first");
  }
  const next: GameRec = { ...game, wishlist: args.wishlist, updatedAt: nextUpdatedAt(game) };
  await saveGame(ctx, game, next);
  return gameOut(next, copies);
}

/** Single-record Game write with the same "unchanged since read" guard as the transactions. */
async function saveGame(ctx: Ctx, read: GameRec, next: GameRec) {
  try {
    await ddb.send(new PutCommand(putGameIfUnchanged(ctx, read, next).Put));
  } catch (e) {
    if ((e as Error).name === "ConditionalCheckFailedException") throw changedMeanwhile();
    throw e;
  }
}

// ---- Platforms ---------------------------------------------------------------

const platformSk = (id: string) => `PLATFORM#${id}`;
const PLATFORMS_SEEDED_SK = "META#platformsSeeded";

/**
 * Seed SEED_PLATFORMS the first time any Platform call runs. A marker record (not "no Platforms
 * yet") records that it happened, so deleting every Platform doesn't bring the seeds back.
 */
async function ensurePlatforms(ctx: Ctx) {
  const marker = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: ownerPk(ctx), SK: PLATFORMS_SEEDED_SK } }));
  if (marker.Item) return;
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: TABLE, Item: { PK: ownerPk(ctx), SK: PLATFORMS_SEEDED_SK, at: Date.now() }, ConditionExpression: "attribute_not_exists(PK)" } },
          ...SEED_PLATFORMS.map((name) => {
            const id = randomUUID();
            return { Put: { TableName: TABLE, Item: { PK: ownerPk(ctx), SK: platformSk(id), id, name } } };
          }),
        ],
      }),
    );
  } catch (e) {
    // A concurrent first call seeded already; its write wins.
    if ((e as Error).name !== "TransactionCanceledException") throw e;
  }
}

function platformOut(rec: Record<string, unknown>): Platform {
  return { id: rec.id as string, name: rec.name as string };
}

async function allPlatforms(ctx: Ctx) {
  await ensurePlatforms(ctx);
  return (await queryPrefix(ctx, "PLATFORM#")).map(platformOut).sort(byName);
}

async function platforms(ctx: Ctx) {
  return allPlatforms(ctx);
}

async function getPlatform(ctx: Ctx, id: unknown): Promise<Platform> {
  if (typeof id !== "string") throw new UserError("NotFound", "No such Platform");
  await ensurePlatforms(ctx);
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: ownerPk(ctx), SK: platformSk(id) } }));
  if (!r.Item) throw new UserError("NotFound", "No such Platform");
  return platformOut(r.Item);
}

async function addPlatform(ctx: Ctx, args: { name: string }) {
  const name = validatePlatformName(args.name, await allPlatforms(ctx));
  const platform: Platform = { id: randomUUID(), name };
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: { PK: ownerPk(ctx), SK: platformSk(platform.id), ...platform },
      ConditionExpression: "attribute_not_exists(PK)",
    }),
  );
  return platform;
}

async function renamePlatform(ctx: Ctx, args: { id: string; name: string }) {
  const platform = await getPlatform(ctx, args.id);
  const name = validatePlatformName(args.name, await allPlatforms(ctx), platform.id);
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: ownerPk(ctx), SK: platformSk(platform.id) },
      UpdateExpression: "SET #n = :n",
      ConditionExpression: "attribute_exists(PK)",
      ExpressionAttributeNames: { "#n": "name" },
      ExpressionAttributeValues: { ":n": name },
    }),
  );
  return { ...platform, name };
}

async function deletePlatform(ctx: Ctx, args: { id: string }) {
  const platform = await getPlatform(ctx, args.id);
  // Scans the owner's Games: fine at one person's catalog size. addCopy conditions on the
  // Platform still existing, so a Copy can't land on a Platform deleted after this check.
  const inUse = (await queryPrefix(ctx, "GAME#")).filter((r) => isCopyRec(r) && r.platformId === platform.id).length;
  if (inUse > 0) {
    throw new UserError(
      "Conflict",
      `Platform "${platform.name}" is used by ${inUse} ${inUse === 1 ? "Copy" : "Copies"}; move or remove them first`,
    );
  }
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: ownerPk(ctx), SK: platformSk(platform.id) } }));
  return platform.id;
}

// ---- Accounts ----------------------------------------------------------------
//
// `SK = ACCOUNT#<id>`. Copies point at an Account by id, so renaming it never touches a Copy.
// The Store is fixed at creation (Imports and a Steam ID depend on it); only the nickname renames.
// Store-specific fields go on this same record; accountOut picks the public fields, so a private
// field doesn't leak by accident. A Steam Account's `steamId` is one: only `hasSteamId` goes out.

const accountSk = (id: string) => `ACCOUNT#${id}`;

function accountOut(rec: Rec): Account {
  return { id: rec.id as string, store: rec.store as Store, nickname: rec.nickname as string, hasSteamId: typeof rec.steamId === "string" };
}

async function allAccounts(ctx: Ctx) {
  return (await queryPrefix(ctx, "ACCOUNT#")).map(accountOut).sort(byAccountLabel);
}

async function accounts(ctx: Ctx) {
  return allAccounts(ctx);
}

/** The stored Account record, private fields included. Never return it to a client as is. */
async function getAccountRec(ctx: Ctx, id: unknown): Promise<Rec> {
  if (typeof id !== "string") throw new UserError("NotFound", "No such Account");
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: ownerPk(ctx), SK: accountSk(id) } }));
  if (!r.Item) throw new UserError("NotFound", "No such Account");
  return r.Item;
}

async function getAccount(ctx: Ctx, id: unknown): Promise<Account> {
  return accountOut(await getAccountRec(ctx, id));
}

async function addAccount(ctx: Ctx, args: { store: string; nickname: string }) {
  const store = validateStore(args.store);
  const nickname = validateAccountNickname(args.nickname, store, await allAccounts(ctx));
  const account: Account = { id: randomUUID(), store, nickname, hasSteamId: false };
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: { PK: ownerPk(ctx), SK: accountSk(account.id), id: account.id, store, nickname },
      ConditionExpression: "attribute_not_exists(PK)",
    }),
  );
  return account;
}

async function renameAccount(ctx: Ctx, args: { id: string; nickname: string }) {
  const account = await getAccount(ctx, args.id);
  const nickname = validateAccountNickname(args.nickname, account.store, await allAccounts(ctx), account.id);
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: ownerPk(ctx), SK: accountSk(account.id) },
      UpdateExpression: "SET nickname = :n",
      ConditionExpression: "attribute_exists(PK)",
      ExpressionAttributeValues: { ":n": nickname },
    }),
  );
  return { ...account, nickname };
}

async function setSteamId(ctx: Ctx, args: { accountId: string; steamId?: string | null }) {
  const account = await getAccount(ctx, args.accountId);
  const steamId = validateSteamId(account.store, args.steamId);
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: ownerPk(ctx), SK: accountSk(account.id) },
      ...(steamId === undefined
        ? { UpdateExpression: "REMOVE steamId", ConditionExpression: "attribute_exists(PK)" }
        : { UpdateExpression: "SET steamId = :s", ConditionExpression: "attribute_exists(PK)", ExpressionAttributeValues: { ":s": steamId } }),
    }),
  );
  return { ...account, hasSteamId: steamId !== undefined };
}

async function deleteAccount(ctx: Ctx, args: { id: string }) {
  const account = await getAccount(ctx, args.id);
  // Same scan as deletePlatform; addCopy conditions on the Account still existing.
  const inUse = (await queryPrefix(ctx, "GAME#")).filter((r) => isCopyRec(r) && r.accountId === account.id).length;
  if (inUse > 0) {
    throw new UserError(
      "Conflict",
      `Account "${accountLabel(account)}" is used by ${inUse} ${inUse === 1 ? "Copy" : "Copies"}; move or remove them first`,
    );
  }
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: ownerPk(ctx), SK: accountSk(account.id) } }));
  return account.id;
}

// ---- Steam Import ------------------------------------------------------------
//
// importSteam reads the Account's library through `steam()` and applies planSteamImport's
// steps. Every step is its own transaction through writeCopy (same guards as addCopy), so an
// Import that times out or hits a conflict part-way is safe to re-run: matching by Steam app ID
// makes the finished steps "already present". Imported Copies store `steamAppId`; manual Copies
// are never written by an Import.

const IMPORT_CONCURRENCY = 8;

/** The Platform Steam Copies land on: the owner's "PC", re-created if they deleted it. */
async function steamPlatform(ctx: Ctx): Promise<Platform> {
  const pc = (await allPlatforms(ctx)).find((p) => samePlatformName(p.name, STEAM_PLATFORM));
  return pc ?? addPlatform(ctx, { name: STEAM_PLATFORM });
}

function steamUserError(e: SteamError): UserError {
  return new UserError("SteamError", e.message);
}

const gameRecOf = (g: Game): GameRec => ({
  id: g.id, name: g.name, wishlist: g.wishlist, playStatus: g.playStatus, steamAppId: g.steamAppId, createdAt: g.createdAt, updatedAt: g.updatedAt,
});

type StepOutcome = "added" | "present";

/** Apply one plan step. Returns what it did and the Game it concerns. */
async function applyStep(
  ctx: Ctx,
  step: ImportStep,
  env: { games: Map<string, Game>; platform: Platform; accountId: string },
): Promise<{ outcome: StepOutcome; gameId: string; name: string }> {
  const newCopy = (): KnownCopy => ({ id: randomUUID(), platformId: env.platform.id, format: "Digital", accountId: env.accountId, createdAt: Date.now() });
  const copyExtra = { steamAppId: step.app.appId };

  if (step.kind === "newGame") {
    const now = Date.now();
    const next: GameRec = { id: randomUUID(), name: step.name, wishlist: false, playStatus: null, steamAppId: step.app.appId, createdAt: now, updatedAt: now };
    await writeCopy(ctx, { next, copy: newCopy(), copyExtra });
    return { outcome: "added", gameId: next.id, name: next.name };
  }

  const read = gameRecOf(env.games.get(step.gameId)!);
  const steamAppId = step.link ? step.app.appId : read.steamAppId;
  if (step.kind === "present") {
    // Nothing to add. A manual Game matched by name still learns its Steam app ID, so later
    // Imports (and ticket 08's Tags) find it by ID.
    if (step.link) await saveGame(ctx, read, { ...read, steamAppId, updatedAt: nextUpdatedAt(read) });
    return { outcome: "present", gameId: read.id, name: read.name };
  }
  const next: GameRec = { ...read, ...afterCopyAdded(read), steamAppId, updatedAt: nextUpdatedAt(read) };
  await writeCopy(ctx, { read, next, copy: newCopy(), copyExtra });
  return { outcome: "added", gameId: read.id, name: read.name };
}

/** Run `fn` over `items`, at most `limit` at a time. */
async function inPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

async function importSteam(ctx: Ctx, args: { accountId: string }): Promise<SteamImportSummary> {
  const rec = await getAccountRec(ctx, args.accountId);
  const account = accountOut(rec);
  if (account.store !== "Steam") throw new UserError("ValidationError", "Only a Steam Account can import from Steam");
  const steamId = rec.steamId;
  if (typeof steamId !== "string") throw new UserError("ValidationError", `Set a Steam ID on "${accountLabel(account)}" first`);
  // Same rule every Digital Copy goes through (rules.ts); the Account itself is checked in writeCopy.
  const accountId = validateCopyAccount("Digital", account.id)!;

  let library;
  try {
    library = await steam().ownedGames(steamId);
  } catch (e) {
    if (e instanceof SteamError) throw steamUserError(e);
    throw e;
  }

  const platform = await steamPlatform(ctx);
  const games = await allGames(ctx);
  const steps = planSteamImport(library, games, accountId);
  const env = { games: new Map(games.map((g) => [g.id, g])), platform, accountId };

  const summary: SteamImportSummary = { added: 0, alreadyPresent: 0, failed: 0, addedNames: [] };
  // Each step touches a different Game (planSteamImport claims a Game for at most one app), so
  // steps can run side by side without racing each other's `updatedAt` guard.
  await inPool(steps, IMPORT_CONCURRENCY, async (step) => {
    try {
      const r = await applyStep(ctx, step, env);
      if (r.outcome === "added") {
        summary.added++;
        summary.addedNames.push(r.name);
      } else summary.alreadyPresent++;
      // Ticket 08: per-Game enrichment (store Categories/Genres -> Tags) hooks in here, for
      // added and present Games alike, keyed by step.app.appId and r.gameId.
    } catch (e) {
      // Logged without Steam data: these are DynamoDB or our own errors, never the Steam ID.
      if (!(e instanceof UserError)) console.error(e);
      summary.failed++;
    }
  });
  summary.addedNames.sort((a, b) => byName({ name: a }, { name: b }));
  return summary;
}

// ---- Seed --------------------------------------------------------------------
//
// Not a resolver: scripts/seed.ts calls this in-process for one explicit owner (ticket 12 runs it
// against prod). It writes the same records the resolvers do, each Game atomically with its
// Unknown Copy, and skips any row whose Game is already in the catalog (by seedKey), so a re-run
// (or a run after a partial failure) adds only what is missing and never touches existing Games.

export interface SeedResult {
  /** Names written (or, on a dry run, that would be). */
  added: string[];
  /** Names skipped because a Game with the same name is already in the catalog. */
  present: string[];
}

export async function seedGames(userId: string, raw: unknown, opts: { dryRun?: boolean } = {}): Promise<SeedResult> {
  if (!userId || userId.includes("#")) throw new UserError("ValidationError", "Seed needs the owner's Cognito sub");
  const rows = parseSeedRows(raw);
  const ctx: Ctx = { userId };
  const existing = new Set((await allGames(ctx)).map((g) => seedKey(g.name)));
  const result: SeedResult = { added: [], present: [] };
  for (const row of rows) {
    if (existing.has(seedKey(row.name))) {
      result.present.push(row.name);
      continue;
    }
    result.added.push(row.name);
    if (opts.dryRun) continue;

    const { wishlist, playStatus, unknownCopy } = seedState(row.status);
    const now = Date.now();
    const game: GameRec = { id: randomUUID(), name: row.name, wishlist, playStatus, createdAt: now, updatedAt: now };
    const copy: Copy | undefined = unknownCopy ? { id: randomUUID(), createdAt: now } : undefined;
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: TABLE,
              Item: { PK: ownerPk(ctx), SK: gameSk(game.id), ...game, playStatus: game.playStatus ?? undefined },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
          ...(copy ? [putNewCopy(ctx, game.id, copy)] : []),
        ],
      }),
    );
  }
  return result;
}

const RESOLVERS: Record<string, (ctx: Ctx, args: any) => Promise<unknown>> = {
  games, addGame, addCopy, fillUnknownCopy, removeCopy, setPlayStatus, setWishlist,
  platforms, addPlatform, renamePlatform, deletePlatform,
  accounts, addAccount, renameAccount, deleteAccount, setSteamId, importSteam,
};

export async function handler(event: AppSyncResolverEvent<Record<string, unknown>>) {
  const id = event.identity as AppSyncIdentityCognito | null;
  if (!id?.sub) throw new Error("Forbidden");
  const fn = RESOLVERS[event.info.fieldName];
  if (!fn) throw new Error(`no resolver for ${event.info.fieldName}`);
  try {
    return await fn({ userId: id.sub }, event.arguments);
  } catch (e) {
    if (e instanceof UserError) throw new Error(`${e.type}: ${e.message}`);
    console.error(e);
    throw new Error("InternalError");
  }
}
