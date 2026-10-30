// The Steam boundary. The Import talks to Steam only through `SteamLibrary`, so tests swap in a
// fake (src/testing/fakeSteam.ts) and the real client (steamWebApi.ts) is the only code that
// knows URLs and the API key.

/** One entry of a Steam library (GetOwnedGames with app info). */
export interface SteamOwnedGame {
  appId: number;
  name: string;
}

export interface SteamLibrary {
  /** Every game the Steam ID owns. Throws SteamError when Steam can't or won't say. */
  ownedGames(steamId: string): Promise<SteamOwnedGame[]>;
  /**
   * One app's store page Categories and Genres (English names), or null when the store has no
   * page for it (delisted, region-locked). Needs no key. Throws SteamError "rateLimited" when
   * the store says slow down, "unavailable" for any other failure.
   */
  appDetails(appId: number): Promise<SteamAppDetails | null>;
}

/** The parts of a store page an Import turns into Tags. */
export interface SteamAppDetails {
  categories: string[];
  genres: string[];
}

export type SteamErrorKind = "noKey" | "keyRejected" | "private" | "badSteamId" | "unavailable" | "rateLimited";

/**
 * A Steam failure the owner can act on. Messages are fixed strings: they never carry the API
 * key, the Steam ID or a request URL, because the handler logs and returns them.
 */
export class SteamError extends Error {
  name = "SteamError";
  constructor(public kind: SteamErrorKind, message: string) {
    super(message);
  }
}
