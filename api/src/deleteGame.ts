// Delete a Game.
//
// deleteGame removes the Game and its Copies in ONE transaction, conditioned on the `updatedAt`
// read so a racing write cancels it. A Game from a Steam Import leaves a skip record per Steam
// app ID it matched (its own and any it absorbed in a Merge), so the next Import doesn't add it
// back. Adding the game again by hand still works; it just won't be linked to Steam.
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { TABLE, TRANSACT_MAX, cancellationCodes, copyPrefix, ddb, gameSk, ownerPk, queryPrefix, type Ctx } from "./db";
import { changedMeanwhile, getGameRec } from "./games";
import { UserError } from "./rules";

export const steamSkipSk = (appId: number) => `STEAMSKIP#${appId}`;

/** Steam app IDs whose Games I deleted: an Import leaves them out. */
export async function skippedSteamApps(ctx: Ctx): Promise<Set<number>> {
  return new Set((await queryPrefix(ctx, "STEAMSKIP#")).map((r) => r.appId as number));
}

export async function deleteGame(ctx: Ctx, args: { id: string }) {
  const game = await getGameRec(ctx, args.id);
  const copyRecs = await queryPrefix(ctx, copyPrefix(game.id));
  const appIds = [...new Set([game.steamAppId, ...(game.mergedSteamAppIds ?? [])].filter((x): x is number => typeof x === "number"))];
  const key = (SK: string) => ({ PK: ownerPk(ctx), SK });
  const items = [
    {
      Delete: {
        TableName: TABLE, Key: key(gameSk(game.id)),
        ConditionExpression: "updatedAt = :read",
        ExpressionAttributeValues: { ":read": game.updatedAt },
      },
    },
    ...copyRecs.map((r) => ({ Delete: { TableName: TABLE, Key: key(r.SK as string) } })),
    ...appIds.map((appId) => ({ Put: { TableName: TABLE, Item: { ...key(steamSkipSk(appId)), appId, name: game.name } } })),
  ];
  if (items.length > TRANSACT_MAX) throw new UserError("ValidationError", "Too many Copies to delete in one go; remove some first");
  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: items }));
  } catch (e) {
    if (cancellationCodes(e)) throw changedMeanwhile();
    throw e;
  }
  return game.id;
}
