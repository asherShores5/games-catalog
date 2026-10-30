// Seed: the one-time load of the Notion "Gaming catalog" page.
//
// Not a resolver: scripts/seed.ts calls this in-process for one explicit owner (ticket 12 runs it
// against prod). It writes the same records the resolvers do, each Game atomically with its
// Unknown Copy, and skips any row whose Game is already in the catalog (by seedKey), so a re-run
// (or a run after a partial failure) adds only what is missing and never touches existing Games.
import { randomUUID } from "node:crypto";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { Copy } from "@games/shared";
import { TABLE, gameSk, ddb, ownerPk, type Ctx } from "./db";
import { allGames, putNewCopy, type GameRec } from "./games";
import { UserError } from "./rules";
import { parseSeedRows, seedKey, seedState } from "./seed";

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
