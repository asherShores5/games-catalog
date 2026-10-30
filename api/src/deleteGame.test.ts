import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(() => h.reset());

// A made-up SteamID64 (7656119 + 10 digits). Real ones never go in tracked files.
const STEAM_ID = "76561190000000003";
const PK = "OWNER#" + h.owner.userId;

const allGames = () => h.call(h.owner, "games");
const names = async () => (await allGames()).map((g: { name: string }) => g.name);

async function platformId(name: string): Promise<string> {
  return (await h.call(h.owner, "platforms")).find((p: { name: string }) => p.name === name).id;
}

async function steamAccount() {
  const a = await h.call(h.owner, "addAccount", { store: "Steam", nickname: "main" });
  await h.call(h.owner, "setSteamId", { accountId: a.id, steamId: STEAM_ID });
  return a;
}

describe("Delete a Game", () => {
  it("removes the Game and every one of its Copies, and returns its id", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Typo Gmae" });
    await h.call(h.owner, "addCopy", { gameId: game.id, platformId: await platformId("PS5"), format: "Physical" });
    const keep = await h.call(h.owner, "addGame", { name: "Celeste" });

    expect(await h.call(h.owner, "deleteGame", { id: game.id })).toBe(game.id);

    expect(await names()).toEqual(["Celeste"]);
    expect(h.db.dump().filter((r) => r.PK === PK && String(r.SK).startsWith(`GAME#${game.id}`))).toEqual([]);
    expect((await allGames())[0].id).toBe(keep.id);
  });

  it("a Platform its Copies used can be deleted afterwards", async () => {
    const ps = await h.call(h.owner, "addPlatform", { name: "PS Vita" });
    const game = await h.call(h.owner, "addGame", { name: "Gravity Rush" });
    await h.call(h.owner, "addCopy", { gameId: game.id, platformId: ps.id, format: "Physical" });
    await expect(h.call(h.owner, "deletePlatform", { id: ps.id })).rejects.toThrow("Conflict");
    await h.call(h.owner, "deleteGame", { id: game.id });
    expect(await h.call(h.owner, "deletePlatform", { id: ps.id })).toBe(ps.id);
  });

  it("a deleted Steam Game isn't added back by the next Import; other games still are", async () => {
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, [{ appId: 1145360, name: "Hades" }, { appId: 620, name: "Portal 2" }]);
    await h.call(h.owner, "importSteam", { accountId: steam.id });
    const hades = (await allGames()).find((g: { name: string }) => g.name === "Hades");

    await h.call(h.owner, "deleteGame", { id: hades.id });
    h.steam.set(STEAM_ID, [{ appId: 1145360, name: "Hades" }, { appId: 620, name: "Portal 2" }, { appId: 400, name: "Portal" }]);
    const summary = await h.call(h.owner, "importSteam", { accountId: steam.id });

    expect(await names()).toEqual(["Portal", "Portal 2"]);
    expect(summary).toMatchObject({ added: 1, alreadyPresent: 1 });
  });

  it("the Steam app IDs a deleted Game absorbed in a Merge stay out too", async () => {
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, [{ appId: 1, name: "Skyrim" }, { appId: 2, name: "Skyrim Special Edition" }]);
    await h.call(h.owner, "importSteam", { accountId: steam.id });
    const [a, b] = await allGames();
    const merged = await h.call(h.owner, "mergeGames", { fromId: b.id, intoId: a.id });
    await h.call(h.owner, "deleteGame", { id: merged.id });
    await h.call(h.owner, "importSteam", { accountId: steam.id });
    expect(await names()).toEqual([]);
  });

  it("I can add a deleted Steam game back by hand", async () => {
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, [{ appId: 620, name: "Portal 2" }]);
    await h.call(h.owner, "importSteam", { accountId: steam.id });
    await h.call(h.owner, "deleteGame", { id: (await allGames())[0].id });
    await h.call(h.owner, "addGame", { name: "Portal 2" });
    expect(await names()).toEqual(["Portal 2"]);
  });

  it("an unknown or someone else's Game is NotFound", async () => {
    const theirs = await h.call(h.stranger, "addGame", { name: "Theirs" });
    await expect(h.call(h.owner, "deleteGame", { id: theirs.id })).rejects.toThrow("NotFound");
    await expect(h.call(h.owner, "deleteGame", { id: "nope" })).rejects.toThrow("NotFound");
    expect((await h.call(h.stranger, "games")).map((g: { name: string }) => g.name)).toEqual(["Theirs"]);
  });
});
