import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(() => h.reset());

const byName = async (name: string, caller = h.owner) =>
  (await h.call(caller, "games")).find((g: { name: string }) => g.name === name);

describe("the Seed", () => {
  it("turns Not owned into a Wishlist Game, Owned into an Unknown Copy, Playing into that plus Playing", async () => {
    await h.seed(h.owner, [
      { name: "Hades 2", status: "Not owned" },
      { name: "Hades", status: "Owned" },
      { name: "Stardew Valley", status: "Playing" },
    ]);

    expect(await byName("Hades 2")).toMatchObject({ copies: [], owned: false, wishlist: true, playStatus: null });
    const hades = await byName("Hades");
    expect(hades).toMatchObject({ owned: true, wishlist: false, playStatus: null });
    expect(hades.copies).toHaveLength(1);
    expect(hades.copies[0].platformId).toBeUndefined();
    expect(hades.copies[0].format).toBeUndefined();
    expect(hades.copies[0].accountId).toBeUndefined();
    expect(await byName("Stardew Valley")).toMatchObject({ owned: true, playStatus: "Playing", copies: [expect.any(Object)] });
  });

  it("a re-run adds nothing and leaves the Seeded Games as they are", async () => {
    const rows = [
      { name: "Hades", status: "Owned" },
      { name: "Balatro", status: "Not owned" },
    ];
    expect(await h.seed(h.owner, rows)).toEqual({ added: ["Hades", "Balatro"], present: [] });
    const before = await h.call(h.owner, "games");

    expect(await h.seed(h.owner, rows)).toEqual({ added: [], present: ["Hades", "Balatro"] });
    expect(await h.call(h.owner, "games")).toEqual(before);
  });

  it("skips a row whose Game is already in the catalog under the same name, ignoring case and punctuation", async () => {
    const mine = await h.call(h.owner, "addGame", { name: "half life 2" });

    expect(await h.seed(h.owner, [{ name: "Half-Life 2", status: "Owned" }])).toEqual({ added: [], present: ["Half-Life 2"] });
    expect(await h.call(h.owner, "games")).toEqual([mine]);
  });

  it("seeds only the owner it is given", async () => {
    await h.seed(h.owner, [{ name: "Hades", status: "Owned" }]);

    expect(await h.call(h.stranger, "games")).toEqual([]);
  });

  it("a dry run reports what it would add and writes nothing", async () => {
    expect(await h.seed(h.owner, [{ name: "Hades", status: "Owned" }], { dryRun: true })).toEqual({ added: ["Hades"], present: [] });
    expect(await h.call(h.owner, "games")).toEqual([]);
  });

  it.each([
    ["an unknown status", [{ name: "Hades", status: "Lent" }], /status must be Playing, Owned, Not owned/],
    ["a blank name", [{ name: "  ", status: "Owned" }], /Game name must be/],
    ["the same Game twice", [{ name: "Hades", status: "Owned" }, { name: "HADES", status: "Playing" }], /repeats "Hades"/],
  ])("refuses %s and writes nothing", async (_what, rows, message) => {
    await expect(h.seed(h.owner, [{ name: "Balatro", status: "Not owned" }, ...rows])).rejects.toThrow(message);
    expect(await h.call(h.owner, "games")).toEqual([]);
  });
});

describe("the checked-in Notion data", () => {
  it("seeds 29 Games: 2 Playing, 17 Owned, 10 on the Wishlist", async () => {
    const rows = JSON.parse(readFileSync(new URL("../seed/notion-gaming-catalog.json", import.meta.url), "utf8"));
    expect((await h.seed(h.owner, rows)).added).toHaveLength(29);

    const games = await h.call(h.owner, "games");
    expect(games.filter((g: { playStatus: string }) => g.playStatus === "Playing").map((g: { name: string }) => g.name)).toEqual([
      "Schedule 1",
      "Stardew Valley",
    ]);
    expect(games.filter((g: { owned: boolean }) => g.owned)).toHaveLength(19);
    expect(games.filter((g: { wishlist: boolean }) => g.wishlist)).toHaveLength(10);
    expect(await byName("The Witcher 3")).toMatchObject({ owned: true, copies: [expect.any(Object)] });
  });
});
