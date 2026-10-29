import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(() => h.reset());

async function pcId(): Promise<string> {
  return (await h.call(h.owner, "platforms")).find((p: { name: string }) => p.name === "PC").id;
}

const onlyGame = async () => (await h.call(h.owner, "games"))[0];

describe("Wishlist", () => {
  it("I can put an unowned Game on the Wishlist and take it off", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Silksong" });
    expect(await h.call(h.owner, "setWishlist", { gameId: game.id, wishlist: true })).toMatchObject({ wishlist: true, owned: false });
    expect(await onlyGame()).toMatchObject({ wishlist: true });
    expect(await h.call(h.owner, "setWishlist", { gameId: game.id, wishlist: false })).toMatchObject({ wishlist: false });
  });

  it("can't be set on an Owned Game, and nothing changes", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Hades" });
    await h.call(h.owner, "addCopy", { gameId: game.id, platformId: await pcId(), format: "Digital" });
    await expect(h.call(h.owner, "setWishlist", { gameId: game.id, wishlist: true })).rejects.toThrow("ValidationError");
    expect(await onlyGame()).toMatchObject({ wishlist: false, owned: true });
  });

  it("buying a Wishlist Game: adding its Copy clears Wishlist and puts it in the Backlog", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Silksong" });
    await h.call(h.owner, "setWishlist", { gameId: game.id, wishlist: true });

    const bought = await h.call(h.owner, "addCopy", { gameId: game.id, platformId: await pcId(), format: "Digital" });
    expect(bought).toMatchObject({ owned: true, wishlist: false, playStatus: "Backlog" });
    expect(await onlyGame()).toMatchObject({ owned: true, wishlist: false, playStatus: "Backlog" });
  });

  it("adding a Copy to a Game that isn't on the Wishlist leaves its Play status alone", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Hades" });
    const withCopy = await h.call(h.owner, "addCopy", { gameId: game.id, platformId: await pcId(), format: "Digital" });
    expect(withCopy.playStatus).toBeNull();
  });

  it("removing the last Copy doesn't put a Game back on the Wishlist", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Hades" });
    const added = await h.call(h.owner, "addCopy", { gameId: game.id, platformId: await pcId(), format: "Digital" });
    expect(await h.call(h.owner, "removeCopy", { gameId: game.id, copyId: added.copies[0].id })).toMatchObject({
      owned: false, wishlist: false,
    });
  });
});

describe("Play status", () => {
  it("I can set Playing, Backlog or Finished, and clear it to none", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Hades" });
    for (const playStatus of ["Playing", "Backlog", "Finished"]) {
      expect((await h.call(h.owner, "setPlayStatus", { gameId: game.id, playStatus })).playStatus).toBe(playStatus);
      expect((await onlyGame()).playStatus).toBe(playStatus);
    }
    expect((await h.call(h.owner, "setPlayStatus", { gameId: game.id, playStatus: null })).playStatus).toBeNull();
    expect((await onlyGame()).playStatus).toBeNull();
  });

  it("is independent of ownership: an unowned Game can have one", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Hades" });
    expect(await h.call(h.owner, "setPlayStatus", { gameId: game.id, playStatus: "Finished" })).toMatchObject({
      owned: false, playStatus: "Finished",
    });
  });

  it("rejects an unknown Play status", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Hades" });
    await expect(h.call(h.owner, "setPlayStatus", { gameId: game.id, playStatus: "Abandoned" })).rejects.toThrow("ValidationError");
  });

  it("setting it on a Game that doesn't exist, or someone else's, is NotFound", async () => {
    const theirs = await h.call(h.stranger, "addGame", { name: "Tetris" });
    await expect(h.call(h.owner, "setPlayStatus", { gameId: theirs.id, playStatus: "Playing" })).rejects.toThrow("NotFound");
    await expect(h.call(h.owner, "setWishlist", { gameId: "nope", wishlist: true })).rejects.toThrow("NotFound");
  });
});

describe("Owned", () => {
  it("can't be set by hand", async () => {
    await expect(h.call(h.owner, "setOwned", { gameId: "x", owned: true })).rejects.toThrow("no resolver");
  });

  it("Games from before Copies existed read as unowned, not on the Wishlist, no Play status", async () => {
    h.db.seed({ PK: "OWNER#sub-owner", SK: "GAME#old", id: "old", name: "Old", createdAt: 1, updatedAt: 1 });
    expect(await onlyGame()).toEqual({
      id: "old", name: "Old", copies: [], owned: false, wishlist: false, playStatus: null, createdAt: 1, updatedAt: 1,
    });
  });
});
