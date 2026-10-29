import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(() => h.reset());

const names = (ps: { name: string }[]) => ps.map((p) => p.name);

describe("Platforms", () => {
  it("starts seeded with common Platforms", async () => {
    expect(names(await h.call(h.owner, "platforms"))).toEqual(
      expect.arrayContaining(["PC", "PS5", "PS4", "Switch", "Xbox Series X|S"]),
    );
  });

  it("seeds only once: Platforms I delete stay deleted", async () => {
    const pc = (await h.call(h.owner, "platforms")).find((p: { name: string }) => p.name === "PC");
    await h.call(h.owner, "deletePlatform", { id: pc.id });
    expect(names(await h.call(h.owner, "platforms"))).not.toContain("PC");
  });

  it("I can add a Platform, and it shows in the list", async () => {
    const added = await h.call(h.owner, "addPlatform", { name: "  Steam Deck " });
    expect(added).toMatchObject({ name: "Steam Deck" });
    expect(await h.call(h.owner, "platforms")).toContainEqual(added);
  });

  it("rejects a Platform name that already exists, ignoring case", async () => {
    await expect(h.call(h.owner, "addPlatform", { name: "ps5" })).rejects.toThrow("ValidationError");
  });

  it("rejects a blank Platform name", async () => {
    await expect(h.call(h.owner, "addPlatform", { name: " " })).rejects.toThrow("ValidationError");
  });

  it("I can rename a Platform", async () => {
    const p = await h.call(h.owner, "addPlatform", { name: "Stem Deck" });
    expect(await h.call(h.owner, "renamePlatform", { id: p.id, name: "Steam Deck" })).toEqual({ id: p.id, name: "Steam Deck" });
    expect(names(await h.call(h.owner, "platforms"))).toContain("Steam Deck");
    expect(names(await h.call(h.owner, "platforms"))).not.toContain("Stem Deck");
  });

  it("can change only the case of a Platform's name, but not rename it onto another", async () => {
    const p = await h.call(h.owner, "addPlatform", { name: "steam deck" });
    expect((await h.call(h.owner, "renamePlatform", { id: p.id, name: "Steam Deck" })).name).toBe("Steam Deck");
    await expect(h.call(h.owner, "renamePlatform", { id: p.id, name: "PC" })).rejects.toThrow("ValidationError");
  });

  it("renaming or deleting a Platform that doesn't exist is NotFound", async () => {
    await expect(h.call(h.owner, "renamePlatform", { id: "nope", name: "X" })).rejects.toThrow("NotFound");
    await expect(h.call(h.owner, "deletePlatform", { id: "nope" })).rejects.toThrow("NotFound");
  });

  it("another user's Platforms are separate from mine", async () => {
    await h.call(h.owner, "addPlatform", { name: "Steam Deck" });
    expect(names(await h.call(h.stranger, "platforms"))).not.toContain("Steam Deck");
    const theirs = (await h.call(h.stranger, "platforms"))[0];
    await expect(h.call(h.owner, "deletePlatform", { id: theirs.id })).rejects.toThrow("NotFound");
  });
});
