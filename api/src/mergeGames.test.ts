import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(() => h.reset());

// A made-up SteamID64 (7656119 + 10 digits). Real ones never go in tracked files.
const STEAM_ID = "76561190000000002";
const PK = "OWNER#" + h.owner.userId;

async function platformId(name: string): Promise<string> {
  return (await h.call(h.owner, "platforms")).find((p: { name: string }) => p.name === name).id;
}
async function tagId(name: string): Promise<string> {
  return (await h.call(h.owner, "tags")).find((t: { name: string }) => t.name === name).id;
}
const allGames = () => h.call(h.owner, "games");
const gameRecord = (id: string) => h.db.dump().find((r) => r.PK === PK && r.SK === "GAME#" + id)!;

async function steamAccount() {
  const a = await h.call(h.owner, "addAccount", { store: "Steam", nickname: "main" });
  await h.call(h.owner, "setSteamId", { accountId: a.id, steamId: STEAM_ID });
  return a;
}

describe("Merge Games", () => {
  it("moves the other Game's Copies onto the surviving Game, and the other Game is gone", async () => {
    const into = await h.call(h.owner, "addGame", { name: "Skyrim" });
    const from = await h.call(h.owner, "addGame", { name: "Skyrim Special Edition" });
    const ps5 = await platformId("PS5");
    await h.call(h.owner, "addCopy", { gameId: into.id, platformId: ps5, format: "Physical" });
    const fromWithCopy = await h.call(h.owner, "addCopy", { gameId: from.id, platformId: ps5, format: "Physical", edition: "Anniversary" });

    const merged = await h.call(h.owner, "mergeGames", { fromId: from.id, intoId: into.id });
    expect(merged).toMatchObject({ id: into.id, name: "Skyrim", owned: true });
    expect(merged.copies).toHaveLength(2);
    expect(merged.copies).toContainEqual(fromWithCopy.copies[0]);

    const games = await allGames();
    expect(games.map((g: { id: string }) => g.id)).toEqual([into.id]);
    expect(games[0]).toEqual(merged);
    // No stray records of the merged-away Game (Game or Copies) are left behind.
    expect(h.db.dump().filter((r) => String(r.SK).startsWith("GAME#" + from.id))).toEqual([]);
  });

  it("keeps the more advanced Play status, or the one I choose; Owned clears Wishlist", async () => {
    const into = await h.call(h.owner, "addGame", { name: "Hades" });
    await h.call(h.owner, "setWishlist", { gameId: into.id, wishlist: true });
    await h.call(h.owner, "setPlayStatus", { gameId: into.id, playStatus: "Finished" });
    const from = await h.call(h.owner, "addGame", { name: "Hades (PS5)" });
    await h.call(h.owner, "addCopy", { gameId: from.id, platformId: await platformId("PS5"), format: "Physical" });
    await h.call(h.owner, "setPlayStatus", { gameId: from.id, playStatus: "Playing" });

    const merged = await h.call(h.owner, "mergeGames", { fromId: from.id, intoId: into.id });
    expect(merged).toMatchObject({ owned: true, wishlist: false, playStatus: "Playing" });

    const other = await h.call(h.owner, "addGame", { name: "Hades again" });
    await h.call(h.owner, "setPlayStatus", { gameId: other.id, playStatus: "Playing" });
    expect(await h.call(h.owner, "mergeGames", { fromId: other.id, intoId: into.id, playStatus: null })).toMatchObject({ playStatus: null });
  });

  it("Tags combine with their sources and my removals", async () => {
    const [coop, versus, narrative] = [await tagId("co-op"), await tagId("versus"), await tagId("narrative")];
    const into = await h.call(h.owner, "addGame", { name: "Portal 2" });
    const from = await h.call(h.owner, "addGame", { name: "Portal 2 (copy)" });
    // `from` has an imported co-op link and a removed versus; `into` has co-op by hand.
    h.db.seed({ ...gameRecord(from.id), tags: [{ tagId: coop, source: "Import" }, { tagId: narrative, source: "Import" }], removedTagIds: [versus] });
    await h.call(h.owner, "addGameTag", { gameId: into.id, tagId: coop });

    const merged = await h.call(h.owner, "mergeGames", { fromId: from.id, intoId: into.id });
    expect(merged.tags).toEqual([{ tagId: coop, source: "Manual" }, { tagId: narrative, source: "Import" }]);
    expect(gameRecord(into.id).removedTagIds).toEqual([versus]);
    expect(JSON.stringify(merged)).not.toContain("removedTagIds");
  });

  it("drops a Seeded Game's Unknown Copy when merged with an Imported one", async () => {
    await h.seed(h.owner, [{ name: "Celeste", status: "Owned" }]);
    const seeded = (await allGames())[0];
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, [{ appId: 504230, name: "Celeste Deluxe" }]);
    await h.call(h.owner, "importSteam", { accountId: steam.id });
    const imported = (await allGames()).find((g: { steamAppId?: number }) => g.steamAppId === 504230);

    const merged = await h.call(h.owner, "mergeGames", { fromId: imported.id, intoId: seeded.id });
    expect(merged.copies).toEqual(imported.copies);
    expect(merged.steamAppId).toBe(504230);
  });

  it("refuses merging a Game into itself, a missing Game, or another user's Game", async () => {
    const g = await h.call(h.owner, "addGame", { name: "Hades" });
    const theirs = await h.call(h.stranger, "addGame", { name: "Hades" });
    await expect(h.call(h.owner, "mergeGames", { fromId: g.id, intoId: g.id })).rejects.toThrow("ValidationError");
    await expect(h.call(h.owner, "mergeGames", { fromId: "nope", intoId: g.id })).rejects.toThrow("NotFound");
    await expect(h.call(h.owner, "mergeGames", { fromId: theirs.id, intoId: g.id })).rejects.toThrow("NotFound");
    await expect(h.call(h.owner, "mergeGames", { fromId: g.id, intoId: theirs.id })).rejects.toThrow("NotFound");
    await expect(h.call(h.owner, "mergeGames", { fromId: g.id, intoId: "x", playStatus: "Bored" })).rejects.toThrow("ValidationError");
  });

  it("is all-or-nothing: if either Game changes meanwhile, nothing is merged", async () => {
    for (const racer of ["from", "into"] as const) {
      h.reset();
      const into = await h.call(h.owner, "addGame", { name: "Hades" });
      const from = await h.call(h.owner, "addGame", { name: "Hades 2" });
      await h.call(h.owner, "addCopy", { gameId: from.id, platformId: await platformId("PS5"), format: "Physical" });
      const target = racer === "from" ? from.id : into.id;
      // Simulate a racing edit: bump one Game's updatedAt just before the Merge writes.
      let afterRace: unknown;
      const realSend = h.db.send.bind(h.db);
      h.db.send = async (cmd: any) => {
        if (cmd.constructor.name === "TransactWriteCommand") {
          const rec = gameRecord(target);
          h.db.seed({ ...rec, updatedAt: (rec.updatedAt as number) + 1000 });
          afterRace = h.db.dump();
        }
        return realSend(cmd);
      };
      try {
        await expect(h.call(h.owner, "mergeGames", { fromId: from.id, intoId: into.id })).rejects.toThrow("Conflict");
      } finally {
        h.db.send = realSend;
      }
      expect(afterRace).toBeDefined();
      expect(h.db.dump()).toEqual(afterRace);
    }
  });
});

describe("Merge Games and Steam Imports", () => {
  it("a later Import doesn't recreate the merged-away Imported Game", async () => {
    const steam = await steamAccount();
    const mine = await h.call(h.owner, "addGame", { name: "Half-Life 2" });
    await h.call(h.owner, "addCopy", { gameId: mine.id, platformId: await platformId("PS5"), format: "Physical" });
    // A Steam name that doesn't match mine, so the Import creates a second Game.
    h.steam.set(STEAM_ID, [{ appId: 220, name: "Half-Life 2: Complete" }]);
    await h.call(h.owner, "importSteam", { accountId: steam.id });
    const imported = (await allGames()).find((g: { id: string }) => g.id !== mine.id);

    const merged = await h.call(h.owner, "mergeGames", { fromId: imported.id, intoId: mine.id });
    expect(merged.steamAppId).toBe(220);
    expect(await h.call(h.owner, "importSteam", { accountId: steam.id })).toMatchObject({ added: 0, alreadyPresent: 1, failed: 0 });
    expect((await allGames()).map((g: { id: string }) => g.id)).toEqual([mine.id]);
  });

  it("merging an Imported Game into a manual one keeps its store Tag lookup time, so the store isn't asked again", async () => {
    const steam = await steamAccount();
    const mine = await h.call(h.owner, "addGame", { name: "Half-Life 2" });
    await h.call(h.owner, "addCopy", { gameId: mine.id, platformId: await platformId("PS5"), format: "Physical" });
    h.steam.set(STEAM_ID, [{ appId: 220, name: "Half-Life 2: Complete" }]);
    await h.call(h.owner, "importSteam", { accountId: steam.id });
    const imported = (await allGames()).find((g: { id: string }) => g.id !== mine.id);
    const lookedUpAt = gameRecord(imported.id).storeTagsAt;

    await h.call(h.owner, "mergeGames", { fromId: imported.id, intoId: mine.id });

    expect(gameRecord(mine.id).storeTagsAt).toBe(lookedUpAt);
    h.steam.detailCalls = [];
    await h.call(h.owner, "importSteam", { accountId: steam.id });
    expect(h.steam.detailCalls).toEqual([]);
  });

  it("two Steam editions (different app IDs) merged: an Import matches both to the one Game", async () => {
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, [{ appId: 72850, name: "The Elder Scrolls V: Skyrim" }, { appId: 489830, name: "Skyrim Special Edition" }]);
    await h.call(h.owner, "importSteam", { accountId: steam.id });
    const [a, b] = await allGames();
    const into = a.steamAppId === 489830 ? a : b;
    const from = into === a ? b : a;

    const merged = await h.call(h.owner, "mergeGames", { fromId: from.id, intoId: into.id });
    expect(merged.steamAppId).toBe(489830);
    expect(merged.copies).toHaveLength(2);
    expect(gameRecord(into.id).mergedSteamAppIds).toEqual([72850]);

    expect(await h.call(h.owner, "importSteam", { accountId: steam.id })).toMatchObject({ added: 0, alreadyPresent: 2, failed: 0 });
    expect(await allGames()).toEqual([merged]);
  });

  it("both editions' app IDs on one merged Game with no Steam Copy left: an Import adds one Copy, not two", async () => {
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, [{ appId: 1, name: "A" }, { appId: 2, name: "B" }]);
    await h.call(h.owner, "importSteam", { accountId: steam.id });
    const [a, b] = await allGames();
    let merged = await h.call(h.owner, "mergeGames", { fromId: b.id, intoId: a.id });
    for (const c of merged.copies) merged = await h.call(h.owner, "removeCopy", { gameId: a.id, copyId: c.id });

    expect(await h.call(h.owner, "importSteam", { accountId: steam.id })).toMatchObject({ added: 1, alreadyPresent: 1, failed: 0 });
    const games = await allGames();
    expect(games).toHaveLength(1);
    expect(games[0].copies).toHaveLength(1);
  });

  it("other writes to the merged Game keep its extra Steam app IDs", async () => {
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, [{ appId: 1, name: "A" }, { appId: 2, name: "B" }]);
    await h.call(h.owner, "importSteam", { accountId: steam.id });
    const [a, b] = await allGames();
    await h.call(h.owner, "mergeGames", { fromId: b.id, intoId: a.id });
    await h.call(h.owner, "setPlayStatus", { gameId: a.id, playStatus: "Playing" });
    await h.call(h.owner, "addGameTag", { gameId: a.id, tagId: await tagId("co-op") });
    expect(gameRecord(a.id).mergedSteamAppIds).toEqual([b.steamAppId]);
  });
});
