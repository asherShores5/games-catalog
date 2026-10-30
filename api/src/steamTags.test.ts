import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gameMatches } from "@games/shared";
import { SteamError } from "./steam";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(() => h.reset());

// A made-up SteamID64 (7656119 + 10 digits). Real ones never go in tracked files.
const STEAM_ID = "76561190000000001";
const HADES = { appId: 1145360, name: "Hades" };
const PORTAL = { appId: 620, name: "Portal 2" };

async function steamAccount() {
  const a = await h.call(h.owner, "addAccount", { store: "Steam", nickname: "main" });
  await h.call(h.owner, "setSteamId", { accountId: a.id, steamId: STEAM_ID });
  return a;
}

const importSteam = (accountId: string) => h.call(h.owner, "importSteam", { accountId });

async function tagNames(): Promise<Map<string, string>> {
  return new Map((await h.call(h.owner, "tags")).map((t: { id: string; name: string }) => [t.id, t.name]));
}

/** Each Game's Tags as "name/source", by Game name. */
async function gameTags(): Promise<Record<string, string[]>> {
  const names = await tagNames();
  const out: Record<string, string[]> = {};
  for (const g of await h.call(h.owner, "games")) {
    out[g.name] = g.tags.map((t: { tagId: string; source: string }) => `${names.get(t.tagId)}/${t.source}`);
  }
  return out;
}

const tagId = async (name: string) => [...(await tagNames())].find(([, n]) => n === name)![0];

describe("Steam Tag Import", () => {
  it("imported Games arrive with mapped Tags (Import source); unmapped ones become new Tags as-is", async () => {
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, [HADES, PORTAL]);
    h.steam.setDetails(HADES.appId, { categories: ["Single-player", "Steam Achievements"], genres: ["Action", "Indie"] });
    h.steam.setDetails(PORTAL.appId, { categories: ["Single-player", "Online Co-op", "Shared/Split Screen Co-op"], genres: ["Action"] });

    const summary = await importSteam(steam.id);

    expect(summary).toMatchObject({ added: 2, tagged: 2, tagsPending: 0 });
    expect(await gameTags()).toEqual({
      Hades: ["single-player/Import", "Action/Import", "Indie/Import"],
      "Portal 2": ["single-player/Import", "co-op/Import", "Action/Import"],
    });
    const all = [...(await tagNames()).values()];
    // The seeded single-player and co-op are reused; Action is created once.
    expect(all.filter((n) => n === "single-player")).toHaveLength(1);
    expect(all.filter((n) => n === "Action")).toHaveLength(1);
    expect(all).not.toContain("Steam Achievements");
  });
});

const gameRecOf = (id: string) => h.db.dump().find((r) => r.SK === "GAME#" + id)!;
const DAY = 24 * 60 * 60 * 1000;

describe("Steam Tag Import: re-imports", () => {
  it("re-importing never removes a manual Tag and never re-adds a Tag I removed", async () => {
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, [HADES]);
    h.steam.setDetails(HADES.appId, { categories: ["Single-player"], genres: ["Action", "Indie"] });
    await importSteam(steam.id);
    const [game] = await h.call(h.owner, "games");
    await h.call(h.owner, "removeGameTag", { gameId: game.id, tagId: await tagId("Action") });
    await h.call(h.owner, "addGameTag", { gameId: game.id, tagId: await tagId("narrative") });
    await h.call(h.owner, "addGameTag", { gameId: game.id, tagId: await tagId("single-player") });

    // As if the last lookup were long ago, so this Import reads the store page again.
    h.db.seed({ ...gameRecOf(game.id), storeTagsAt: Date.now() - 31 * DAY });
    h.steam.setDetails(HADES.appId, { categories: ["Single-player"], genres: ["Action", "Indie", "Roguelike"] });
    expect(await importSteam(steam.id)).toMatchObject({ alreadyPresent: 1, tagged: 1 });

    expect((await gameTags()).Hades).toEqual(["single-player/Manual", "Indie/Import", "narrative/Manual", "Roguelike/Import"]);
  });

  it("an Import that adds a Copy to a manual Game I tagged keeps my Tags and removals, and adds the store's", async () => {
    const steam = await steamAccount();
    const g = await h.call(h.owner, "addGame", { name: "Hades" });
    await h.call(h.owner, "addGameTag", { gameId: g.id, tagId: await tagId("co-op") });
    await h.call(h.owner, "removeGameTag", { gameId: g.id, tagId: await tagId("co-op") });
    await h.call(h.owner, "addGameTag", { gameId: g.id, tagId: await tagId("narrative") });
    h.steam.set(STEAM_ID, [HADES]);
    h.steam.setDetails(HADES.appId, { categories: ["Single-player", "Online Co-op"], genres: [] });

    await importSteam(steam.id);

    const [game] = await h.call(h.owner, "games");
    expect(game.copies).toHaveLength(1);
    expect((await gameTags()).Hades).toEqual(["narrative/Manual", "single-player/Import"]);
  });

  it("a Game whose store page was read in the last 30 days isn't looked up again", async () => {
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, [HADES]);
    h.steam.setDetails(HADES.appId, { categories: ["Single-player"], genres: [] });
    await importSteam(steam.id);
    h.steam.detailCalls = [];

    expect(await importSteam(steam.id)).toMatchObject({ alreadyPresent: 1, tagged: 0, tagsPending: 0 });
    expect(h.steam.detailCalls).toEqual([]);
  });

  it("a Game with no store page is looked up once, not on every Import", async () => {
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, [HADES]);
    expect(await importSteam(steam.id)).toMatchObject({ tagged: 1, tagsPending: 0 });
    expect(await importSteam(steam.id)).toMatchObject({ tagged: 0, tagsPending: 0 });
    expect(h.steam.detailCalls).toEqual([HADES.appId]);
    expect((await gameTags()).Hades).toEqual([]);
  });

  it("the lookup time stays private", async () => {
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, [HADES]);
    await importSteam(steam.id);
    const [game] = await h.call(h.owner, "games");
    expect(game).not.toHaveProperty("storeTagsAt");
    expect(gameRecOf(game.id).storeTagsAt).toEqual(expect.any(Number));
  });
});

/** A library of `n` made-up apps, ids 1..n. */
const library = (n: number) => Array.from({ length: n }, (_, i) => ({ appId: i + 1, name: `Game ${String(i + 1).padStart(3, "0")}` }));

describe("Steam Tag Import: being polite to the store", () => {
  const realSend = h.db.send.bind(h.db);
  afterEach(() => {
    vi.useRealTimers();
    h.db.send = realSend;
  });

  it("one failed store lookup doesn't fail the Import; that Game waits for the next one", async () => {
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, [HADES, PORTAL]);
    h.steam.setDetails(HADES.appId, new SteamError("unavailable", "Couldn't reach the Steam store"));
    h.steam.setDetails(PORTAL.appId, { categories: ["Single-player"], genres: [] });

    expect(await importSteam(steam.id)).toMatchObject({ added: 2, failed: 0, tagged: 1, tagsPending: 1 });
    expect(await gameTags()).toEqual({ Hades: [], "Portal 2": ["single-player/Import"] });

    h.steam.setDetails(HADES.appId, { categories: ["Single-player"], genres: [] });
    expect(await importSteam(steam.id)).toMatchObject({ alreadyPresent: 2, tagged: 1, tagsPending: 0 });
    expect((await gameTags()).Hades).toEqual(["single-player/Import"]);
  });

  it("when the store says slow down, no more lookups this Import; Copies still land", async () => {
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, library(5));
    h.steam.setDetails(2, new SteamError("rateLimited", "The Steam store is busy"));

    expect(await importSteam(steam.id)).toMatchObject({ added: 5, failed: 0, tagged: 1, tagsPending: 4 });
    expect(h.steam.detailCalls).toEqual([1, 2]);
  });

  it("looks up at most 40 store pages per Import, one at a time; re-runs carry on with the rest", async () => {
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, library(50));
    let inFlight = 0;
    let most = 0;
    const real = h.steam.appDetails.bind(h.steam);
    h.steam.appDetails = async (appId) => {
      most = Math.max(most, ++inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return real(appId);
    };

    expect(await importSteam(steam.id)).toMatchObject({ added: 50, tagged: 40, tagsPending: 10 });
    expect(most).toBe(1);
    expect(await importSteam(steam.id)).toMatchObject({ alreadyPresent: 50, tagged: 10, tagsPending: 0 });
    expect(new Set(h.steam.detailCalls).size).toBe(50);
  });

  it("stops starting lookups 12 seconds into the Import, so it stays inside the Lambda timeout", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, library(10));
    h.steam.onDetails = () => vi.setSystemTime(Date.now() + 3000);

    expect(await importSteam(steam.id)).toMatchObject({ added: 10, tagged: 4, tagsPending: 6 });
    expect(h.steam.detailCalls).toEqual([1, 2, 3, 4]);
  });

  /** Every table call takes `ms` of (fake) time, or only the ones `which` picks. */
  function slowTable(ms: number, which: (cmd: unknown) => boolean = () => true) {
    h.db.send = async (cmd: unknown) => {
      if (which(cmd)) vi.setSystemTime(Date.now() + ms);
      return realSend(cmd);
    };
    return () => (h.db.send = realSend);
  }

  it("the whole Import keeps inside the Lambda timeout: Copies not started in time wait for the next run", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, library(40));
    const started = Date.now();
    const restore = slowTable(1000, (cmd) => cmd instanceof TransactWriteCommand);

    const first = await importSteam(steam.id);
    restore();

    expect(Date.now() - started).toBeLessThan(25_000);
    expect(first.added).toBeLessThan(40);
    expect(first.added + first.failed).toBe(40);
    expect(await importSteam(steam.id)).toMatchObject({ added: 40 - first.added, alreadyPresent: first.added, failed: 0 });
  });

  it("creating many new store Tags doesn't eat the Import's time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, library(5));
    for (let app = 1; app <= 5; app++) {
      h.steam.setDetails(app, { categories: [], genres: Array.from({ length: 8 }, (_, i) => `Genre ${app}-${i}`) });
    }
    const started = Date.now();
    slowTable(1000);

    expect(await importSteam(steam.id)).toMatchObject({ added: 5, failed: 0, tagged: 5, tagsPending: 0 });
    expect(Date.now() - started).toBeLessThan(20_000);
    expect((await gameTags())["Game 003"]).toHaveLength(8);
  });

  it("Games never looked up go before Games due a refresh", async () => {
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, [HADES]);
    await importSteam(steam.id);
    const [hades] = await h.call(h.owner, "games");
    h.db.seed({ ...gameRecOf(hades.id), storeTagsAt: Date.now() - 31 * DAY });
    h.steam.set(STEAM_ID, [HADES, ...library(40)]);
    h.steam.detailCalls = [];

    expect(await importSteam(steam.id)).toMatchObject({ tagged: 40, tagsPending: 1 });
    expect(h.steam.detailCalls).not.toContain(HADES.appId);
  });
});

describe("Steam Tag Import: filtering", () => {
  it("imported Tags filter like any other Tag", async () => {
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, [HADES, PORTAL]);
    h.steam.setDetails(HADES.appId, { categories: ["Single-player"], genres: ["Action"] });
    h.steam.setDetails(PORTAL.appId, { categories: ["Single-player", "Online Co-op"], genres: ["Action"] });
    await importSteam(steam.id);

    const games = await h.call(h.owner, "games");
    const filter = { tagIds: [await tagId("co-op"), await tagId("Action")] };
    expect(games.filter((g: never) => gameMatches(g, filter)).map((g: { name: string }) => g.name)).toEqual(["Portal 2"]);
  });
});

describe("Steam Tag Import: my Tag edits stick", () => {
  /** Import Hades with this store page. */
  async function importHades(categories: string[], genres: string[]) {
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, [HADES]);
    h.steam.setDetails(HADES.appId, { categories, genres });
    await importSteam(steam.id);
    return steam;
  }
  /** Import again with every Game's store page due for a refresh. */
  async function refresh(steamAccountId: string) {
    for (const g of await h.call(h.owner, "games")) h.db.seed({ ...gameRecOf(g.id), storeTagsAt: Date.now() - 31 * DAY });
    return importSteam(steamAccountId);
  }
  const allNames = async () => [...(await tagNames()).values()].sort();

  it("a renamed seeded Tag still catches its Steam Categories; the old name isn't re-created", async () => {
    const steam = await steamAccount();
    await h.call(h.owner, "renameTag", { id: await tagId("co-op"), name: "Co-operative" });
    h.steam.set(STEAM_ID, [PORTAL]);
    h.steam.setDetails(PORTAL.appId, { categories: ["Online Co-op"], genres: [] });

    await importSteam(steam.id);

    expect((await gameTags())["Portal 2"]).toEqual(["Co-operative/Import"]);
    expect(await allNames()).not.toContain("co-op");
  });

  it("a renamed imported Tag keeps catching its Steam name on a refresh", async () => {
    const steam = await importHades([], ["Action"]);
    await h.call(h.owner, "renameTag", { id: await tagId("Action"), name: "Action games" });

    expect(await refresh(steam.id)).toMatchObject({ tagged: 1, failed: 0 });

    expect((await gameTags()).Hades).toEqual(["Action games/Import"]);
    expect(await allNames()).not.toContain("Action");
  });

  it("a deleted imported Tag isn't re-created by a refresh or by a new Game", async () => {
    const steam = await importHades([], ["Action", "Indie"]);
    await h.call(h.owner, "deleteTag", { id: await tagId("Indie") });
    h.steam.set(STEAM_ID, [HADES, PORTAL]);
    h.steam.setDetails(PORTAL.appId, { categories: [], genres: ["Indie"] });

    await refresh(steam.id);

    expect(await gameTags()).toEqual({ Hades: ["Action/Import"], "Portal 2": [] });
    expect(await allNames()).not.toContain("Indie");
  });

  it("a Tag merged away isn't re-created; its Steam name lands on the Tag it merged into", async () => {
    const steam = await importHades([], ["Indie"]);
    const into = await h.call(h.owner, "addTag", { name: "indie games" });
    await h.call(h.owner, "mergeTags", { fromId: await tagId("Indie"), intoId: into.id });
    h.steam.set(STEAM_ID, [HADES, PORTAL]);
    h.steam.setDetails(PORTAL.appId, { categories: [], genres: ["Indie"] });

    await refresh(steam.id);

    expect(await gameTags()).toEqual({ Hades: ["indie games/Import"], "Portal 2": ["indie games/Import"] });
    expect(await allNames()).not.toContain("Indie");
  });

  it("a Tag I re-create by hand after deleting it is used by Imports again", async () => {
    const steam = await importHades([], ["Indie"]);
    await h.call(h.owner, "deleteTag", { id: await tagId("Indie") });
    await h.call(h.owner, "addTag", { name: "Indie" });

    await refresh(steam.id);

    expect((await gameTags()).Hades).toEqual(["Indie/Import"]);
  });

  it("a merged Game with two Steam app IDs re-imports cleanly when its store Tags are due", async () => {
    const steam = await steamAccount();
    const HADES_DEMO = { appId: 1145350, name: "Hades Demo" };
    h.steam.set(STEAM_ID, [HADES, HADES_DEMO]);
    h.steam.setDetails(HADES.appId, { categories: [], genres: ["Action"] });
    h.steam.setDetails(HADES_DEMO.appId, { categories: [], genres: ["Indie"] });
    await importSteam(steam.id);
    const games = await h.call(h.owner, "games");
    const id = (name: string) => games.find((g: { name: string }) => g.name === name).id;
    await h.call(h.owner, "mergeGames", { fromId: id("Hades Demo"), intoId: id("Hades") });

    expect(await refresh(steam.id)).toMatchObject({ alreadyPresent: 2, failed: 0 });
    expect(Object.keys(await gameTags())).toEqual(["Hades"]);
  });

  it("the Steam names behind a Tag stay private", async () => {
    await h.call(h.owner, "renameTag", { id: await tagId("co-op"), name: "Co-operative" });
    for (const t of await h.call(h.owner, "tags")) expect(Object.keys(t).sort()).toEqual(["id", "name"]);
  });
});
