import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { AppSyncIdentityCognito, AppSyncResolverEvent } from "aws-lambda";
import {
  SEED_PLATFORMS, accountLabel, afterCopyAdded, byAccountLabel, byName, canWishlist, isOwned,
  type Account, type Copy, type Format, type Game, type Platform, type PlayStatus, type Store,
} from "@games/shared";
import {
  SEED_TAGS, addManualTag, dropTag, mentionsTag, moveTag, removeGameTag as unlinkTag,
  type GameTag, type GameTags, type Tag,
} from "@games/shared";
import {
  UserError, validateAccountNickname, validateEdition, validateFormat, validateGameName, validatePlatformName,
  validateCopyAccount, validatePlayStatus, validateStore, validateTagName,
} from "./rules";

const TABLE = process.env.TABLE_NAME!;

type DocClient = Pick<DynamoDBDocumentClient, "send">;

let ddb: DocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/** Test seam: swap the document client (see src/testing/harness.ts). Production never calls this. */
export function setDocClient(client: DocClient) {
  ddb = client;
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
  createdAt: number;
  updatedAt: number;
}

function gameRec(rec: Rec): GameRec {
  return {
    id: rec.id as string,
    name: rec.name as string,
    wishlist: rec.wishlist === true,
    playStatus: (rec.playStatus as PlayStatus | undefined) ?? null,
    createdAt: rec.createdAt as number,
    updatedAt: rec.updatedAt as number,
    tags: (rec.tags as GameTag[] | undefined) ?? [],
    removedTagIds: (rec.removedTagIds as string[] | undefined) ?? [],
  };
}

function copyOut(rec: Rec): Copy {
  return {
    id: rec.id as string,
    platformId: rec.platformId as string,
    format: rec.format as Format,
    // Absent on Physical Copies, and on Digital Copies saved before Accounts existed.
    accountId: rec.accountId as string | undefined,
    edition: rec.edition as string | undefined,
    createdAt: rec.createdAt as number,
  };
}

const oldestFirst = (a: Copy, b: Copy) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);

function gameOut(game: GameRec, copies: Copy[]): Game {
  const sorted = [...copies].sort(oldestFirst);
  const { removedTagIds: _private, ...pub } = game;
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

  const copy: Copy = { id: randomUUID(), platformId: platform.id, format, accountId: account?.id, edition, createdAt: Date.now() };
  const next: GameRec = { ...game, ...afterCopyAdded(game), updatedAt: nextUpdatedAt(game) };
  // The Platform (and Account) must still exist when the Copy lands: a delete may be racing us.
  const mustExist = (SK: string) => ({
    ConditionCheck: { TableName: TABLE, Key: { PK: ownerPk(ctx), SK }, ConditionExpression: "attribute_exists(PK)" },
  });
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          putGameIfUnchanged(ctx, game, next),
          {
            Put: {
              TableName: TABLE,
              Item: { PK: ownerPk(ctx), SK: copyPrefix(game.id) + copy.id, gameId: game.id, ...copy },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
          mustExist(platformSk(platform.id)),
          ...(account ? [mustExist(accountSk(account.id))] : []),
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
  return gameOut(next, [...copies, copy]);
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
// Store-specific fields (ticket 07's Steam ID) go on this same record; accountOut picks the
// public fields, so a later private field doesn't leak by accident.

const accountSk = (id: string) => `ACCOUNT#${id}`;

function accountOut(rec: Rec): Account {
  return { id: rec.id as string, store: rec.store as Store, nickname: rec.nickname as string };
}

async function allAccounts(ctx: Ctx) {
  return (await queryPrefix(ctx, "ACCOUNT#")).map(accountOut).sort(byAccountLabel);
}

async function accounts(ctx: Ctx) {
  return allAccounts(ctx);
}

async function getAccount(ctx: Ctx, id: unknown): Promise<Account> {
  if (typeof id !== "string") throw new UserError("NotFound", "No such Account");
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: ownerPk(ctx), SK: accountSk(id) } }));
  if (!r.Item) throw new UserError("NotFound", "No such Account");
  return accountOut(r.Item);
}

async function addAccount(ctx: Ctx, args: { store: string; nickname: string }) {
  const store = validateStore(args.store);
  const nickname = validateAccountNickname(args.nickname, store, await allAccounts(ctx));
  const account: Account = { id: randomUUID(), store, nickname };
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: { PK: ownerPk(ctx), SK: accountSk(account.id), ...account },
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

async function allTags(ctx: Ctx) {
  await ensureTags(ctx);
  return (await queryPrefix(ctx, "TAG#")).map(tagOut).sort(byName);
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

async function renameTag(ctx: Ctx, args: { id: string; name: string }) {
  const tag = await getTag(ctx, args.id);
  const name = validateTagName(args.name, await allTags(ctx), tag.id);
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: ownerPk(ctx), SK: tagSk(tag.id) },
      UpdateExpression: "SET #n = :n",
      ConditionExpression: "attribute_exists(PK)",
      ExpressionAttributeNames: { "#n": "name" },
      ExpressionAttributeValues: { ":n": name },
    }),
  );
  return { ...tag, name };
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

async function deleteTag(ctx: Ctx, args: { id: string }) {
  const tag = await getTag(ctx, args.id);
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: ownerPk(ctx), SK: tagSk(tag.id) } }));
  await rewriteGamesMentioning(ctx, tag.id, (g) => dropTag(g, tag.id));
  return tag.id;
}

/** Merge Tag `fromId` into `intoId`: its links move (deduped, Manual winning) and it's deleted. */
async function mergeTags(ctx: Ctx, args: { fromId: string; intoId: string }) {
  const from = await getTag(ctx, args.fromId);
  const into = await getTag(ctx, args.intoId);
  if (from.id === into.id) throw new UserError("ValidationError", "Pick two different Tags to merge");
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: ownerPk(ctx), SK: tagSk(from.id) } }));
  await rewriteGamesMentioning(ctx, from.id, (g) => moveTag(g, from.id, into.id));
  return into;
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

const RESOLVERS: Record<string, (ctx: Ctx, args: any) => Promise<unknown>> = {
  games, addGame, addCopy, removeCopy, setPlayStatus, setWishlist,
  platforms, addPlatform, renamePlatform, deletePlatform,
  accounts, addAccount, renameAccount, deleteAccount,
  tags, addTag, renameTag, deleteTag, mergeTags, addGameTag, removeGameTag,
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
