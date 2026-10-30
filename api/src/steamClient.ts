import type { SteamLibrary } from "./steam";
import { ssmKey, steamWebApi } from "./steamWebApi";

// The real Steam client is built on first Import, so other resolvers never touch SSM.
// The key's parameter NAME comes from the environment; the key itself only ever lives in memory.
let steamLibrary: SteamLibrary | undefined;

/** Test seam: swap the Steam client (see src/testing/fakeSteam.ts). Production never calls this. */
export function setSteamLibrary(library: SteamLibrary) {
  steamLibrary = library;
}

export function steam(): SteamLibrary {
  steamLibrary ??= steamWebApi({ getKey: ssmKey(process.env.STEAM_KEY_PARAM_NAME) });
  return steamLibrary;
}
