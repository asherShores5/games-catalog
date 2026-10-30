// Games and Copies.
//
// A Game is `SK = GAME#<id>` and each of its Copies is `SK = GAME#<id>#COPY#<copyId>`, so one
// begins_with("GAME#") query loads every Game with its Copies. The Game record stores its own
// fields (name, wishlist, playStatus); Owned is never stored, it is derived from the Copies.
//
// Every write that depends on a Game's Copies (addCopy, removeCopy, setWishlist) rewrites the
// Game record conditioned on the `updatedAt` it read, so two racing writes can't both win
// (e.g. Wishlist set on a Game while a Copy is being added). `updatedAt` always moves forward.
import { randomUUID } from "node:crypto";
import { PutCommand, TransactWriteCommand, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import {
  afterCopyAdded, byName, canWishlist, isOwned, isUnknownCopy,
  type Copy, type Format, type Game, type GameTag, type GameTags, type PlayStatus,
} from "@games/shared";
import {
  TABLE, accountSk, cancellationCodes, copyPrefix, ddb, failedAt, gameSk, getOwned, isCopyRec, ownerPk, platformSk, putNew, queryPrefix,
  type Ctx, type Rec,
} from "./db";
import { getAccount } from "./accounts";
import { getPlatform } from "./platforms";
import { UserError, validateCopyAccount, validateEdition, validateFormat, validateGameName, validatePlayStatus } from "./rules";

/**
 * The Game record fields we store. Ticket 01 records lack wishlist/playStatus; they default here.
 * The Game's Tag links (and the Tags I removed) live on this record too (see tags.ts). They're
 * optional so code building a fresh Game needn't mention them; gameRec fills them, so every Game
 * write that starts from a read carries them along.
 */
export interface GameRec extends Partial<GameTags> {
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

/** A stored Game record with its Copies, as read. */
export interface GameWithCopies {
  game: GameRec;
  copies: Copy[];
}

export function gameRec(rec: Rec): GameRec {
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

/** A brand-new Game record: not on the Wishlist and no Play status unless `fields` say otherwise. */
export function newGameRec(name: string, fields: Partial<GameRec> = {}): GameRec {
  const now = Date.now();
  return { id: randomUUID(), name, wishlist: false, playStatus: null, createdAt: now, updatedAt: now, ...fields };
}

export function copyOut(rec: Rec): Copy {
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

/** A Copy record of `gameId`. `extra` holds stored-only fields (an Import's `steamAppId`). */
const copyItem = (gameId: string, copy: Copy, extra?: Rec) => ({ SK: copyPrefix(gameId) + copy.id, gameId, ...extra, ...copy });

/** The Put for a brand-new Copy record of `gameId` (the Seed's Unknown Copies). */
export const putNewCopy = (ctx: Ctx, gameId: string, copy: Copy) => putNew(ctx, copyItem(gameId, copy));

/** A Copy whose Platform and Format are known (anything but an Unknown Copy). */
export type KnownCopy = Copy & { platformId: string; format: Format };

/** Where a Copy is, as a caller gives it (addCopy, fillUnknownCopy). */
export interface CopyInput {
  platformId: string;
  format: string;
  accountId?: string | null;
  edition?: string | null;
}

const oldestFirst = (a: Copy, b: Copy) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);

export function gameOut(game: GameRec, copies: Copy[]): Game {
  const sorted = [...copies].sort(oldestFirst);
  // Private fields never leave the API.
  const { removedTagIds: _removedTagIds, mergedSteamAppIds: _mergedSteamAppIds, storeTagsAt: _storeTagsAt, ...pub } = game;
  return { ...pub, tags: game.tags ?? [], copies: sorted, owned: isOwned(sorted) };
}

/** Next `updatedAt`: now, but always later than the last write (it doubles as a version). */
export const nextUpdatedAt = (game: GameRec) => Math.max(Date.now(), game.updatedAt + 1);

/** The Game record as stored (no playStatus attribute for "none"). */
const gameItem = (ctx: Ctx, game: GameRec) => ({ PK: ownerPk(ctx), SK: gameSk(game.id), ...game, playStatus: game.playStatus ?? undefined });

/** The Put for a brand-new Game record. */
export const putNewGame = (ctx: Ctx, game: GameRec) => putNew(ctx, gameItem(ctx, game));

/** Write the Game record only if nobody changed it since we read it. */
export function putGameIfUnchanged(ctx: Ctx, read: GameRec, next: GameRec) {
  return {
    Put: {
      TableName: TABLE,
      Item: gameItem(ctx, next),
      ConditionExpression: "updatedAt = :read",
      ExpressionAttributeValues: { ":read": read.updatedAt },
    },
  };
}

export const changedMeanwhile = () => new UserError("Conflict", "The Game changed while saving; reload and try again");

/** The stored Game record. Ids containing "#" can't be Game ids (they'd reach other keys). */
export async function getGameRec(ctx: Ctx, id: unknown): Promise<GameRec> {
  if (typeof id === "string" && id.includes("#")) throw new UserError("NotFound", "No such Game");
  return gameRec(await getOwned(ctx, id, gameSk, "Game"));
}

export async function loadGame(ctx: Ctx, id: unknown): Promise<GameWithCopies> {
  const game = await getGameRec(ctx, id);
  return { game, copies: (await queryPrefix(ctx, copyPrefix(game.id))).map(copyOut) };
}

/** Every Game with its Copies, in name order. */
export async function allGames(ctx: Ctx): Promise<Game[]> {
  return (await catalog(ctx)).map((c) => gameOut(c.game, c.copies)).sort(byName);
}

/** Every Game record (private fields included, for writes) with its Copies. One query. */
export async function catalog(ctx: Ctx): Promise<GameWithCopies[]> {
  const recs = await queryPrefix(ctx, "GAME#");
  const copies = new Map<string, Copy[]>();
  for (const rec of recs.filter(isCopyRec)) {
    const list = copies.get(rec.gameId as string) ?? [];
    list.push(copyOut(rec));
    copies.set(rec.gameId as string, list);
  }
  return recs.filter((r) => !isCopyRec(r)).map((r) => ({ game: gameRec(r), copies: copies.get(r.id as string) ?? [] }));
}

export async function addGame(ctx: Ctx, args: { name: string }) {
  const game = newGameRec(validateGameName(args.name));
  await ddb.send(new PutCommand(putNewGame(ctx, game).Put));
  return gameOut(game, []);
}

/** A CopyInput's rule checks (rules.ts), before anything is read. */
function validateCopyInput(input: CopyInput) {
  const format = validateFormat(input.format);
  return { format, accountId: validateCopyAccount(format, input.accountId), edition: validateEdition(input.edition) };
}

/** The Platform and Account a valid CopyInput names, read (NotFound if either is gone). */
async function copyPlace(ctx: Ctx, input: CopyInput, valid: ReturnType<typeof validateCopyInput>) {
  const platform = await getPlatform(ctx, input.platformId);
  const account = valid.accountId === undefined ? undefined : await getAccount(ctx, valid.accountId);
  return { platformId: platform.id, format: valid.format, accountId: account?.id };
}

export async function addCopy(ctx: Ctx, args: CopyInput & { gameId: string }) {
  const valid = validateCopyInput(args);
  const { game, copies } = await loadGame(ctx, args.gameId);
  const copy: KnownCopy = { id: randomUUID(), ...(await copyPlace(ctx, args, valid)), edition: valid.edition, createdAt: Date.now() };
  const next: GameRec = { ...game, ...afterCopyAdded(game), updatedAt: nextUpdatedAt(game) };
  await writeCopy(ctx, { read: game, next, copy });
  return gameOut(next, [...copies, copy]);
}

/** Positions in writeCopy's transaction, for reading which condition failed. */
const COPY_TX = { game: 0, copy: 1, platform: 2, account: 3 } as const;

/**
 * Write a Copy and its Game in one transaction: the Game record is rewritten only if unchanged
 * since `read` (or created, when there's no `read`), and the Copy's Platform and Account must
 * still exist, since a delete may be racing us. Validation is the caller's job (rules.ts).
 * `copyExtra` holds stored-only Copy fields (an Import's `steamAppId`). `fill` overwrites an
 * existing Copy (an Unknown Copy being filled in) instead of adding one.
 */
export async function writeCopy(
  ctx: Ctx,
  w: { read?: GameRec; next: GameRec; copy: KnownCopy; copyExtra?: Rec; fill?: boolean },
) {
  const { read, next, copy } = w;
  const mustExist = (SK: string) => ({
    ConditionCheck: { TableName: TABLE, Key: { PK: ownerPk(ctx), SK }, ConditionExpression: "attribute_exists(PK)" },
  });
  const copyPut = putNew(ctx, copyItem(next.id, copy, w.copyExtra));
  if (w.fill) copyPut.Put.ConditionExpression = "attribute_exists(PK)";
  const items: NonNullable<TransactWriteCommandInput["TransactItems"]> = [];
  items[COPY_TX.game] = read ? putGameIfUnchanged(ctx, read, next) : putNewGame(ctx, next);
  items[COPY_TX.copy] = copyPut;
  items[COPY_TX.platform] = mustExist(platformSk(copy.platformId));
  if (copy.accountId) items[COPY_TX.account] = mustExist(accountSk(copy.accountId));
  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: items }));
  } catch (e) {
    const codes = cancellationCodes(e);
    if (failedAt(codes, COPY_TX.platform)) throw new UserError("NotFound", "No such Platform");
    if (failedAt(codes, COPY_TX.account)) throw new UserError("NotFound", "No such Account");
    if (codes) throw changedMeanwhile();
    throw e;
  }
}

/**
 * Give an Unknown Copy its Platform and Format (and Account if Digital), keeping its id. The same
 * rules and checks as addCopy; Owned, Wishlist and Play status don't change since it was already
 * a Copy.
 */
export async function fillUnknownCopy(ctx: Ctx, args: CopyInput & { gameId: string; copyId: string }) {
  const valid = validateCopyInput(args);
  const { game, copies } = await loadGame(ctx, args.gameId);
  const unknown = copies.find((c) => c.id === args.copyId);
  if (!unknown) throw new UserError("NotFound", "No such Copy on this Game");
  if (!isUnknownCopy(unknown)) {
    throw new UserError("ValidationError", "That Copy's location is already known; remove it and add a new Copy instead");
  }
  const copy: KnownCopy = { ...unknown, ...(await copyPlace(ctx, args, valid)), edition: valid.edition ?? unknown.edition };
  const next: GameRec = { ...game, updatedAt: nextUpdatedAt(game) };
  await writeCopy(ctx, { read: game, next, copy, fill: true });
  return gameOut(next, copies.map((c) => (c.id === copy.id ? copy : c)));
}

export async function removeCopy(ctx: Ctx, args: { gameId: string; copyId: string }) {
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

export async function setPlayStatus(ctx: Ctx, args: { gameId: string; playStatus?: string | null }) {
  const playStatus = validatePlayStatus(args.playStatus);
  const { game, copies } = await loadGame(ctx, args.gameId);
  const next: GameRec = { ...game, playStatus, updatedAt: nextUpdatedAt(game) };
  await saveGame(ctx, game, next);
  return gameOut(next, copies);
}

export async function setWishlist(ctx: Ctx, args: { gameId: string; wishlist: boolean }) {
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
export async function saveGame(ctx: Ctx, read: GameRec, next: GameRec) {
  try {
    await ddb.send(new PutCommand(putGameIfUnchanged(ctx, read, next).Put));
  } catch (e) {
    if ((e as Error).name === "ConditionalCheckFailedException") throw changedMeanwhile();
    throw e;
  }
}
