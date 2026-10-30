import { SIMPLE_TAGS, byName } from "@games/shared";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConditionalCheckFailedException } from "./testing/fakeDynamo";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(() => h.reset());

const names = (ts: { name: string }[]) => ts.map((t) => t.name);

describe("Tags", () => {
  it("starts seeded with the simple Tag list, sorted by name", async () => {
    const seeded = names(await h.call(h.owner, "tags"));
    expect([...seeded].sort()).toEqual([...SIMPLE_TAGS].sort());
    expect(seeded).toEqual(SIMPLE_TAGS.map((name: string) => ({ name })).sort(byName).map((t: { name: string }) => t.name));
  });

  it("I can add a Tag, and it shows in the list", async () => {
    const added = await h.call(h.owner, "addTag", { name: "  roguelike " });
    expect(added).toMatchObject({ name: "roguelike" });
    expect(await h.call(h.owner, "tags")).toContainEqual(added);
  });

  it("rejects a blank Tag name or one that already exists, ignoring case", async () => {
    await expect(h.call(h.owner, "addTag", { name: " " })).rejects.toThrow("ValidationError");
    await expect(h.call(h.owner, "addTag", { name: "Co-Op" })).rejects.toThrow("ValidationError");
  });

  it("I can rename a Tag, but not onto another Tag's name", async () => {
    const t = await h.call(h.owner, "addTag", { name: "rogulike" });
    expect(await h.call(h.owner, "renameTag", { id: t.id, name: "roguelike" })).toEqual({ id: t.id, name: "roguelike" });
    expect(names(await h.call(h.owner, "tags"))).toContain("roguelike");
    await expect(h.call(h.owner, "renameTag", { id: t.id, name: "Versus" })).rejects.toThrow("ValidationError");
  });

  it("seeds only once: Tags I delete stay deleted", async () => {
    const versus = (await h.call(h.owner, "tags")).find((t: { name: string }) => t.name === "Versus");
    expect(await h.call(h.owner, "deleteTag", { id: versus.id })).toBe(versus.id);
    expect(names(await h.call(h.owner, "tags"))).not.toContain("Versus");
  });

  it("renaming, merging or deleting a Tag that doesn't exist is NotFound", async () => {
    const t = await h.call(h.owner, "addTag", { name: "roguelike" });
    await expect(h.call(h.owner, "renameTag", { id: "nope", name: "X" })).rejects.toThrow("NotFound");
    await expect(h.call(h.owner, "deleteTag", { id: "nope" })).rejects.toThrow("NotFound");
    await expect(h.call(h.owner, "mergeTags", { fromId: "nope", intoId: t.id })).rejects.toThrow("NotFound");
    await expect(h.call(h.owner, "mergeTags", { fromId: t.id, intoId: "nope" })).rejects.toThrow("NotFound");
  });

  it("another user's Tags are separate from mine", async () => {
    await h.call(h.owner, "addTag", { name: "roguelike" });
    expect(names(await h.call(h.stranger, "tags"))).not.toContain("roguelike");
    const theirs = (await h.call(h.stranger, "tags"))[0];
    await expect(h.call(h.owner, "deleteTag", { id: theirs.id })).rejects.toThrow("NotFound");
  });
});

async function tagId(name: string): Promise<string> {
  const t = (await h.call(h.owner, "tags")).find((x: { name: string }) => x.name === name);
  if (!t) throw new Error(`no Tag ${name}`);
  return t.id;
}

const gameRecord = (id: string) => h.db.dump().find((r) => r.SK === "GAME#" + id)!;
const onlyGame = async () => (await h.call(h.owner, "games"))[0];

describe("Tags on a Game", () => {
  it("a new Game has no Tags", async () => {
    expect((await h.call(h.owner, "addGame", { name: "Hades" })).tags).toEqual([]);
  });

  it("I add Tags to a Game; each link records Tag source = Manual", async () => {
    const game = await h.call(h.owner, "addGame", { name: "It Takes Two" });
    const coop = await tagId("Co-op");
    const narrative = await tagId("Sports");
    await h.call(h.owner, "addGameTag", { gameId: game.id, tagId: coop });
    const updated = await h.call(h.owner, "addGameTag", { gameId: game.id, tagId: narrative });
    expect(updated.tags).toEqual([{ tagId: coop, source: "Manual" }, { tagId: narrative, source: "Manual" }]);
    expect((await onlyGame()).tags).toEqual(updated.tags);
    // Adding it again changes nothing.
    expect((await h.call(h.owner, "addGameTag", { gameId: game.id, tagId: coop })).tags).toEqual(updated.tags);
  });

  it("I remove a Tag from a Game, and the removal is kept for later Imports", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Portal 2" });
    const coop = await tagId("Co-op");
    await h.call(h.owner, "addGameTag", { gameId: game.id, tagId: coop });
    expect((await h.call(h.owner, "removeGameTag", { gameId: game.id, tagId: coop })).tags).toEqual([]);
    expect((await onlyGame()).tags).toEqual([]);
    // Ticket 08's Import reads this from the Game record (see shared importTags).
    expect(gameRecord(game.id).removedTagIds).toEqual([coop]);
    expect((await onlyGame()).removedTagIds).toBeUndefined();
  });

  it("Tags I removed can be added back by hand", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Portal 2" });
    const coop = await tagId("Co-op");
    await h.call(h.owner, "addGameTag", { gameId: game.id, tagId: coop });
    await h.call(h.owner, "removeGameTag", { gameId: game.id, tagId: coop });
    expect((await h.call(h.owner, "addGameTag", { gameId: game.id, tagId: coop })).tags).toEqual([{ tagId: coop, source: "Manual" }]);
    expect(gameRecord(game.id).removedTagIds).toEqual([]);
  });

  it("an imported link reads back with Tag source = Import, and adding it by hand makes it Manual", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Deep Rock Galactic" });
    const coop = await tagId("Co-op");
    h.db.seed({ ...gameRecord(game.id), tags: [{ tagId: coop, source: "Import" }] });
    expect((await onlyGame()).tags).toEqual([{ tagId: coop, source: "Import" }]);
    expect((await h.call(h.owner, "addGameTag", { gameId: game.id, tagId: coop })).tags).toEqual([{ tagId: coop, source: "Manual" }]);
  });

  it("Copy, Wishlist and Play status changes keep the Game's Tags", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Celeste" });
    const platformer = await tagId("Racing");
    await h.call(h.owner, "addGameTag", { gameId: game.id, tagId: platformer });
    const pc = (await h.call(h.owner, "platforms")).find((p: { name: string }) => p.name === "PC").id;
    await h.call(h.owner, "setWishlist", { gameId: game.id, wishlist: true });
    const withCopy = await h.call(h.owner, "addCopy", { gameId: game.id, platformId: pc, format: "Physical" });
    expect(withCopy.tags).toEqual([{ tagId: platformer, source: "Manual" }]);
    await h.call(h.owner, "setPlayStatus", { gameId: game.id, playStatus: "Finished" });
    await h.call(h.owner, "removeCopy", { gameId: game.id, copyId: withCopy.copies[0].id });
    expect((await onlyGame()).tags).toEqual([{ tagId: platformer, source: "Manual" }]);
  });

  it("adding a Tag that doesn't exist, or to a Game that doesn't, is NotFound", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Hades" });
    await expect(h.call(h.owner, "addGameTag", { gameId: game.id, tagId: "nope" })).rejects.toThrow("NotFound");
    await expect(h.call(h.owner, "addGameTag", { gameId: "nope", tagId: await tagId("Co-op") })).rejects.toThrow("NotFound");
    await expect(h.call(h.owner, "removeGameTag", { gameId: "nope", tagId: "x" })).rejects.toThrow("NotFound");
  });

  it("deleting a Tag removes it from every Game, removal records included", async () => {
    const a = await h.call(h.owner, "addGame", { name: "Portal 2" });
    const b = await h.call(h.owner, "addGame", { name: "It Takes Two" });
    const coop = await tagId("Co-op");
    const narrative = await tagId("Sports");
    await h.call(h.owner, "addGameTag", { gameId: a.id, tagId: coop });
    await h.call(h.owner, "addGameTag", { gameId: b.id, tagId: coop });
    await h.call(h.owner, "addGameTag", { gameId: b.id, tagId: narrative });
    await h.call(h.owner, "addGameTag", { gameId: a.id, tagId: narrative });
    await h.call(h.owner, "removeGameTag", { gameId: a.id, tagId: narrative });

    await h.call(h.owner, "deleteTag", { id: coop });
    await h.call(h.owner, "deleteTag", { id: narrative });
    const games = await h.call(h.owner, "games");
    expect(games.map((g: { tags: unknown[] }) => g.tags)).toEqual([[], []]);
    expect(gameRecord(a.id).removedTagIds).toEqual([]);
  });

  it("merging a Tag moves its links onto the other Tag, once per Game, Manual winning", async () => {
    const a = await h.call(h.owner, "addGame", { name: "Portal 2" });
    const b = await h.call(h.owner, "addGame", { name: "Deep Rock Galactic" });
    const coop = await tagId("Co-op");
    const coop2 = (await h.call(h.owner, "addTag", { name: "Co-operative" })).id;
    await h.call(h.owner, "addGameTag", { gameId: a.id, tagId: coop2 });
    // b has both: co-op from an Import and Co-operative by hand.
    h.db.seed({ ...gameRecord(b.id), tags: [{ tagId: coop, source: "Import" }] });
    await h.call(h.owner, "addGameTag", { gameId: b.id, tagId: coop2 });

    expect(await h.call(h.owner, "mergeTags", { fromId: coop2, intoId: coop })).toMatchObject({ id: coop, name: "Co-op" });
    expect(names(await h.call(h.owner, "tags"))).not.toContain("Co-operative");
    const byName = Object.fromEntries((await h.call(h.owner, "games")).map((g: { name: string; tags: unknown }) => [g.name, g.tags]));
    expect(byName["Portal 2"]).toEqual([{ tagId: coop, source: "Manual" }]);
    expect(byName["Deep Rock Galactic"]).toEqual([{ tagId: coop, source: "Manual" }]);
  });

  it("merging carries a removal over, so an Import still respects it", async () => {
    const a = await h.call(h.owner, "addGame", { name: "Portal 2" });
    const coop = await tagId("Co-op");
    const coop2 = (await h.call(h.owner, "addTag", { name: "Co-operative" })).id;
    await h.call(h.owner, "addGameTag", { gameId: a.id, tagId: coop2 });
    await h.call(h.owner, "removeGameTag", { gameId: a.id, tagId: coop2 });
    await h.call(h.owner, "mergeTags", { fromId: coop2, intoId: coop });
    expect(gameRecord(a.id).removedTagIds).toEqual([coop]);
  });

  it("a Tag can't be merged into itself", async () => {
    const coop = await tagId("Co-op");
    await expect(h.call(h.owner, "mergeTags", { fromId: coop, intoId: coop })).rejects.toThrow("ValidationError");
  });

  it("another user's Tag can't be put on my Game", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Hades" });
    const theirs = (await h.call(h.stranger, "tags"))[0];
    await expect(h.call(h.owner, "addGameTag", { gameId: game.id, tagId: theirs.id })).rejects.toThrow("NotFound");
  });
});

describe("Tag delete and merge when a Game can't be rewritten", () => {
  const realSend = h.db.send.bind(h.db);
  afterEach(() => {
    h.db.send = realSend;
  });

  /** Every write to this Game fails as if it kept changing under us, until `heal()`. */
  function keepChanging(gameId: string) {
    h.db.send = async (cmd: unknown) => {
      if (cmd instanceof PutCommand && cmd.input.Item?.SK === "GAME#" + gameId) {
        throw new ConditionalCheckFailedException("put condition failed");
      }
      return realSend(cmd);
    };
    return { heal: () => (h.db.send = realSend) };
  }

  it("a delete that can't rewrite a Game fails and leaves the Tag, so no Game points at a missing Tag; retrying finishes it", async () => {
    const a = await h.call(h.owner, "addGame", { name: "Portal 2" });
    const coop = await tagId("Co-op");
    await h.call(h.owner, "addGameTag", { gameId: a.id, tagId: coop });
    const fault = keepChanging(a.id);

    await expect(h.call(h.owner, "deleteTag", { id: coop })).rejects.toThrow("Conflict");
    expect(names(await h.call(h.owner, "tags"))).toContain("Co-op");

    fault.heal();
    await h.call(h.owner, "deleteTag", { id: coop });
    expect(names(await h.call(h.owner, "tags"))).not.toContain("Co-op");
    expect((await h.call(h.owner, "games"))[0].tags).toEqual([]);
  });

  it("a merge that can't rewrite a Game fails and leaves both Tags; retrying finishes it", async () => {
    const a = await h.call(h.owner, "addGame", { name: "Portal 2" });
    const coop = await tagId("Co-op");
    const coop2 = (await h.call(h.owner, "addTag", { name: "Co-operative" })).id;
    await h.call(h.owner, "addGameTag", { gameId: a.id, tagId: coop2 });
    const fault = keepChanging(a.id);

    await expect(h.call(h.owner, "mergeTags", { fromId: coop2, intoId: coop })).rejects.toThrow("Conflict");
    expect(names(await h.call(h.owner, "tags"))).toContain("Co-operative");

    fault.heal();
    await h.call(h.owner, "mergeTags", { fromId: coop2, intoId: coop });
    expect((await h.call(h.owner, "games"))[0].tags).toEqual([{ tagId: coop, source: "Manual" }]);
  });

  it("while a delete is unfinished, the Tag can't be put on another Game", async () => {
    const a = await h.call(h.owner, "addGame", { name: "Portal 2" });
    const b = await h.call(h.owner, "addGame", { name: "Hades" });
    const coop = await tagId("Co-op");
    await h.call(h.owner, "addGameTag", { gameId: a.id, tagId: coop });
    keepChanging(a.id);
    await expect(h.call(h.owner, "deleteTag", { id: coop })).rejects.toThrow("Conflict");

    await expect(h.call(h.owner, "addGameTag", { gameId: b.id, tagId: coop })).rejects.toThrow("NotFound");
  });
});
