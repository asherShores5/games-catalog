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
  SEED_TAGS, addManualTag, dropTag, importTags, mentionsTag, moveTag, planMerge, removeGameTag as unlinkTag,
  addTagNames, matchImportTag, sameTagName, storeTagNames, type ImportableTag, type MergeSide,
  type GameTag, type GameTags, type Tag,
} from "@games/shared";
import {
  UserError, validateAccountNickname, validateEdition, validateFormat, validateGameName, validatePlatformName,
  validateCopyAccount, validatePlayStatus, validateSteamId, validateStore, validateTagName,
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

/**
 * The Game record fields we store. Ticket 01 records lack wishlist/playStatus; they default here.
 * The Game's Tag links (and the Tags I removed) live on this record too (see Tags below). They're
 * optional so code building a fresh Game needn't mention them; gameRec fills them, so every Game
 * write that starts from a read carries them along.
 */
interface GameRec extends Partial<GameTags> {
  id: string;
  name: string;
  wishlist: boolean;
  playStatus: PlayStatus | null;
  /** Set when a Steam Import created or matched this Game. */
  steamAppId?: number;
  /** Private: other Steam app IDs that match this Game (a Merge of two Steam editions). */
  mergedSteamAppIds?: number[];
  /** Private: when an Import last read this Game's store Categories/Genres (ticket 08). */
  storeTagsAt?: number;
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
    mergedSteamAppIds: rec.mergedSteamAppIds as number[] | undefined,
    storeTagsAt: rec.storeTagsAt as number | undefined,
    createdAt: rec.createdAt as number,
    updatedAt: rec.updatedAt as number,
    tags: (rec.tags as GameTag[] | undefined) ?? [],
    removedTagIds: (rec.removedTagIds as string[] | undefined) ?? [],
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
  const { removedTagIds: _private, mergedSteamAppIds: _alsoPrivate, storeTagsAt: _stillPrivate, ...pub } = game;
  return { ...pub, tags: game.tags ?? [], copies: sorted, owned: isOwned(sorted) };
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
  return (await catalog(ctx)).map((c) => gameOut(c.game, c.copies)).sort(byName);
}

/** Every Game record (private fields included, for writes) with its Copies. One query. */
async function catalog(ctx: Ctx): Promise<{ game: GameRec; copies: Copy[] }[]> {
  const recs = await queryPrefix(ctx, "GAME#");
  const copies = new Map<string, Copy[]>();
  for (const rec of recs.filter(isCopyRec)) {
    const list = copies.get(rec.gameId as string) ?? [];
    list.push(copyOut(rec));
    copies.set(rec.gameId as string, list);
  }
  return recs.filter((r) => !isCopyRec(r)).map((r) => ({ game: gameRec(r), copies: copies.get(r.id as string) ?? [] }));
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
// are never written by an Import, except a lone Unknown Copy, which is filled in (planSteamImport).

const IMPORT_CONCURRENCY = 8;

/** The Platform Steam Copies land on: the owner's "PC", re-created if they deleted it. */
async function steamPlatform(ctx: Ctx): Promise<Platform> {
  const pc = (await allPlatforms(ctx)).find((p) => samePlatformName(p.name, STEAM_PLATFORM));
  return pc ?? addPlatform(ctx, { name: STEAM_PLATFORM });
}

function steamUserError(e: SteamError): UserError {
  return new UserError("SteamError", e.message);
}

type StepOutcome = "added" | "present";

/** Apply one plan step. Returns what it did and the Game it concerns. */
async function applyStep(
  ctx: Ctx,
  step: ImportStep,
  env: { games: Map<string, { game: GameRec; copies: Copy[] }>; platform: Platform; accountId: string },
  /** Tag ids from the app's store page, when this Import looked it up. */
  storeTagIds?: string[],
): Promise<{ outcome: StepOutcome; gameId: string; name: string }> {
  // Store Tags ride in the same Game write as the Copy (or the Steam app ID link). importTags
  // skips Tags already linked (Manual stays Manual) and Tags I removed from this Game.
  const withStoreTags = (g: GameRec): GameRec =>
    storeTagIds ? { ...g, ...importTags(tagState(g), storeTagIds), storeTagsAt: Date.now() } : g;
  const newCopy = (): KnownCopy => ({ id: randomUUID(), platformId: env.platform.id, format: "Digital", accountId: env.accountId, createdAt: Date.now() });
  const copyExtra = { steamAppId: step.app.appId };

  if (step.kind === "newGame") {
    const now = Date.now();
    const next = withStoreTags({ id: randomUUID(), name: step.name, wishlist: false, playStatus: null, steamAppId: step.app.appId, createdAt: now, updatedAt: now });
    await writeCopy(ctx, { next, copy: newCopy(), copyExtra });
    return { outcome: "added", gameId: next.id, name: next.name };
  }

  // The stored record, so Tags, Tag removals and any other private field survive the rewrite.
  const { game: read, copies } = env.games.get(step.gameId)!;
  const steamAppId = step.link ? step.app.appId : read.steamAppId;
  if (step.kind === "present") {
    // Nothing to add. A manual Game matched by name still learns its Steam app ID, so later
    // Imports find it by ID. Store Tags (if looked up) land in the same write.
    // A repeat step (a merged Game's second app ID) never writes: the Game's first step does.
    if (!step.repeat && (step.link || storeTagIds)) await saveGame(ctx, read, withStoreTags({ ...read, steamAppId, updatedAt: nextUpdatedAt(read) }));
    return { outcome: "present", gameId: read.id, name: read.name };
  }
  if (step.kind === "fillUnknown") {
    // Same write as fillUnknownCopy: the Copy keeps its id (and Edition); Owned, Wishlist and
    // Play status don't change since it was already a Copy.
    const unknown = copies.find((c) => c.id === step.copyId)!;
    const copy: KnownCopy = { ...unknown, platformId: env.platform.id, format: "Digital", accountId: env.accountId };
    await writeCopy(ctx, { read, next: withStoreTags({ ...read, steamAppId, updatedAt: nextUpdatedAt(read) }), copy, copyExtra, fill: true });
    return { outcome: "added", gameId: read.id, name: read.name };
  }
  const next = withStoreTags({ ...read, ...afterCopyAdded(read), steamAppId, updatedAt: nextUpdatedAt(read) });
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
  const started = Date.now();
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
  const games = await catalog(ctx);
  const steps = planSteamImport(library, games.map((c) => ({ ...gameOut(c.game, c.copies), mergedSteamAppIds: c.game.mergedSteamAppIds })), accountId);
  const env = { games: new Map(games.map((c) => [c.game.id, c])), platform, accountId };

  const wanted = storeTagCandidates(steps, env.games);
  const storeTags = await lookUpStoreTags(ctx, wanted, started);

  const summary: SteamImportSummary = { added: 0, alreadyPresent: 0, failed: 0, addedNames: [], tagged: 0, tagsPending: 0 };
  // Each step touches a different Game (planSteamImport claims a Game for at most one app), so
  // steps can run side by side without racing each other's `updatedAt` guard.
  await inPool(steps, IMPORT_CONCURRENCY, async (step) => {
    try {
      const tagIds = storeTags.get(step.app.appId);
      const r = await applyStep(ctx, step, env, tagIds);
      if (r.outcome === "added") {
        summary.added++;
        summary.addedNames.push(r.name);
      } else summary.alreadyPresent++;
      if (tagIds) summary.tagged++;
    } catch (e) {
      // Logged without Steam data: these are DynamoDB or our own errors, never the Steam ID.
      if (!(e instanceof UserError)) console.error(e);
      summary.failed++;
    }
  });
  summary.addedNames.sort((a, b) => byName({ name: a }, { name: b }));
  summary.tagsPending = wanted.length - summary.tagged;
  return summary;
}

// ---- Steam Import: store Tags (ticket 08) ------------------------------------
//
// Each Import-touched Game's store page (Categories + Genres, no key needed) becomes Import Tags
// via storeTagNames. The store is rate-limited (roughly 200 requests per 5 minutes) and the
// Lambda has 25s, so lookups run one at a time (the real client spaces them out), at most
// STORE_TAGS_CAP per Import and none started after STORE_TAGS_BUDGET_MS. Games never looked up
// go first, then ones looked up longest ago (refresh after STORE_TAGS_REFRESH_MS); the rest wait
// for the next Import (summary.tagsPending). A failed lookup only leaves its Game pending; a
// "slow down" from the store ends the lookups for this Import.

const STORE_TAGS_CAP = 40;
const STORE_TAGS_BUDGET_MS = 12_000;
const STORE_TAGS_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;

/** The steps whose Game needs a store Tag lookup, in lookup order. */
function storeTagCandidates(steps: ImportStep[], games: Map<string, { game: GameRec }>): ImportStep[] {
  const lastLookup = (step: ImportStep) => (step.kind === "newGame" ? undefined : games.get(step.gameId)?.game.storeTagsAt);
  const now = Date.now();
  return steps
    .filter((step) => {
      // A merged Game's later app IDs never write it (only the first step may), so it gets one lookup.
      if (step.kind === "present" && step.repeat) return false;
      const at = lastLookup(step);
      return at === undefined || now - at >= STORE_TAGS_REFRESH_MS;
    })
    .sort((a, b) => (lastLookup(a) ?? 0) - (lastLookup(b) ?? 0));
}

/**
 * Look up store pages for `steps` (within the cap and time budget) and turn them into Tag ids,
 * creating Tags for names I don't have yet. Keyed by Steam app ID; an app missing from the
 * result wasn't looked up (or the lookup failed); an app with [] has no usable Tags.
 */
async function lookUpStoreTags(ctx: Ctx, steps: ImportStep[], started: number): Promise<Map<number, string[]>> {
  const names = new Map<number, string[]>();
  for (const step of steps.slice(0, STORE_TAGS_CAP)) {
    if (Date.now() - started >= STORE_TAGS_BUDGET_MS) break;
    try {
      const details = await steam().appDetails(step.app.appId);
      names.set(step.app.appId, details ? storeTagNames(details.categories, details.genres) : []);
    } catch (e) {
      if (e instanceof SteamError && e.kind === "rateLimited") break;
      if (!(e instanceof SteamError)) console.error(e);
    }
  }
  if (names.size === 0) return new Map();

  // My renames, merges and deletes decide where each store name lands (matchImportTag).
  const known = await allTagRecs(ctx);
  const dropped = await droppedTagNames(ctx);
  const idFor = new Map<string, string | undefined>();
  const tagIdFor = async (name: string) => {
    const match = matchImportTag(name, known, dropped);
    if ("tagId" in match) return match.tagId;
    if ("skip" in match) return undefined;
    try {
      const created = await addTag(ctx, { name: match.create });
      known.push({ ...created, aliases: [] });
      return created.id;
    } catch (e) {
      // A Tag name the rules refuse: skip that Tag, keep the rest.
      if (!(e instanceof UserError)) throw e;
      return undefined;
    }
  };
  const out = new Map<number, string[]>();
  for (const [appId, list] of names) {
    const ids: string[] = [];
    for (const name of list) {
      if (!idFor.has(name)) idFor.set(name, await tagIdFor(name));
      const id = idFor.get(name);
      if (id && !ids.includes(id)) ids.push(id);
    }
    out.set(appId, ids);
  }
  return out;
}

// ---- Tags --------------------------------------------------------------------
//
// `SK = TAG#<id>` holds `{ id, name }`: one shared list for manual and imported Tags. Seeded once
// per owner like Platforms (marker `META#tagsSeeded`).

const tagSk = (id: string) => `TAG#${id}`;
const TAGS_SEEDED_SK = "META#tagsSeeded";

async function ensureTags(ctx: Ctx) {
  const marker = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: ownerPk(ctx), SK: TAGS_SEEDED_SK } }));
  if (marker.Item) return;
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: TABLE, Item: { PK: ownerPk(ctx), SK: TAGS_SEEDED_SK, at: Date.now() }, ConditionExpression: "attribute_not_exists(PK)" } },
          ...SEED_TAGS.map((name) => {
            const id = randomUUID();
            return { Put: { TableName: TABLE, Item: { PK: ownerPk(ctx), SK: tagSk(id), id, name } } };
          }),
        ],
      }),
    );
  } catch (e) {
    if ((e as Error).name !== "TransactionCanceledException") throw e;
  }
}

function tagOut(rec: Rec): Tag {
  return { id: rec.id as string, name: rec.name as string };
}

/** The Tag with its private `aliases` (former names, merged-away names), for Imports. */
function importableTag(rec: Rec): ImportableTag {
  return { ...tagOut(rec), aliases: (rec.aliases as string[] | undefined) ?? [] };
}

async function allTagRecs(ctx: Ctx): Promise<ImportableTag[]> {
  await ensureTags(ctx);
  return (await queryPrefix(ctx, "TAG#")).map(importableTag);
}

async function allTags(ctx: Ctx) {
  return (await allTagRecs(ctx)).map(({ id, name }): Tag => ({ id, name })).sort(byName);
}

async function getTagRec(ctx: Ctx, id: unknown): Promise<ImportableTag> {
  if (typeof id !== "string") throw new UserError("NotFound", "No such Tag");
  await ensureTags(ctx);
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: ownerPk(ctx), SK: tagSk(id) } }));
  if (!r.Item) throw new UserError("NotFound", "No such Tag");
  return importableTag(r.Item);
}

// Names of Tags I deleted, one record each (`SK = DROPPED_TAG#<folded name>`), so an Import
// doesn't re-create them. Keyed so names that sameTagName treats as equal share one record.
const DROPPED_TAG_PREFIX = "DROPPED_TAG#";
const droppedTagSk = (name: string) =>
  DROPPED_TAG_PREFIX + name.trim().normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

async function droppedTagNames(ctx: Ctx): Promise<string[]> {
  return (await queryPrefix(ctx, DROPPED_TAG_PREFIX)).map((r) => r.name as string);
}

async function tags(ctx: Ctx) {
  return allTags(ctx);
}

async function getTag(ctx: Ctx, id: unknown): Promise<Tag> {
  if (typeof id !== "string") throw new UserError("NotFound", "No such Tag");
  await ensureTags(ctx);
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: ownerPk(ctx), SK: tagSk(id) } }));
  if (!r.Item) throw new UserError("NotFound", "No such Tag");
  return tagOut(r.Item);
}

async function addTag(ctx: Ctx, args: { name: string }) {
  const name = validateTagName(args.name, await allTags(ctx));
  const tag: Tag = { id: randomUUID(), name };
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: { PK: ownerPk(ctx), SK: tagSk(tag.id), ...tag },
      ConditionExpression: "attribute_not_exists(PK)",
    }),
  );
  return tag;
}

/** I rename a Tag. Its old name becomes an alias, so Imports bringing that name still land here. */
async function renameTag(ctx: Ctx, args: { id: string; name: string }) {
  const tag = await getTagRec(ctx, args.id);
  const name = validateTagName(args.name, await allTags(ctx), tag.id);
  const aliases = sameTagName(tag.name, name) ? tag.aliases : addTagNames(tag.aliases, tag.name);
  await setTagAliases(ctx, tag, aliases, name);
  return { id: tag.id, name };
}

/** Rewrite a Tag's name and aliases, only if nobody renamed it since `read`. */
async function setTagAliases(ctx: Ctx, read: ImportableTag, aliases: string[], name = read.name) {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: ownerPk(ctx), SK: tagSk(read.id) },
        UpdateExpression: "SET #n = :n, aliases = :a",
        ConditionExpression: "attribute_exists(PK) AND #n = :read",
        ExpressionAttributeNames: { "#n": "name" },
        ExpressionAttributeValues: { ":n": name, ":a": aliases, ":read": read.name },
      }),
    );
  } catch (e) {
    if ((e as Error).name === "ConditionalCheckFailedException") throw new UserError("Conflict", "The Tag changed while saving; reload and try again");
    throw e;
  }
}

/**
 * Rewrite every Game whose Tag state mentions `tagId` (Tag delete and merge). Runs after the Tag
 * record is gone: addGameTag conditions on the Tag existing, so no new link can land behind the
 * scan. Each Game write keeps the changed-since-read guard; a Game that changes meanwhile is
 * re-read and retried.
 */
async function rewriteGamesMentioning(ctx: Ctx, tagId: string, change: (g: GameTags) => GameTags) {
  const recs = (await queryPrefix(ctx, "GAME#")).filter((r) => !isCopyRec(r)).map(gameRec);
  for (const first of recs.filter((g) => mentionsTag(tagState(g), tagId))) {
    let game = first;
    for (let attempt = 1; ; attempt++) {
      try {
        await saveGame(ctx, game, { ...game, ...change(tagState(game)), updatedAt: nextUpdatedAt(game) });
        break;
      } catch (e) {
        if (!(e instanceof UserError) || attempt === 3) throw e;
        game = (await loadGame(ctx, game.id)).game;
      }
    }
  }
}

/** I delete a Tag. Its names (current and aliases) are remembered so Imports don't re-create it. */
async function deleteTag(ctx: Ctx, args: { id: string }) {
  const tag = await getTagRec(ctx, args.id);
  const dropped = addTagNames([], tag.name, ...tag.aliases);
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        { Delete: { TableName: TABLE, Key: { PK: ownerPk(ctx), SK: tagSk(tag.id) } } },
        ...dropped.map((name) => ({ Put: { TableName: TABLE, Item: { PK: ownerPk(ctx), SK: droppedTagSk(name), name } } })),
      ].slice(0, TRANSACT_MAX),
    }),
  );
  await rewriteGamesMentioning(ctx, tag.id, (g) => dropTag(g, tag.id));
  return tag.id;
}

/**
 * Merge Tag `fromId` into `intoId`: its links move (deduped, Manual winning) and it's deleted.
 * Its name and aliases become aliases of `intoId`, so Imports bringing them land there.
 */
async function mergeTags(ctx: Ctx, args: { fromId: string; intoId: string }) {
  const from = await getTagRec(ctx, args.fromId);
  const into = await getTagRec(ctx, args.intoId);
  if (from.id === into.id) throw new UserError("ValidationError", "Pick two different Tags to merge");
  await setTagAliases(ctx, into, addTagNames(into.aliases, from.name, ...from.aliases));
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: ownerPk(ctx), SK: tagSk(from.id) } }));
  await rewriteGamesMentioning(ctx, from.id, (g) => moveTag(g, from.id, into.id));
  return { id: into.id, name: into.name };
}

const tagState = (game: GameRec): GameTags => ({ tags: game.tags ?? [], removedTagIds: game.removedTagIds ?? [] });

/** I add a Tag to a Game: a Manual link (an imported link becomes Manual). */
async function addGameTag(ctx: Ctx, args: { gameId: string; tagId: string }) {
  const { game, copies } = await loadGame(ctx, args.gameId);
  const tag = await getTag(ctx, args.tagId);
  const next: GameRec = { ...game, ...addManualTag(tagState(game), tag.id), updatedAt: nextUpdatedAt(game) };
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          putGameIfUnchanged(ctx, game, next),
          // The Tag must still exist when the link lands: a delete or merge may be racing us.
          { ConditionCheck: { TableName: TABLE, Key: { PK: ownerPk(ctx), SK: tagSk(tag.id) }, ConditionExpression: "attribute_exists(PK)" } },
        ],
      }),
    );
  } catch (e) {
    const codes = cancellationCodes(e);
    if (codes?.[1] === "ConditionalCheckFailed") throw new UserError("NotFound", "No such Tag");
    if (codes) throw changedMeanwhile();
    throw e;
  }
  return gameOut(next, copies);
}

/** I remove a Tag from a Game. The removal is remembered so a later Import won't re-add it. */
async function removeGameTag(ctx: Ctx, args: { gameId: string; tagId: string }) {
  const { game, copies } = await loadGame(ctx, args.gameId);
  if (!tagState(game).tags.some((t) => t.tagId === args.tagId)) return gameOut(game, copies);
  const next: GameRec = { ...game, ...unlinkTag(tagState(game), args.tagId), updatedAt: nextUpdatedAt(game) };
  await saveGame(ctx, game, next);
  return gameOut(next, copies);
}

// ---- Merge Games ---------------------------------------------------------------
//
// mergeGames folds Game `fromId` into Game `intoId` (planMerge in shared/merge.ts decides the
// result) in ONE transaction: the surviving Game Put and the other Game's Delete are both
// conditioned on the `updatedAt` read, so any racing write to either Game cancels the whole
// Merge. Each moved Copy is re-keyed from the STORED record (Put under the surviving Game, Delete
// the old key), so stored-only fields (an Import's `steamAppId`) and the Account move as they
// are; legacy Digital Copies with no Account aren't re-validated. Redundant Unknown Copies go.

/** DynamoDB's TransactWrite item limit. */
const TRANSACT_MAX = 100;

async function loadGameRecords(ctx: Ctx, id: unknown): Promise<{ game: GameRec; copyRecs: Rec[] }> {
  if (typeof id !== "string" || id.includes("#")) throw new UserError("NotFound", "No such Game");
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: ownerPk(ctx), SK: gameSk(id) } }));
  if (!r.Item) throw new UserError("NotFound", "No such Game");
  return { game: gameRec(r.Item), copyRecs: await queryPrefix(ctx, copyPrefix(id)) };
}

const mergeSide = (game: GameRec, copyRecs: Rec[]): MergeSide => ({ ...game, tags: game.tags ?? [], copies: copyRecs.map(copyOut) });

async function mergeGames(ctx: Ctx, args: { fromId: string; intoId: string; playStatus?: string | null }) {
  // An absent playStatus means "keep the more advanced one"; an explicit null means none.
  const choice = "playStatus" in args ? { playStatus: validatePlayStatus(args.playStatus) } : undefined;
  if (args.fromId === args.intoId) throw new UserError("ValidationError", "Pick two different Games to merge");
  const into = await loadGameRecords(ctx, args.intoId);
  const from = await loadGameRecords(ctx, args.fromId);
  const plan = planMerge(mergeSide(into.game, into.copyRecs), mergeSide(from.game, from.copyRecs), choice);
  const dropped = new Set(plan.droppedCopyIds);

  const next: GameRec = {
    ...into.game,
    wishlist: plan.wishlist,
    playStatus: plan.playStatus,
    steamAppId: plan.steamAppId,
    mergedSteamAppIds: plan.mergedSteamAppIds.length > 0 ? plan.mergedSteamAppIds : undefined,
    // The store Tag lookup belongs to the Steam app ID the merged Game keeps (planMerge: into's, else from's).
    storeTagsAt: into.game.steamAppId !== undefined ? into.game.storeTagsAt : from.game.storeTagsAt,
    ...plan.tags,
    updatedAt: nextUpdatedAt(into.game),
  };
  const del = (SK: unknown) => ({ Delete: { TableName: TABLE, Key: { PK: ownerPk(ctx), SK: SK as string } } });
  const items = [
    putGameIfUnchanged(ctx, into.game, next),
    {
      Delete: {
        TableName: TABLE,
        Key: { PK: ownerPk(ctx), SK: gameSk(from.game.id) },
        ConditionExpression: "updatedAt = :read",
        ExpressionAttributeValues: { ":read": from.game.updatedAt },
      },
    },
    ...into.copyRecs.filter((r) => dropped.has(r.id as string)).map((r) => del(r.SK)),
    ...from.copyRecs.flatMap((r) =>
      dropped.has(r.id as string)
        ? [del(r.SK)]
        : [
            {
              Put: {
                TableName: TABLE,
                Item: { ...r, PK: ownerPk(ctx), SK: copyPrefix(into.game.id) + (r.id as string), gameId: into.game.id },
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            del(r.SK),
          ],
    ),
  ];
  if (items.length > TRANSACT_MAX) {
    throw new UserError("ValidationError", "Too many Copies to merge in one go; remove some from the other Game first");
  }
  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: items }));
  } catch (e) {
    if (cancellationCodes(e)) throw changedMeanwhile();
    throw e;
  }
  return gameOut(next, plan.copies);
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
  tags, addTag, renameTag, deleteTag, mergeTags, addGameTag, removeGameTag,
  mergeGames,
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
