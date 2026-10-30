// Steam Import: store Tags.
//
// Each Import-touched Game's store page (Categories + Genres, no key needed) becomes Import Tags
// via storeTagNames. The store is rate-limited (roughly 200 requests per 5 minutes) and the
// Lambda has 25s, so lookups run one at a time (the real client spaces them out), at most
// STORE_TAGS_CAP per Import and none started after STORE_TAGS_BUDGET_MS. Games never looked up
// go first, then ones looked up longest ago (refresh after STORE_TAGS_REFRESH_MS); the rest wait
// for the next Import (summary.tagsPending). A failed lookup only leaves its Game pending; a
// "slow down" from the store ends the lookups for this Import.
import { randomUUID } from "node:crypto";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { matchImportTag, storeTagNames, type ImportableTag, type Tag } from "@games/shared";
import { TABLE, TRANSACT_MAX, ddb, ownerPk, tagSk, type Ctx } from "./db";
import type { GameRec } from "./games";
import { UserError, validateTagName } from "./rules";
import { SteamError } from "./steam";
import { steam } from "./steamClient";
import type { ImportStep } from "./steamImport";
import { allTagRecs, droppedTagNames } from "./tags";

const STORE_TAGS_CAP = 40;
const STORE_TAGS_BUDGET_MS = 12_000;
const STORE_TAGS_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;

/** The steps whose Game needs a store Tag lookup, in lookup order. */
export function storeTagCandidates(steps: ImportStep[], games: Map<string, { game: GameRec }>): ImportStep[] {
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
export async function lookUpStoreTags(ctx: Ctx, steps: ImportStep[], started: number): Promise<Map<number, string[]>> {
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
  // A Tag being deleted or merged away takes no new links, and its names count as dropped.
  const recs = await allTagRecs(ctx);
  const known: ImportableTag[] = recs.filter((t) => !t.retiring);
  const dropped = [...(await droppedTagNames(ctx)), ...recs.filter((t) => t.retiring).flatMap((t) => [t.name, ...t.aliases])];
  // The Tag list is read once; new Tags are checked against it (and each other) and written together.
  const created: Tag[] = [];
  const tagIdFor = (name: string) => {
    const match = matchImportTag(name, known, dropped);
    if ("tagId" in match) return match.tagId;
    if ("skip" in match) return undefined;
    let clean: string;
    try {
      clean = validateTagName(match.create, known);
    } catch (e) {
      // A Tag name the rules refuse: skip that Tag, keep the rest.
      if (!(e instanceof UserError)) throw e;
      return undefined;
    }
    const tag: Tag = { id: randomUUID(), name: clean };
    created.push(tag);
    known.push({ ...tag, aliases: [] });
    return tag.id;
  };
  const out = new Map<number, string[]>();
  for (const [appId, list] of names) {
    const ids: string[] = [];
    for (const name of list) {
      const id = tagIdFor(name);
      if (id && !ids.includes(id)) ids.push(id);
    }
    out.set(appId, ids);
  }
  await putNewTags(ctx, created);
  return out;
}

/** Write brand-new Tag records, up to a transaction's worth per call. */
async function putNewTags(ctx: Ctx, tags: Tag[]) {
  for (let i = 0; i < tags.length; i += TRANSACT_MAX) {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: tags.slice(i, i + TRANSACT_MAX).map((tag) => ({
          Put: { TableName: TABLE, Item: { PK: ownerPk(ctx), SK: tagSk(tag.id), ...tag }, ConditionExpression: "attribute_not_exists(PK)" },
        })),
      }),
    );
  }
}
