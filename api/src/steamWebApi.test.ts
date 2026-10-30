// The real Steam client against a fake fetch: no network. Checks what it asks Steam, how it reads
// the answer, and that the key and Steam ID never end up in an error.
import { ResourceNotFoundException } from "@aws-sdk/client-secrets-manager";
import { describe, expect, it } from "vitest";
import { SteamError } from "./steam";
import { secretsManagerKey, steamWebApi } from "./steamWebApi";

const KEY = "FAKEKEY0123456789ABCDEF";
const STEAM_ID = "76561190000000001";

function fakeFetch(answer: { status?: number; body?: unknown } | Error) {
  const urls: string[] = [];
  const fetch = async (url: string) => {
    urls.push(url);
    if (answer instanceof Error) throw answer;
    const status = answer.status ?? 200;
    return { status, ok: status >= 200 && status < 300, json: async () => answer.body };
  };
  return { fetch, urls };
}

const client = (f: ReturnType<typeof fakeFetch>) => steamWebApi({ getKey: async () => KEY, fetch: f.fetch });

async function steamError(p: Promise<unknown>): Promise<SteamError> {
  const e = await p.then(() => undefined, (err) => err);
  expect(e).toBeInstanceOf(SteamError);
  expect(String(e.message)).not.toContain(KEY);
  expect(String(e.message)).not.toContain(STEAM_ID);
  return e;
}

describe("Steam Web API client", () => {
  it("asks GetOwnedGames over HTTPS with app info, and returns app IDs and names", async () => {
    const f = fakeFetch({ body: { response: { game_count: 2, games: [{ appid: 620, name: "Portal 2", playtime_forever: 5 }, { appid: 440 }] } } });
    expect(await client(f).ownedGames(STEAM_ID)).toEqual([{ appId: 620, name: "Portal 2" }, { appId: 440, name: "" }]);
    const url = new URL(f.urls[0]);
    expect(url.origin + url.pathname).toBe("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ key: KEY, steamid: STEAM_ID, include_appinfo: "1" });
  });

  it("an empty library is fine", async () => {
    expect(await client(fakeFetch({ body: { response: { game_count: 0 } } })).ownedGames(STEAM_ID)).toEqual([]);
  });

  it("a private profile (empty response) is a 'private' error", async () => {
    expect((await steamError(client(fakeFetch({ body: { response: {} } })).ownedGames(STEAM_ID))).kind).toBe("private");
  });

  it("a missing key fails before calling Steam", async () => {
    const f = fakeFetch({ body: { response: { game_count: 0 } } });
    const noKey = steamWebApi({ getKey: async () => undefined, fetch: f.fetch });
    expect((await steamError(noKey.ownedGames(STEAM_ID))).kind).toBe("noKey");
    expect(f.urls).toEqual([]);
  });

  it("maps Steam's refusals and outages", async () => {
    expect((await steamError(client(fakeFetch({ status: 403 })).ownedGames(STEAM_ID))).kind).toBe("keyRejected");
    expect((await steamError(client(fakeFetch({ status: 400 })).ownedGames(STEAM_ID))).kind).toBe("badSteamId");
    expect((await steamError(client(fakeFetch({ status: 503 })).ownedGames(STEAM_ID))).kind).toBe("unavailable");
    expect((await steamError(client(fakeFetch({ body: "<html>" })).ownedGames(STEAM_ID))).kind).toBe("unavailable");
  });

  it("a network error that quotes the URL is replaced, so the key can't leak", async () => {
    const leaky = new Error(`fetch failed: https://api.steampowered.com/?key=${KEY}&steamid=${STEAM_ID}`);
    const e = await steamError(client(fakeFetch(leaky)).ownedGames(STEAM_ID));
    expect(e.kind).toBe("unavailable");
    expect(e.cause).toBeUndefined();
  });
});

describe("Secrets Manager key", () => {
  const sm = (answer: { SecretString?: string } | Error) => {
    const calls: unknown[] = [];
    return {
      calls,
      send: async (cmd: { input: unknown }) => {
        calls.push(cmd.input);
        if (answer instanceof Error) throw answer;
        return answer;
      },
    };
  };

  it("reads the named secret once and caches it", async () => {
    const c = sm({ SecretString: ` ${KEY}\n` });
    const getKey = secretsManagerKey("games-catalog/steam-web-api-key", c as never);
    expect(await getKey()).toBe(KEY);
    expect(await getKey()).toBe(KEY);
    expect(c.calls).toEqual([{ SecretId: "games-catalog/steam-web-api-key" }]);
  });

  it("no secret name, no secret or an empty secret all mean not set up", async () => {
    expect(await secretsManagerKey(undefined, sm({ SecretString: KEY }) as never)()).toBeUndefined();
    const missing = new ResourceNotFoundException({ message: "not found", $metadata: {} });
    expect(await secretsManagerKey("x", sm(missing) as never)()).toBeUndefined();
    expect(await secretsManagerKey("x", sm({ SecretString: "  " }) as never)()).toBeUndefined();
  });
});

describe("Steam store client (appdetails)", () => {
  const page = (data: unknown) => ({ body: { "620": { success: true, data } } });
  // No real waiting in tests: the client spaces calls through these.
  const noWait = () => {
    const waits: number[] = [];
    let now = 1_000_000;
    return { waits, now: () => now, sleep: async (ms: number) => { waits.push(ms); now += ms; } };
  };
  const store = (f: ReturnType<typeof fakeFetch>, clock = noWait()) =>
    steamWebApi({ getKey: async () => undefined, fetch: f.fetch, now: clock.now, sleep: clock.sleep });

  it("asks the store for one app's Categories and Genres in English, without the key, and returns their names", async () => {
    const f = fakeFetch(page({
      categories: [{ id: 2, description: "Single-player" }, { id: 9, description: "Co-op" }, { id: 1 }],
      genres: [{ id: "1", description: "Action" }],
    }));
    expect(await store(f).appDetails(620)).toEqual({ categories: ["Single-player", "Co-op"], genres: ["Action"] });
    const url = new URL(f.urls[0]);
    expect(url.origin + url.pathname).toBe("https://store.steampowered.com/api/appdetails");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ appids: "620", l: "english" });
    expect(url.searchParams.has("key")).toBe(false);
  });

  it("a page with no Categories or Genres gives empty lists; no page at all is null", async () => {
    expect(await store(fakeFetch(page({}))).appDetails(620)).toEqual({ categories: [], genres: [] });
    expect(await store(fakeFetch({ body: { "620": { success: false } } })).appDetails(620)).toBeNull();
  });

  it("429 is rateLimited; other failures are unavailable", async () => {
    expect((await steamError(store(fakeFetch({ status: 429 })).appDetails(620))).kind).toBe("rateLimited");
    expect((await steamError(store(fakeFetch({ status: 403 })).appDetails(620))).kind).toBe("rateLimited");
    expect((await steamError(store(fakeFetch({ status: 500 })).appDetails(620))).kind).toBe("unavailable");
    expect((await steamError(store(fakeFetch(new Error("boom"))).appDetails(620))).kind).toBe("unavailable");
    expect((await steamError(store(fakeFetch({ body: "nope" })).appDetails(620))).kind).toBe("unavailable");
  });

  it("spaces store calls at least 300ms apart (bursts stay well under the ~200 per 5 minutes limit)", async () => {
    const clock = noWait();
    const s = store(fakeFetch(page({})), clock);
    await s.appDetails(620);
    await s.appDetails(620);
    await s.appDetails(620);
    expect(clock.waits).toEqual([300, 300]);
  });
});
