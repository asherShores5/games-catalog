// Platforms: an editable list, seeded with common ones.
import { randomUUID } from "node:crypto";
import { DeleteCommand, GetCommand, PutCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SEED_PLATFORMS, byName, type Platform } from "@games/shared";
import { TABLE, ddb, isCopyRec, ownerPk, platformSk, queryPrefix, type Ctx } from "./db";
import { UserError, validatePlatformName } from "./rules";

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

export async function allPlatforms(ctx: Ctx) {
  await ensurePlatforms(ctx);
  return (await queryPrefix(ctx, "PLATFORM#")).map(platformOut).sort(byName);
}

export async function platforms(ctx: Ctx) {
  return allPlatforms(ctx);
}

export async function getPlatform(ctx: Ctx, id: unknown): Promise<Platform> {
  if (typeof id !== "string") throw new UserError("NotFound", "No such Platform");
  await ensurePlatforms(ctx);
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: ownerPk(ctx), SK: platformSk(id) } }));
  if (!r.Item) throw new UserError("NotFound", "No such Platform");
  return platformOut(r.Item);
}

export async function addPlatform(ctx: Ctx, args: { name: string }) {
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

export async function renamePlatform(ctx: Ctx, args: { id: string; name: string }) {
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

export async function deletePlatform(ctx: Ctx, args: { id: string }) {
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
