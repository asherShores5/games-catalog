import { beforeEach, describe, expect, it } from "vitest";
import { SteamError } from "./steam";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(() => h.reset());

// A made-up SteamID64 (the format is 7656119 + 10 digits). Real ones never go in tracked files.
const STEAM_ID = "76561190000000001";

describe("Steam ID on a Steam Account", () => {
  it("I can set a Steam ID on a Steam Account; the list says it's set but never shows it", async () => {
    const steam = await h.call(h.owner, "addAccount", { store: "Steam", nickname: "main" });
    expect(steam.hasSteamId).toBe(false);
    const updated = await h.call(h.owner, "setSteamId", { accountId: steam.id, steamId: ` ${STEAM_ID} ` });
    expect(updated).toEqual({ id: steam.id, store: "Steam", nickname: "main", hasSteamId: true });
    const listed = await h.call(h.owner, "accounts");
    expect(listed).toEqual([updated]);
    expect(JSON.stringify(listed)).not.toContain(STEAM_ID);
  });

  it("rejects a malformed Steam ID, and a Steam ID on a non-Steam Account", async () => {
    const steam = await h.call(h.owner, "addAccount", { store: "Steam", nickname: "main" });
    for (const bad of ["123", "gaben", "7656119000000000x", "12345678901234567"]) {
      await expect(h.call(h.owner, "setSteamId", { accountId: steam.id, steamId: bad })).rejects.toThrow("ValidationError");
    }
    const gog = await h.call(h.owner, "addAccount", { store: "GOG", nickname: "main" });
    await expect(h.call(h.owner, "setSteamId", { accountId: gog.id, steamId: STEAM_ID })).rejects.toThrow(/ValidationError: .*Steam/);
  });

  it("I can clear it again, and renaming keeps it", async () => {
    const steam = await h.call(h.owner, "addAccount", { store: "Steam", nickname: "main" });
    await h.call(h.owner, "setSteamId", { accountId: steam.id, steamId: STEAM_ID });
    expect((await h.call(h.owner, "renameAccount", { id: steam.id, nickname: "family" })).hasSteamId).toBe(true);
    expect((await h.call(h.owner, "accounts"))[0].hasSteamId).toBe(true);
    expect((await h.call(h.owner, "setSteamId", { accountId: steam.id, steamId: null })).hasSteamId).toBe(false);
    expect((await h.call(h.owner, "accounts"))[0].hasSteamId).toBe(false);
  });

  it("another user's Account is NotFound", async () => {
    const theirs = await h.call(h.stranger, "addAccount", { store: "Steam", nickname: "main" });
    await expect(h.call(h.owner, "setSteamId", { accountId: theirs.id, steamId: STEAM_ID })).rejects.toThrow("NotFound");
  });
});

async function steamAccount(nickname = "main", steamId = STEAM_ID) {
  const a = await h.call(h.owner, "addAccount", { store: "Steam", nickname });
  await h.call(h.owner, "setSteamId", { accountId: a.id, steamId });
  return a;
}

async function platformId(name: string): Promise<string> {
  return (await h.call(h.owner, "platforms")).find((p: { name: string }) => p.name === name).id;
}

const allGames = () => h.call(h.owner, "games");

describe("Import from Steam", () => {
  it("adds each library game as a Game with a Digital PC Copy on that Account, and says what it added", async () => {
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, [{ appId: 1145360, name: "Hades" }, { appId: 620, name: "Portal 2" }]);

    const summary = await h.call(h.owner, "importSteam", { accountId: steam.id });

    expect(summary).toEqual({ added: 2, alreadyPresent: 0, failed: 0, addedNames: ["Hades", "Portal 2"] });
    const pc = await platformId("PC");
    const games = await allGames();
    expect(games.map((g: { name: string }) => g.name)).toEqual(["Hades", "Portal 2"]);
    for (const g of games) {
      expect(g).toMatchObject({ owned: true, wishlist: false, copies: [expect.objectContaining({ platformId: pc, format: "Digital", accountId: steam.id })] });
      expect(g.copies).toHaveLength(1);
    }
    expect(games[0].steamAppId).toBe(1145360);
    expect(h.steam.calls).toEqual([STEAM_ID]);
  });

  it("re-running adds nothing and changes nothing; a newly bought game is the only addition", async () => {
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, [{ appId: 1145360, name: "Hades" }, { appId: 620, name: "Portal 2" }]);
    await h.call(h.owner, "importSteam", { accountId: steam.id });
    const before = await allGames();

    expect(await h.call(h.owner, "importSteam", { accountId: steam.id })).toEqual({ added: 0, alreadyPresent: 2, failed: 0, addedNames: [] });
    expect(await allGames()).toEqual(before);

    h.steam.set(STEAM_ID, [{ appId: 1145360, name: "Hades" }, { appId: 620, name: "Portal 2" }, { appId: 413150, name: "Stardew Valley" }]);
    expect(await h.call(h.owner, "importSteam", { accountId: steam.id })).toEqual({ added: 1, alreadyPresent: 2, failed: 0, addedNames: ["Stardew Valley"] });
    const after = await allGames();
    expect(after.filter((g: { name: string }) => g.name !== "Stardew Valley")).toEqual(before);
  });

  it("a manual Game with the same normalised name gets the Steam Copy instead of a duplicate; its manual Copies are untouched", async () => {
    const steam = await steamAccount();
    const witcher = await h.call(h.owner, "addGame", { name: "the witcher 3 wild hunt" });
    const withPs5 = await h.call(h.owner, "addCopy", { gameId: witcher.id, platformId: await platformId("PS5"), format: "Physical", edition: "GOTY" });
    h.steam.set(STEAM_ID, [{ appId: 292030, name: "The Witcher® 3: Wild Hunt" }]);

    expect(await h.call(h.owner, "importSteam", { accountId: steam.id })).toMatchObject({ added: 1, alreadyPresent: 0 });

    const games = await allGames();
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ id: witcher.id, name: "the witcher 3 wild hunt", steamAppId: 292030 });
    expect(games[0].copies).toHaveLength(2);
    expect(games[0].copies).toContainEqual(withPs5.copies[0]);
    expect(games[0].copies).toContainEqual(expect.objectContaining({ format: "Digital", accountId: steam.id, platformId: await platformId("PC") }));
    // Matched by app ID from now on.
    expect(await h.call(h.owner, "importSteam", { accountId: steam.id })).toMatchObject({ added: 0, alreadyPresent: 1 });
  });

  it("a Wishlist Game that turns up in the library leaves the Wishlist as Backlog", async () => {
    const steam = await steamAccount();
    const g = await h.call(h.owner, "addGame", { name: "Hades" });
    await h.call(h.owner, "setWishlist", { gameId: g.id, wishlist: true });
    h.steam.set(STEAM_ID, [{ appId: 1145360, name: "Hades" }]);
    await h.call(h.owner, "importSteam", { accountId: steam.id });
    expect((await allGames())[0]).toMatchObject({ owned: true, wishlist: false, playStatus: "Backlog" });
  });

  it("a Copy I already added by hand on this Account counts as already present; no second Copy", async () => {
    const steam = await steamAccount();
    const g = await h.call(h.owner, "addGame", { name: "Hades" });
    const manual = await h.call(h.owner, "addCopy", { gameId: g.id, platformId: await platformId("PC"), format: "Digital", accountId: steam.id });
    h.steam.set(STEAM_ID, [{ appId: 1145360, name: "Hades" }]);

    expect(await h.call(h.owner, "importSteam", { accountId: steam.id })).toEqual({ added: 0, alreadyPresent: 1, failed: 0, addedNames: [] });
    const [game] = await allGames();
    expect(game.copies).toEqual(manual.copies);
    expect(game.steamAppId).toBe(1145360);
  });

  it("two Steam Accounts owning the same game give one Game with a Copy on each", async () => {
    const main = await steamAccount("main", STEAM_ID);
    const family = await steamAccount("family", "76561190000000002");
    h.steam.set(STEAM_ID, [{ appId: 620, name: "Portal 2" }]);
    h.steam.set("76561190000000002", [{ appId: 620, name: "Portal 2" }]);
    await h.call(h.owner, "importSteam", { accountId: main.id });
    expect(await h.call(h.owner, "importSteam", { accountId: family.id })).toMatchObject({ added: 1, alreadyPresent: 0 });
    const games = await allGames();
    expect(games).toHaveLength(1);
    expect(games[0].copies.map((c: { accountId: string }) => c.accountId).sort()).toEqual([main.id, family.id].sort());
  });

  it("a library entry listed twice, or with no name, still lands once", async () => {
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, [{ appId: 620, name: "Portal 2" }, { appId: 620, name: "Portal 2" }, { appId: 999, name: "" }]);
    expect(await h.call(h.owner, "importSteam", { accountId: steam.id })).toEqual({
      added: 2, alreadyPresent: 0, failed: 0, addedNames: ["Portal 2", "Steam app 999"],
    });
  });

  it("re-creates the PC Platform if I deleted it", async () => {
    const steam = await steamAccount();
    await h.call(h.owner, "deletePlatform", { id: await platformId("PC") });
    h.steam.set(STEAM_ID, [{ appId: 620, name: "Portal 2" }]);
    await h.call(h.owner, "importSteam", { accountId: steam.id });
    expect((await allGames())[0].copies[0].platformId).toBe(await platformId("PC"));
  });

  it("uses my PC Platform whatever its case", async () => {
    const steam = await steamAccount();
    const pc = await platformId("PC");
    await h.call(h.owner, "renamePlatform", { id: pc, name: "pc" });
    h.steam.set(STEAM_ID, [{ appId: 620, name: "Portal 2" }]);
    await h.call(h.owner, "importSteam", { accountId: steam.id });
    expect((await allGames())[0].copies[0].platformId).toBe(pc);
    expect((await h.call(h.owner, "platforms")).filter((p: { name: string }) => p.name.toLowerCase() === "pc")).toHaveLength(1);
  });

  it("an Account with imported Copies can't be deleted", async () => {
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, [{ appId: 620, name: "Portal 2" }]);
    await h.call(h.owner, "importSteam", { accountId: steam.id });
    await expect(h.call(h.owner, "deleteAccount", { id: steam.id })).rejects.toThrow("Conflict");
  });
});

describe("Import from Steam: errors", () => {
  it("needs a Steam Account with a Steam ID", async () => {
    const gog = await h.call(h.owner, "addAccount", { store: "GOG", nickname: "main" });
    await expect(h.call(h.owner, "importSteam", { accountId: gog.id })).rejects.toThrow(/ValidationError: .*Steam/);
    const steam = await h.call(h.owner, "addAccount", { store: "Steam", nickname: "main" });
    await expect(h.call(h.owner, "importSteam", { accountId: steam.id })).rejects.toThrow(/ValidationError: Set a Steam ID on "Steam: main"/);
    expect(h.steam.calls).toEqual([]);
  });

  it("can't import into another user's Account", async () => {
    const theirs = await h.call(h.stranger, "addAccount", { store: "Steam", nickname: "main" });
    await h.call(h.stranger, "setSteamId", { accountId: theirs.id, steamId: STEAM_ID });
    await expect(h.call(h.owner, "importSteam", { accountId: theirs.id })).rejects.toThrow("NotFound");
    expect(h.steam.calls).toEqual([]);
  });

  it("a private profile or a missing key is a clear SteamError, and nothing is added", async () => {
    const steam = await steamAccount();
    h.steam.set(STEAM_ID, new SteamError("private", "Steam won't share this library: set Game details to Public"));
    await expect(h.call(h.owner, "importSteam", { accountId: steam.id })).rejects.toThrow(/^SteamError: Steam won't share this library/);
    h.steam.set(STEAM_ID, new SteamError("noKey", "The Steam Web API key isn't set up yet"));
    await expect(h.call(h.owner, "importSteam", { accountId: steam.id })).rejects.toThrow(/^SteamError: The Steam Web API key isn't set up/);
    expect(await allGames()).toEqual([]);
  });

  it("one Game changing mid-Import fails only that entry; a re-run picks it up", async () => {
    const steam = await steamAccount();
    const g = await h.call(h.owner, "addGame", { name: "Hades" });
    h.steam.set(STEAM_ID, [{ appId: 1145360, name: "Hades" }, { appId: 620, name: "Portal 2" }]);
    // Simulate a racing edit: bump the Game's updatedAt just before the Import writes its Copy.
    const realSend = h.db.send.bind(h.db);
    let bumped = false;
    h.db.send = async (cmd: any) => {
      if (!bumped && cmd.constructor.name === "TransactWriteCommand" && JSON.stringify(cmd.input).includes("GAME#" + g.id)) {
        bumped = true;
        const pk = "OWNER#" + h.owner.userId;
        const rec = h.db.dump().find((r) => r.PK === pk && r.SK === "GAME#" + g.id)!;
        h.db.seed({ ...rec, updatedAt: (rec.updatedAt as number) + 1000 });
      }
      return realSend(cmd);
    };
    try {
      const first = await h.call(h.owner, "importSteam", { accountId: steam.id });
      expect(first.added + first.failed).toBe(2);
      expect(first.failed).toBe(1);
    } finally {
      h.db.send = realSend;
    }
    expect(await h.call(h.owner, "importSteam", { accountId: steam.id })).toMatchObject({ added: 1, alreadyPresent: 1, failed: 0 });
    expect(await allGames()).toHaveLength(2);
  });
});
