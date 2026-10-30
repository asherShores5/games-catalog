// Tags and Game-Tag links.
//
// `SK = TAG#<id>` holds `{ id, name }`: one shared list for manual and imported Tags. Seeded once
// per owner like Platforms (marker `META#tagsSeeded`).
import { randomUUID } from "node:crypto";
import { DeleteCommand, GetCommand, PutCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  SEED_TAGS, addManualTag, addTagNames, byName, dropTag, mentionsTag, moveTag, removeGameTag as unlinkTag, sameTagName,
  type GameTags, type ImportableTag, type Tag,
} from "@games/shared";
import { TABLE, TRANSACT_MAX, cancellationCodes, ddb, isCopyRec, ownerPk, queryPrefix, tagSk, type Ctx, type Rec } from "./db";
import { changedMeanwhile, gameOut, gameRec, loadGame, nextUpdatedAt, putGameIfUnchanged, saveGame, type GameRec } from "./games";
import { UserError, validateTagName } from "./rules";

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

/**
 * The stored Tag: its private `aliases` (former names, merged-away names, for Imports) and
 * `retiring` (a delete or merge started and hasn't finished).
 */
interface TagRec extends ImportableTag {
  retiring: boolean;
}

function importableTag(rec: Rec): TagRec {
  return { ...tagOut(rec), aliases: (rec.aliases as string[] | undefined) ?? [], retiring: rec.retiring === true };
}

export async function allTagRecs(ctx: Ctx): Promise<TagRec[]> {
  await ensureTags(ctx);
  return (await queryPrefix(ctx, "TAG#")).map(importableTag);
}

async function allTags(ctx: Ctx) {
  return (await allTagRecs(ctx)).map(({ id, name }): Tag => ({ id, name })).sort(byName);
}

async function getTagRec(ctx: Ctx, id: unknown): Promise<TagRec> {
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

export async function droppedTagNames(ctx: Ctx): Promise<string[]> {
  return (await queryPrefix(ctx, DROPPED_TAG_PREFIX)).map((r) => r.name as string);
}

export async function tags(ctx: Ctx) {
  return allTags(ctx);
}

async function getTag(ctx: Ctx, id: unknown): Promise<Tag> {
  if (typeof id !== "string") throw new UserError("NotFound", "No such Tag");
  await ensureTags(ctx);
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: ownerPk(ctx), SK: tagSk(id) } }));
  if (!r.Item) throw new UserError("NotFound", "No such Tag");
  return tagOut(r.Item);
}

export async function addTag(ctx: Ctx, args: { name: string }) {
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
export async function renameTag(ctx: Ctx, args: { id: string; name: string }) {
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
 * is marked retiring and before its record goes: addGameTag conditions on the Tag existing and
 * not retiring, so no new link can land behind the scan, and if a rewrite gives up the Tag is
 * still there (no Game points at a missing Tag) and the delete or merge can simply be re-run.
 * Each Game write keeps the changed-since-read guard; a Game that changes meanwhile is re-read
 * and retried.
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
export async function deleteTag(ctx: Ctx, args: { id: string }) {
  const tag = await getTagRec(ctx, args.id);
  await markRetiring(ctx, tag.id);
  await rewriteGamesMentioning(ctx, tag.id, (g) => dropTag(g, tag.id));
  const dropped = addTagNames([], tag.name, ...tag.aliases);
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        { Delete: { TableName: TABLE, Key: { PK: ownerPk(ctx), SK: tagSk(tag.id) } } },
        // One record per name; a Tag with more aliases than a transaction holds forgets the rest.
        ...dropped.map((name) => ({ Put: { TableName: TABLE, Item: { PK: ownerPk(ctx), SK: droppedTagSk(name), name } } })),
      ].slice(0, TRANSACT_MAX),
    }),
  );
  return tag.id;
}

/** A Tag on its way out (delete or merge): no new links may land on it. Re-running the delete or merge finishes it. */
async function markRetiring(ctx: Ctx, tagId: string) {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: ownerPk(ctx), SK: tagSk(tagId) },
      UpdateExpression: "SET retiring = :t",
      ConditionExpression: "attribute_exists(PK)",
      ExpressionAttributeValues: { ":t": true },
    }),
  );
}

/**
 * Merge Tag `fromId` into `intoId`: its links move (deduped, Manual winning) and it's deleted.
 * Its name and aliases become aliases of `intoId`, so Imports bringing them land there.
 */
export async function mergeTags(ctx: Ctx, args: { fromId: string; intoId: string }) {
  const from = await getTagRec(ctx, args.fromId);
  const into = await getTagRec(ctx, args.intoId);
  if (from.id === into.id) throw new UserError("ValidationError", "Pick two different Tags to merge");
  if (into.retiring) throw new UserError("ValidationError", `"${into.name}" is being deleted; finish that first`);
  await markRetiring(ctx, from.id);
  await setTagAliases(ctx, into, addTagNames(into.aliases, from.name, ...from.aliases));
  await rewriteGamesMentioning(ctx, from.id, (g) => moveTag(g, from.id, into.id));
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: ownerPk(ctx), SK: tagSk(from.id) } }));
  return { id: into.id, name: into.name };
}

export const tagState = (game: GameRec): GameTags => ({ tags: game.tags ?? [], removedTagIds: game.removedTagIds ?? [] });

/** I add a Tag to a Game: a Manual link (an imported link becomes Manual). */
export async function addGameTag(ctx: Ctx, args: { gameId: string; tagId: string }) {
  const { game, copies } = await loadGame(ctx, args.gameId);
  const tag = await getTag(ctx, args.tagId);
  const next: GameRec = { ...game, ...addManualTag(tagState(game), tag.id), updatedAt: nextUpdatedAt(game) };
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          putGameIfUnchanged(ctx, game, next),
          // The Tag must still exist, and not be on its way out, when the link lands: a delete or
          // merge may be racing us.
          {
            ConditionCheck: {
              TableName: TABLE,
              Key: { PK: ownerPk(ctx), SK: tagSk(tag.id) },
              ConditionExpression: "attribute_exists(PK) AND attribute_not_exists(retiring)",
            },
          },
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
export async function removeGameTag(ctx: Ctx, args: { gameId: string; tagId: string }) {
  const { game, copies } = await loadGame(ctx, args.gameId);
  if (!tagState(game).tags.some((t) => t.tagId === args.tagId)) return gameOut(game, copies);
  const next: GameRec = { ...game, ...unlinkTag(tagState(game), args.tagId), updatedAt: nextUpdatedAt(game) };
  await saveGame(ctx, game, next);
  return gameOut(next, copies);
}
