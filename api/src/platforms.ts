// Platforms: an editable list, seeded with common ones. `SK = PLATFORM#<id>` holds `{ id, name }`.
import { randomUUID } from "node:crypto";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { SEED_PLATFORMS, byName, type Platform } from "@games/shared";
import { ddb, deleteRecord, getOwned, idAndName, platformSk, putNew, queryPrefix, refuseIfCopiesUse, seedOnce, setFields, type Ctx } from "./db";
import { validatePlatformName } from "./rules";

const PLATFORMS_SEEDED_SK = "META#platformsSeeded";

/** Seed SEED_PLATFORMS the first time any Platform call runs (once: deleted seeds stay deleted). */
async function ensurePlatforms(ctx: Ctx) {
  await seedOnce(ctx, PLATFORMS_SEEDED_SK, SEED_PLATFORMS.map((name) => {
    const id = randomUUID();
    return { SK: platformSk(id), id, name };
  }));
}

/** The owner's Platforms in name order. */
export async function allPlatforms(ctx: Ctx): Promise<Platform[]> {
  await ensurePlatforms(ctx);
  return (await queryPrefix(ctx, "PLATFORM#")).map(idAndName).sort(byName);
}

export async function getPlatform(ctx: Ctx, id: unknown): Promise<Platform> {
  await ensurePlatforms(ctx);
  return idAndName(await getOwned(ctx, id, platformSk, "Platform"));
}

export async function addPlatform(ctx: Ctx, args: { name: string }) {
  const name = validatePlatformName(args.name, await allPlatforms(ctx));
  const platform: Platform = { id: randomUUID(), name };
  await ddb.send(new PutCommand(putNew(ctx, { SK: platformSk(platform.id), ...platform }).Put));
  return platform;
}

export async function renamePlatform(ctx: Ctx, args: { id: string; name: string }) {
  const platform = await getPlatform(ctx, args.id);
  const name = validatePlatformName(args.name, await allPlatforms(ctx), platform.id);
  await setFields(ctx, platformSk(platform.id), { name });
  return { ...platform, name };
}

export async function deletePlatform(ctx: Ctx, args: { id: string }) {
  const platform = await getPlatform(ctx, args.id);
  await refuseIfCopiesUse(ctx, (copy) => copy.platformId === platform.id, `Platform "${platform.name}"`);
  await deleteRecord(ctx, platformSk(platform.id));
  return platform.id;
}
