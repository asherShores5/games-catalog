// Places: named groups of Platforms by where I play. `SK = PLACE#<id>` holds `{ id, name, platformIds }`.
// A Platform can be in several Places. Deleting a Platform leaves its id in a Place's list; the
// list read drops ids that aren't Platforms any more, so nothing needs rewriting.
import { randomUUID } from "node:crypto";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { PLACE_PLATFORMS_MAX, byName, type Place } from "@games/shared";
import { ddb, deleteRecord, getOwned, placeSk, putNew, queryPrefix, setFields, type Ctx, type Rec } from "./db";
import { allPlatforms, getPlatform } from "./platforms";
import { UserError, validatePlaceName } from "./rules";

const placeOut = (rec: Rec, platformIds: Set<string>): Place => ({
  id: rec.id as string,
  name: rec.name as string,
  platformIds: ((rec.platformIds as string[] | undefined) ?? []).filter((id) => platformIds.has(id)),
});

/** The owner's Places in name order, each listing only Platforms that still exist. */
export async function allPlaces(ctx: Ctx): Promise<Place[]> {
  const [recs, platforms] = await Promise.all([queryPrefix(ctx, "PLACE#"), allPlatforms(ctx)]);
  const ids = new Set(platforms.map((p) => p.id));
  return recs.map((r) => placeOut(r, ids)).sort(byName);
}

async function getPlace(ctx: Ctx, id: unknown): Promise<Place> {
  const rec = await getOwned(ctx, id, placeSk, "Place");
  return placeOut(rec, new Set((await allPlatforms(ctx)).map((p) => p.id)));
}

export async function addPlace(ctx: Ctx, args: { name: string }) {
  const name = validatePlaceName(args.name, await allPlaces(ctx));
  const place: Place = { id: randomUUID(), name, platformIds: [] };
  await ddb.send(new PutCommand(putNew(ctx, { SK: placeSk(place.id), ...place }).Put));
  return place;
}

export async function renamePlace(ctx: Ctx, args: { id: string; name: string }) {
  const place = await getPlace(ctx, args.id);
  const name = validatePlaceName(args.name, await allPlaces(ctx), place.id);
  await setFields(ctx, placeSk(place.id), { name });
  return { ...place, name };
}

/** Replace a Place's Platforms (each once, in the order given). Every id must be one of my Platforms. */
export async function setPlacePlatforms(ctx: Ctx, args: { id: string; platformIds: unknown }) {
  const place = await getPlace(ctx, args.id);
  if (!Array.isArray(args.platformIds) || args.platformIds.length > PLACE_PLATFORMS_MAX) {
    throw new UserError("ValidationError", `A Place holds a list of up to ${PLACE_PLATFORMS_MAX} Platforms`);
  }
  const platformIds = [...new Set(args.platformIds)];
  for (const id of platformIds) await getPlatform(ctx, id);
  await setFields(ctx, placeSk(place.id), { platformIds });
  return { ...place, platformIds: platformIds as string[] };
}

export async function deletePlace(ctx: Ctx, args: { id: string }) {
  const place = await getPlace(ctx, args.id);
  await deleteRecord(ctx, placeSk(place.id));
  return place.id;
}
