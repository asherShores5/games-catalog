// The real Steam client: the Steam Web API's IPlayerService/GetOwnedGames, with the API key read
// from an SSM SecureString. The key and the Steam ID go into the request URL (Steam's documented way)
// and nowhere else: no logging here, and every error is a fixed-message SteamError, so neither
// can reach a log line or a client through an exception.
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { SteamError, type SteamLibrary, type SteamOwnedGame } from "./steam";

const OWNED_GAMES_URL = "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/";
const TIMEOUT_MS = 8000;

type Fetch = (url: string, init: { signal: AbortSignal }) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;

export interface SteamWebApiDeps {
  /** The Steam Web API key, or undefined when it isn't set up. */
  getKey: () => Promise<string | undefined>;
  /** Test seam; defaults to global fetch. */
  fetch?: Fetch;
  /** Test seams for spacing store calls; default to the real clock. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const noKey = () => new SteamError("noKey", "The Steam Web API key isn't set up yet (see docs/first-deploy.md)");

// The store's appdetails endpoint: unauthenticated, rate-limited per IP (about 200 requests per
// 5 minutes). Calls from one client are spaced STORE_GAP_MS apart; the Import caps how many it
// makes (handler.ts), so a burst stays well under the limit.
const APP_DETAILS_URL = "https://store.steampowered.com/api/appdetails";
const STORE_GAP_MS = 300;
const STORE_TIMEOUT_MS = 4000;

const unavailableStore = () => new SteamError("unavailable", "Couldn't read the Steam store page; try again later");

/** `[{ description: "Single-player" }, …]` -> names, skipping anything malformed. */
function descriptions(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((x) => {
    const d = (x ?? {}) as { description?: unknown };
    return typeof d.description === "string" ? [d.description] : [];
  });
}

export function steamWebApi(deps: SteamWebApiDeps): SteamLibrary {
  const doFetch: Fetch = deps.fetch ?? ((url, init) => fetch(url, init));
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastStoreCall: number | undefined;
  return {
    async appDetails(appId) {
      if (lastStoreCall !== undefined) {
        const wait = lastStoreCall + STORE_GAP_MS - now();
        if (wait > 0) await sleep(wait);
      }
      lastStoreCall = now();
      const url = new URL(APP_DETAILS_URL);
      url.search = new URLSearchParams({ appids: String(appId), l: "english", cc: "us", filters: "categories,genres" }).toString();

      let res;
      try {
        res = await doFetch(url.toString(), { signal: AbortSignal.timeout(STORE_TIMEOUT_MS) });
      } catch {
        throw unavailableStore();
      }
      // The store answers 429 (sometimes 403) when it wants us to slow down.
      if (res.status === 429 || res.status === 403) throw new SteamError("rateLimited", "The Steam store asked us to slow down; run the Import again later");
      if (!res.ok) throw unavailableStore();
      const body = (await res.json().catch(() => undefined)) as Record<string, { success?: unknown; data?: unknown }> | undefined;
      const entry = body && typeof body === "object" ? body[String(appId)] : undefined;
      if (!entry || typeof entry !== "object") throw unavailableStore();
      if (entry.success !== true) return null;
      const data = (entry.data ?? {}) as { categories?: unknown; genres?: unknown };
      return { categories: descriptions(data.categories), genres: descriptions(data.genres) };
    },

    async ownedGames(steamId) {
      const key = await deps.getKey();
      if (!key) throw noKey();
      const url = new URL(OWNED_GAMES_URL);
      url.search = new URLSearchParams({
        key, steamid: steamId, include_appinfo: "1", include_played_free_games: "1", format: "json",
      }).toString();

      let res;
      try {
        res = await doFetch(url.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch {
        // The thrown error can quote the URL (key included), so it is dropped, not wrapped.
        throw new SteamError("unavailable", "Couldn't reach Steam; try again later");
      }
      if (res.status === 401 || res.status === 403) throw new SteamError("keyRejected", "Steam rejected the Web API key; check the secret");
      if (res.status === 400) throw new SteamError("badSteamId", "Steam didn't accept this Account's Steam ID; check it on your Steam profile");
      if (!res.ok) throw new SteamError("unavailable", `Steam answered ${res.status}; try again later`);

      const body = (await res.json().catch(() => undefined)) as { response?: { game_count?: number; games?: unknown[] } } | undefined;
      const response = body?.response;
      if (!response) throw new SteamError("unavailable", "Steam sent an unexpected answer; try again later");
      // A private profile (or private game details) answers with an empty `response` object.
      if (response.game_count === undefined && response.games === undefined) {
        throw new SteamError("private", "Steam won't share this library: set Game details to Public in your Steam privacy settings");
      }
      return (response.games ?? []).flatMap((g): SteamOwnedGame[] => {
        const { appid, name } = (g ?? {}) as { appid?: unknown; name?: unknown };
        return typeof appid === "number" && Number.isInteger(appid) ? [{ appId: appid, name: typeof name === "string" ? name : "" }] : [];
      });
    },
  };
}

type ParamClient = Pick<SSMClient, "send">;

/**
 * Reads the key from the named SecureString parameter (just the key), once per Lambda container.
 * A missing name, missing parameter or empty value all mean "not set up". The Lambda's role can
 * read this one parameter only (infra/lib/stacks.ts). SSM rather than Secrets Manager: standard
 * parameters are free, a secret is $0.40 a month, and nothing here needs rotation.
 */
export function ssmKey(paramName: string | undefined, client?: ParamClient): () => Promise<string | undefined> {
  let cached: string | undefined;
  return async () => {
    if (cached) return cached;
    if (!paramName) return undefined;
    const ssm = client ?? new SSMClient({});
    try {
      const r = await ssm.send(new GetParameterCommand({ Name: paramName, WithDecryption: true }));
      cached = r.Parameter?.Value?.trim() || undefined;
      return cached;
    } catch (e) {
      if ((e as Error).name === "ParameterNotFound") return undefined;
      throw e;
    }
  };
}
