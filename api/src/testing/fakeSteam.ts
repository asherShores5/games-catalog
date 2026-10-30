// In-memory stand-in for the Steam Web API and store (no network in tests). Set a library per
// Steam ID, or an error to make the next Import fail the way Steam would; set store details per
// app (an app with none set has no store page).
import { SteamError, type SteamAppDetails, type SteamLibrary, type SteamOwnedGame } from "../steam";

export class FakeSteamLibrary implements SteamLibrary {
  private libraries = new Map<string, SteamOwnedGame[] | SteamError>();
  private details = new Map<number, SteamAppDetails | null | SteamError>();
  /** Steam IDs asked for, in order. */
  calls: string[] = [];
  /** App IDs whose store details were asked for, in order. */
  detailCalls: number[] = [];
  /** Runs before each store details answer (tests use it to move a fake clock). */
  onDetails?: (appId: number) => void;

  reset() {
    this.libraries.clear();
    this.details.clear();
    this.calls = [];
    this.detailCalls = [];
    this.onDetails = undefined;
  }

  /** What Steam returns for this Steam ID: its owned games, or an error. */
  set(steamId: string, games: SteamOwnedGame[] | SteamError) {
    this.libraries.set(steamId, games);
  }

  /** What the store says about one app: its Categories/Genres, no page (null), or an error. */
  setDetails(appId: number, details: SteamAppDetails | null | SteamError) {
    this.details.set(appId, details);
  }

  async ownedGames(steamId: string): Promise<SteamOwnedGame[]> {
    this.calls.push(steamId);
    const r = this.libraries.get(steamId);
    if (r instanceof SteamError) throw r;
    if (!r) throw new SteamError("badSteamId", "Steam has no profile with that Steam ID");
    return structuredClone(r);
  }

  async appDetails(appId: number): Promise<SteamAppDetails | null> {
    this.detailCalls.push(appId);
    this.onDetails?.(appId);
    const r = this.details.get(appId) ?? null;
    if (r instanceof SteamError) throw r;
    return structuredClone(r);
  }
}
