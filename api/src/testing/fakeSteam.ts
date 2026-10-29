// In-memory stand-in for the Steam Web API (no network in tests). Set a library per Steam ID,
// or an error to make the next Import fail the way Steam would.
import { SteamError, type SteamLibrary, type SteamOwnedGame } from "../steam";

export class FakeSteamLibrary implements SteamLibrary {
  private libraries = new Map<string, SteamOwnedGame[] | SteamError>();
  /** Steam IDs asked for, in order. */
  calls: string[] = [];

  reset() {
    this.libraries.clear();
    this.calls = [];
  }

  /** What Steam returns for this Steam ID: its owned games, or an error. */
  set(steamId: string, games: SteamOwnedGame[] | SteamError) {
    this.libraries.set(steamId, games);
  }

  async ownedGames(steamId: string): Promise<SteamOwnedGame[]> {
    this.calls.push(steamId);
    const r = this.libraries.get(steamId);
    if (r instanceof SteamError) throw r;
    if (!r) throw new SteamError("badSteamId", "Steam has no profile with that Steam ID");
    return structuredClone(r);
  }
}
