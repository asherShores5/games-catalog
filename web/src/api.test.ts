import { beforeEach, describe, expect, it, vi } from "vitest";
import { gameMatches } from "@games/shared";

// api.ts in demo mode: every list answers from the sample library, every change is refused, and
// nothing goes over the network (no config, no Cognito, no AppSync).

let fetched: string[];

async function launchDemo() {
  vi.resetModules();
  vi.stubGlobal("location", { search: "?demo" });
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal("fetch", async (url: string) => {
    fetched.push(String(url));
    throw new Error("network used in demo mode");
  });
  return import("./api");
}

beforeEach(() => {
  fetched = [];
});

describe("api in demo mode", () => {
  it("lists a sample library without touching the network", async () => {
    const api = await launchDemo();
    const [games, platforms, accounts, places, tags] = await Promise.all([
      api.listGames(), api.listPlatforms(), api.listAccounts(), api.listPlaces(), api.listTags(),
    ]);
    expect(fetched).toEqual([]);
    expect(games.map((g) => g.name)).toContain("Stardew Valley");
    expect(platforms.length).toBeGreaterThan(0);
    expect(places.length).toBeGreaterThan(0);
    expect(tags.length).toBeGreaterThan(0);
    // Sample Accounts never claim a Steam ID.
    expect(accounts.every((a) => !a.hasSteamId)).toBe(true);
  });

  it("gives every filter something to find", async () => {
    const api = await launchDemo();
    const games = await api.listGames();
    const places = await api.listPlaces();
    const some = (f: Parameters<typeof gameMatches>[1]) => games.some((g) => gameMatches(g, f, { places }));
    expect(some({ ownership: "wishlist" })).toBe(true);
    expect(some({ playStatus: "Playing" })).toBe(true);
    expect(some({ playStatus: "Backlog" })).toBe(true);
    expect(some({ playStatus: "Finished" })).toBe(true);
    expect(some({ missing: "location" })).toBe(true);
    expect(some({ missing: "tags" })).toBe(true);
    expect(some({ placeId: places[0].id })).toBe(true);
  });

  it("only points at Platforms, Accounts and Tags that exist", async () => {
    const api = await launchDemo();
    const [games, platforms, accounts, places, tags] = await Promise.all([
      api.listGames(), api.listPlatforms(), api.listAccounts(), api.listPlaces(), api.listTags(),
    ]);
    const ids = (xs: { id: string }[]) => new Set(xs.map((x) => x.id));
    const [p, a, t] = [ids(platforms), ids(accounts), ids(tags)];
    for (const g of games) {
      expect(g.owned).toBe(g.copies.length > 0);
      for (const c of g.copies) {
        if (c.platformId) expect(p.has(c.platformId)).toBe(true);
        if (c.format === "Digital") expect(c.accountId && a.has(c.accountId)).toBeTruthy();
        if (c.format === "Physical") expect(c.accountId).toBeUndefined();
      }
      for (const gt of g.tags) expect(t.has(gt.tagId)).toBe(true);
    }
    for (const pl of places) for (const id of pl.platformIds) expect(p.has(id)).toBe(true);
  });

  it("refuses every change as read-only", async () => {
    const api = await launchDemo();
    const [game] = await api.listGames();
    const attempts = [
      api.addGame("New game"),
      api.setPlayStatus(game.id, "Finished"),
      api.deleteGame(game.id),
      api.setSteamId("any", "123"),
      api.importSteam("any"),
    ];
    for (const a of attempts) await expect(a).rejects.toThrow(/read-only demo/);
    expect(fetched).toEqual([]);
  });
});
