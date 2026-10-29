// Steam Import planning: pure (no AWS, no Steam). Given the library and the catalog as read,
// decide per library entry what the Import does. handler.ts's importSteam applies the plan.
import { cleanGameName, isUnknownCopy, searchKey, type Game } from "@games/shared";
import type { SteamOwnedGame } from "./steam";

/** A Game as the Import plans with it: the API Game plus the private Steam app IDs a Merge kept. */
export type ImportableGame = Game & { mergedSteamAppIds?: number[] };

/** What happens to one library entry. Every step names the Steam app it came from. */
export type ImportStep =
  /** The target Game already has a Copy on this Account (imported earlier, or added by hand). */
  | { kind: "present"; app: SteamOwnedGame; gameId: string; link: boolean }
  /** A Game whose only Copy is an Unknown Copy (from the Seed): that Copy becomes the Steam Copy. */
  | { kind: "fillUnknown"; app: SteamOwnedGame; gameId: string; copyId: string; link: boolean }
  /** An existing Game gets a Digital Copy on this Account. */
  | { kind: "addCopy"; app: SteamOwnedGame; gameId: string; link: boolean }
  /** A new Game with a Digital Copy on this Account. */
  | { kind: "newGame"; app: SteamOwnedGame; name: string };
// `link` = the Game has no Steam app ID yet (a manual Game matched by name) and gets this one.

/** The name a new Game gets: Steam's, or a placeholder when Steam has none (delisted apps). */
export const importName = (app: SteamOwnedGame) => cleanGameName(app.name) ?? `Steam app ${app.appId}`;

/**
 * Match each Steam app to a Game:
 * 1. a Game already carrying that Steam app ID (an earlier Import, from any Steam Account);
 * 2. else a manual Game (no Steam app ID) with the same normalised name (searchKey), oldest
 *    first, each claimed by at most one app;
 * 3. else a new Game.
 * A matched Game that already has a Copy on this Account is "present". A matched Game whose ONLY
 * Copy is an Unknown Copy has it filled in (the Seed knew it was owned, Steam says where); with
 * other Copies too, the Unknown Copy is left alone and a Copy is added. Other Copies are never
 * changed. Duplicate app IDs in the library are counted once.
 */
export function planSteamImport(library: SteamOwnedGame[], games: ImportableGame[], accountId: string): ImportStep[] {
  const byAppId = new Map<number, Game>();
  const manualByName = new Map<string, Game[]>();
  for (const g of [...games].sort((a, b) => a.createdAt - b.createdAt)) {
    // A merged Game also matches the other Games' Steam app IDs (Merge Games, ticket 09).
    for (const id of g.mergedSteamAppIds ?? []) byAppId.set(id, g);
    if (g.steamAppId !== undefined) byAppId.set(g.steamAppId, g);
    else manualByName.set(searchKey(g.name), [...(manualByName.get(searchKey(g.name)) ?? []), g]);
  }

  const seen = new Set<number>();
  // Two app IDs can lead to one merged Game: only the first may write it (steps run in parallel).
  const claimed = new Set<string>();
  const steps: ImportStep[] = [];
  for (const app of library) {
    if (seen.has(app.appId)) continue;
    seen.add(app.appId);

    let game = byAppId.get(app.appId);
    const link = game === undefined;
    if (!game) {
      const key = searchKey(importName(app));
      const candidates = key ? manualByName.get(key) : undefined;
      game = candidates?.shift();
    }
    if (!game) {
      steps.push({ kind: "newGame", app, name: importName(app) });
      continue;
    }
    const again = claimed.has(game.id);
    claimed.add(game.id);
    if (again || game.copies.some((c) => c.accountId === accountId)) {
      steps.push({ kind: "present", app, gameId: game.id, link });
    } else if (game.copies.length === 1 && isUnknownCopy(game.copies[0])) {
      steps.push({ kind: "fillUnknown", app, gameId: game.id, copyId: game.copies[0].id, link });
    } else {
      steps.push({ kind: "addCopy", app, gameId: game.id, link });
    }
  }
  return steps;
}
