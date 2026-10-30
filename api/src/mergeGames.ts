// Merge Games.
//
// mergeGames folds Game `fromId` into Game `intoId` (planMerge in shared/merge.ts decides the
// result) in ONE transaction: the surviving Game Put and the other Game's Delete are both
// conditioned on the `updatedAt` read, so any racing write to either Game cancels the whole
// Merge. Each moved Copy is re-keyed from the STORED record (Put under the surviving Game, Delete
// the old key), so stored-only fields (an Import's `steamAppId`) and the Account move as they
// are; legacy Digital Copies with no Account aren't re-validated. Redundant Unknown Copies go.
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { planMerge, type MergeSide } from "@games/shared";
import { TABLE, TRANSACT_MAX, cancellationCodes, copyPrefix, ddb, gameSk, ownerPk, putNew, queryPrefix, type Ctx, type Rec } from "./db";
import { changedMeanwhile, copyOut, gameOut, getGameRec, nextUpdatedAt, putGameIfUnchanged, type GameRec } from "./games";
import { UserError, validatePlayStatus } from "./rules";

/** A Game with its STORED Copy records (stored-only fields included), for moving them. */
async function loadGameRecords(ctx: Ctx, id: unknown): Promise<{ game: GameRec; copyRecs: Rec[] }> {
  const game = await getGameRec(ctx, id);
  return { game, copyRecs: await queryPrefix(ctx, copyPrefix(game.id)) };
}

const mergeSide = (game: GameRec, copyRecs: Rec[]): MergeSide => ({ ...game, tags: game.tags ?? [], copies: copyRecs.map(copyOut) });

export async function mergeGames(ctx: Ctx, args: { fromId: string; intoId: string; playStatus?: string | null }) {
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
        : [putNew(ctx, { ...r, SK: copyPrefix(into.game.id) + (r.id as string), gameId: into.game.id }), del(r.SK)],
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
