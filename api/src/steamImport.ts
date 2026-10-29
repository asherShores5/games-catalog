// Steam Import planning: pure (no AWS, no Steam). Given the library and the catalog as read,
// decide per library entry what the Import does. handler.ts's importSteam applies the plan.
import { cleanGameName, searchKey, type Game } from "@games/shared";
import type { SteamOwnedGame } from "./steam";

/** What happens to one library entry. Every step names the Steam app it came from. */
export type ImportStep =
  /** The target Game already has a Copy on this Account (imported earlier, or added by hand). */
  | { kind: "present"; app: SteamOwnedGame; gameId: string; link: boolean }
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
 * A matched Game that already has a Copy on this Account is "present"; manual Copies are never
 * changed. Duplicate app IDs in the library are counted once.
 */
export function planSteamImport(library: SteamOwnedGame[], games: Game[], accountId: string): ImportStep[] {
  const byAppId = new Map<number, Game>();
  const manualByName = new Map<string, Game[]>();
  for (const g of [...games].sort((a, b) => a.createdAt - b.createdAt)) {
    if (g.steamAppId !== undefined) byAppId.set(g.steamAppId, g);
    else manualByName.set(searchKey(g.name), [...(manualByName.get(searchKey(g.name)) ?? []), g]);
  }

  const seen = new Set<number>();
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
    const present = game.copies.some((c) => c.accountId === accountId);
    steps.push({ kind: present ? "present" : "addCopy", app, gameId: game.id, link });
  }
  return steps;
}
