// Steam Import: the importSteam resolver.
//
// importSteam reads the Account's library through `steam()` and applies planSteamImport's
// steps. Every step is its own transaction through writeCopy (same guards as addCopy), so an
// Import that times out or hits a conflict part-way is safe to re-run: matching by Steam app ID
// makes the finished steps "already present". Imported Copies store `steamAppId`; manual Copies
// are never written by an Import, except a lone Unknown Copy, which is filled in (planSteamImport).
import { randomUUID } from "node:crypto";
import {
  STEAM_PLATFORM, accountLabel, afterCopyAdded, byName, importTags, samePlatformName,
  type Copy, type Platform, type SteamImportSummary,
} from "@games/shared";
import type { Ctx } from "./db";
import { accountOut, getAccountRec } from "./accounts";
import { catalog, gameOut, nextUpdatedAt, saveGame, writeCopy, type GameRec, type KnownCopy } from "./games";
import { addPlatform, allPlatforms } from "./platforms";
import { UserError, validateCopyAccount } from "./rules";
import { SteamError } from "./steam";
import { steam } from "./steamClient";
import { planSteamImport, type ImportStep } from "./steamImport";
import { lookUpStoreTags, storeTagCandidates } from "./storeTags";
import { tagState } from "./tags";

const IMPORT_CONCURRENCY = 8;
/**
 * No step starts later than this into an Import. The Lambda has 25s; a started step is one
 * transaction (well under a second), so 20s leaves room for the ones in flight.
 */
const IMPORT_BUDGET_MS = 20_000;

/** The Platform Steam Copies land on: the owner's "PC", re-created if they deleted it. */
async function steamPlatform(ctx: Ctx): Promise<Platform> {
  const pc = (await allPlatforms(ctx)).find((p) => samePlatformName(p.name, STEAM_PLATFORM));
  return pc ?? addPlatform(ctx, { name: STEAM_PLATFORM });
}

function steamUserError(e: SteamError): UserError {
  return new UserError("SteamError", e.message);
}

type StepOutcome = "added" | "present";

/** Apply one plan step. Returns what it did and the Game it concerns. */
async function applyStep(
  ctx: Ctx,
  step: ImportStep,
  env: { games: Map<string, { game: GameRec; copies: Copy[] }>; platform: Platform; accountId: string },
  /** Tag ids from the app's store page, when this Import looked it up. */
  storeTagIds?: string[],
): Promise<{ outcome: StepOutcome; gameId: string; name: string }> {
  // Store Tags ride in the same Game write as the Copy (or the Steam app ID link). importTags
  // skips Tags already linked (Manual stays Manual) and Tags I removed from this Game.
  const withStoreTags = (g: GameRec): GameRec =>
    storeTagIds ? { ...g, ...importTags(tagState(g), storeTagIds), storeTagsAt: Date.now() } : g;
  const newCopy = (): KnownCopy => ({ id: randomUUID(), platformId: env.platform.id, format: "Digital", accountId: env.accountId, createdAt: Date.now() });
  const copyExtra = { steamAppId: step.app.appId };

  if (step.kind === "newGame") {
    const now = Date.now();
    const next = withStoreTags({ id: randomUUID(), name: step.name, wishlist: false, playStatus: null, steamAppId: step.app.appId, createdAt: now, updatedAt: now });
    await writeCopy(ctx, { next, copy: newCopy(), copyExtra });
    return { outcome: "added", gameId: next.id, name: next.name };
  }

  // The stored record, so Tags, Tag removals and any other private field survive the rewrite.
  const { game: read, copies } = env.games.get(step.gameId)!;
  const steamAppId = step.link ? step.app.appId : read.steamAppId;
  if (step.kind === "present") {
    // Nothing to add. A manual Game matched by name still learns its Steam app ID, so later
    // Imports find it by ID. Store Tags (if looked up) land in the same write.
    // A repeat step (a merged Game's second app ID) never writes: the Game's first step does.
    if (!step.repeat && (step.link || storeTagIds)) await saveGame(ctx, read, withStoreTags({ ...read, steamAppId, updatedAt: nextUpdatedAt(read) }));
    return { outcome: "present", gameId: read.id, name: read.name };
  }
  if (step.kind === "fillUnknown") {
    // Same write as fillUnknownCopy: the Copy keeps its id (and Edition); Owned, Wishlist and
    // Play status don't change since it was already a Copy.
    const unknown = copies.find((c) => c.id === step.copyId)!;
    const copy: KnownCopy = { ...unknown, platformId: env.platform.id, format: "Digital", accountId: env.accountId };
    await writeCopy(ctx, { read, next: withStoreTags({ ...read, steamAppId, updatedAt: nextUpdatedAt(read) }), copy, copyExtra, fill: true });
    return { outcome: "added", gameId: read.id, name: read.name };
  }
  const next = withStoreTags({ ...read, ...afterCopyAdded(read), steamAppId, updatedAt: nextUpdatedAt(read) });
  await writeCopy(ctx, { read, next, copy: newCopy(), copyExtra });
  return { outcome: "added", gameId: read.id, name: read.name };
}

/** Run `fn` over `items`, at most `limit` at a time. */
async function inPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export async function importSteam(ctx: Ctx, args: { accountId: string }): Promise<SteamImportSummary> {
  const started = Date.now();
  const rec = await getAccountRec(ctx, args.accountId);
  const account = accountOut(rec);
  if (account.store !== "Steam") throw new UserError("ValidationError", "Only a Steam Account can import from Steam");
  const steamId = rec.steamId;
  if (typeof steamId !== "string") throw new UserError("ValidationError", `Set a Steam ID on "${accountLabel(account)}" first`);
  // Same rule every Digital Copy goes through (rules.ts); the Account itself is checked in writeCopy.
  const accountId = validateCopyAccount("Digital", account.id)!;

  let library;
  try {
    library = await steam().ownedGames(steamId);
  } catch (e) {
    if (e instanceof SteamError) throw steamUserError(e);
    throw e;
  }

  const platform = await steamPlatform(ctx);
  const games = await catalog(ctx);
  const steps = planSteamImport(library, games.map((c) => ({ ...gameOut(c.game, c.copies), mergedSteamAppIds: c.game.mergedSteamAppIds })), accountId);
  const env = { games: new Map(games.map((c) => [c.game.id, c])), platform, accountId };

  const wanted = storeTagCandidates(steps, env.games);
  const storeTags = await lookUpStoreTags(ctx, wanted, started);

  const summary: SteamImportSummary = { added: 0, alreadyPresent: 0, failed: 0, addedNames: [], tagged: 0, tagsPending: 0 };
  // Each step touches a different Game (planSteamImport claims a Game for at most one app), so
  // steps can run side by side without racing each other's `updatedAt` guard.
  await inPool(steps, IMPORT_CONCURRENCY, async (step) => {
    // Out of time: leave the rest for the next run (counted as failed, which re-running retries).
    if (Date.now() - started >= IMPORT_BUDGET_MS) {
      summary.failed++;
      return;
    }
    try {
      const tagIds = storeTags.get(step.app.appId);
      const r = await applyStep(ctx, step, env, tagIds);
      if (r.outcome === "added") {
        summary.added++;
        summary.addedNames.push(r.name);
      } else summary.alreadyPresent++;
      if (tagIds) summary.tagged++;
    } catch (e) {
      // Logged without Steam data: these are DynamoDB or our own errors, never the Steam ID.
      if (!(e instanceof UserError)) console.error(e);
      summary.failed++;
    }
  });
  summary.addedNames.sort((a, b) => byName({ name: a }, { name: b }));
  summary.tagsPending = wanted.length - summary.tagged;
  return summary;
}
