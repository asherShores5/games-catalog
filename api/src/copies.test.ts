import { beforeEach, describe, expect, it, vi } from "vitest";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(() => h.reset());

async function platformId(name: string, caller = h.owner): Promise<string> {
  const p = (await h.call(caller, "platforms")).find((x: { name: string }) => x.name === name);
  if (!p) throw new Error(`no seeded Platform ${name}`);
  return p.id;
}

const onlyGame = async () => (await h.call(h.owner, "games"))[0];

describe("a new Game", () => {
  it("has no Copies, isn't Owned, isn't on the Wishlist and has no Play status", async () => {
    expect(await h.call(h.owner, "addGame", { name: "Hades" })).toMatchObject({
      copies: [], owned: false, wishlist: false, playStatus: null,
    });
  });
});

describe("Copies", () => {
  it("adding a Copy makes the Game Owned and shows the Copy on it", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Elden Ring" });
    const ps5 = await platformId("PS5");
    const updated = await h.call(h.owner, "addCopy", { gameId: game.id, platformId: ps5, format: "Physical", edition: " Deluxe " });

    expect(updated.owned).toBe(true);
    expect(updated.copies).toEqual([expect.objectContaining({ platformId: ps5, format: "Physical", edition: "Deluxe" })]);
    expect(await onlyGame()).toEqual(updated);
  });

  it("a Game can have several Copies; the list shows them all, oldest first", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(1_000_000);
      const game = await h.call(h.owner, "addGame", { name: "The Witcher 3" });
      const [pc, sw, ps5] = [await platformId("PC"), await platformId("Switch"), await platformId("PS5")];
      const steam = await h.call(h.owner, "addAccount", { store: "Steam", nickname: "main" });
      for (const [i, platform] of [pc, sw, ps5].entries()) {
        vi.setSystemTime(2_000_000 + i * 1000);
        const how = i === 0 ? { format: "Digital", accountId: steam.id } : { format: "Physical" };
        await h.call(h.owner, "addCopy", { gameId: game.id, platformId: platform, ...how });
      }

      const listed = await onlyGame();
      expect(listed.copies.map((c: { platformId: string }) => c.platformId)).toEqual([pc, sw, ps5]);
      expect(listed.copies[1]).toMatchObject({ format: "Physical" });
      expect(listed.copies[1].edition).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("removing the last Copy makes the Game not Owned", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Celeste" });
    const a = await h.call(h.owner, "addCopy", { gameId: game.id, platformId: await platformId("PC"), format: "Physical" });
    const b = await h.call(h.owner, "addCopy", { gameId: game.id, platformId: await platformId("Switch"), format: "Physical" });

    const aId: string = a.copies[0].id;
    const bId: string = b.copies.find((c: { id: string }) => c.id !== aId).id;

    const afterOne = await h.call(h.owner, "removeCopy", { gameId: game.id, copyId: aId });
    expect(afterOne.owned).toBe(true);
    expect(afterOne.copies.map((c: { id: string }) => c.id)).toEqual([bId]);

    const afterBoth = await h.call(h.owner, "removeCopy", { gameId: game.id, copyId: bId });
    expect(afterBoth).toMatchObject({ owned: false, copies: [] });
    expect(await onlyGame()).toMatchObject({ owned: false, copies: [] });
  });

  it("rejects a Format other than Digital or Physical", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Hades" });
    await expect(h.call(h.owner, "addCopy", { gameId: game.id, platformId: await platformId("PC"), format: "Cloud" })).rejects.toThrow("ValidationError");
  });

  it("rejects an Edition over 100 characters", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Hades" });
    await expect(
      h.call(h.owner, "addCopy", { gameId: game.id, platformId: await platformId("PC"), format: "Physical", edition: "x".repeat(101) }),
    ).rejects.toThrow("ValidationError");
  });

  it("rejects a Platform that doesn't exist", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Hades" });
    await expect(h.call(h.owner, "addCopy", { gameId: game.id, platformId: "nope", format: "Physical" })).rejects.toThrow("NotFound");
    expect((await onlyGame()).copies).toEqual([]);
  });

  it("adding to or removing from a Game that doesn't exist is NotFound", async () => {
    await expect(h.call(h.owner, "addCopy", { gameId: "nope", platformId: await platformId("PC"), format: "Physical" })).rejects.toThrow("NotFound");
    await expect(h.call(h.owner, "removeCopy", { gameId: "nope", copyId: "nope" })).rejects.toThrow("NotFound");
  });

  it("removing a Copy that isn't on the Game is NotFound", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Hades" });
    await expect(h.call(h.owner, "removeCopy", { gameId: game.id, copyId: "nope" })).rejects.toThrow("NotFound");
  });

  it("I can't add a Copy to another user's Game, or use their Platform", async () => {
    const theirs = await h.call(h.stranger, "addGame", { name: "Tetris" });
    await expect(h.call(h.owner, "addCopy", { gameId: theirs.id, platformId: await platformId("PC"), format: "Physical" })).rejects.toThrow("NotFound");

    const mine = await h.call(h.owner, "addGame", { name: "Hades" });
    const theirPc = await platformId("PC", h.stranger);
    await expect(h.call(h.owner, "addCopy", { gameId: mine.id, platformId: theirPc, format: "Physical" })).rejects.toThrow("NotFound");
  });
});

describe("Platforms in use", () => {
  it("a Platform with a Copy on it can't be deleted, with a clear error; it can once the Copy is gone", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Hades" });
    const pc = await platformId("PC");
    const added = await h.call(h.owner, "addCopy", { gameId: game.id, platformId: pc, format: "Physical" });

    await expect(h.call(h.owner, "deletePlatform", { id: pc })).rejects.toThrow(/Conflict: .*PC.* 1 Copy/);
    await h.call(h.owner, "removeCopy", { gameId: game.id, copyId: added.copies[0].id });
    expect(await h.call(h.owner, "deletePlatform", { id: pc })).toBe(pc);
  });

  it("renaming a Platform shows on its Copies", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Hades" });
    const pc = await platformId("PC");
    await h.call(h.owner, "addCopy", { gameId: game.id, platformId: pc, format: "Physical" });
    await h.call(h.owner, "renamePlatform", { id: pc, name: "Windows PC" });

    const names = Object.fromEntries((await h.call(h.owner, "platforms")).map((p: { id: string; name: string }) => [p.id, p.name]));
    expect(names[(await onlyGame()).copies[0].platformId]).toBe("Windows PC");
  });
});
