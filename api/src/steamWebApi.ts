// The real Steam client: the Steam Web API's IPlayerService/GetOwnedGames, with the API key read
// from Secrets Manager. The key and the Steam ID go into the request URL (Steam's documented way)
// and nowhere else: no logging here, and every error is a fixed-message SteamError, so neither
// can reach a log line or a client through an exception.
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { SteamError, type SteamLibrary, type SteamOwnedGame } from "./steam";

const OWNED_GAMES_URL = "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/";
const TIMEOUT_MS = 8000;

type Fetch = (url: string, init: { signal: AbortSignal }) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;

export interface SteamWebApiDeps {
  /** The Steam Web API key, or undefined when it isn't set up. */
  getKey: () => Promise<string | undefined>;
  /** Test seam; defaults to global fetch. */
  fetch?: Fetch;
}

const noKey = () => new SteamError("noKey", "The Steam Web API key isn't set up yet (see docs/first-deploy.md)");

export function steamWebApi(deps: SteamWebApiDeps): SteamLibrary {
  const doFetch: Fetch = deps.fetch ?? ((url, init) => fetch(url, init));
  return {
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

type SecretsClient = Pick<SecretsManagerClient, "send">;

/**
 * Reads the key from the named secret (a plain SecretString holding just the key), once per
 * Lambda container. A missing name, missing secret or empty value all mean "not set up". The
 * Lambda's role can read this one secret only (infra/lib/stacks.ts).
 */
export function secretsManagerKey(secretName: string | undefined, client?: SecretsClient): () => Promise<string | undefined> {
  let cached: string | undefined;
  return async () => {
    if (cached) return cached;
    if (!secretName) return undefined;
    const sm = client ?? new SecretsManagerClient({});
    try {
      const r = await sm.send(new GetSecretValueCommand({ SecretId: secretName }));
      cached = r.SecretString?.trim() || undefined;
      return cached;
    } catch (e) {
      if ((e as Error).name === "ResourceNotFoundException") return undefined;
      throw e;
    }
  };
}
