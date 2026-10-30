import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CONFIG = { region: "us-west-1", userPoolId: "us-west-1_TEST", clientId: "client-1", graphqlUrl: "https://api.example/graphql" };
let store: Map<string, string>;
let online: boolean;

async function launch() {
  vi.resetModules();
  return import("./config");
}

beforeEach(() => {
  store = new Map();
  online = true;
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal("fetch", async () => {
    if (!online) throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(CONFIG));
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("loadConfig", () => {
  it("opens offline with the config from the last online launch", async () => {
    await (await launch()).loadConfig();
    online = false;
    const offline = await launch();
    expect(await offline.loadConfig()).toEqual(CONFIG);
    expect(offline.getConfig().clientId).toBe("client-1");
  });

  it("fails on the very first launch with no network, since there is nothing to fall back on", async () => {
    online = false;
    await expect((await launch()).loadConfig()).rejects.toThrow();
  });
});
