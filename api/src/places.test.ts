import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(() => h.reset());

const platformId = async (name: string): Promise<string> =>
  (await h.call(h.owner, "platforms")).find((p: { name: string }) => p.name === name).id;

describe("Places", () => {
  it("I add a Place, give it Platforms, and the list shows it", async () => {
    const couch = await h.call(h.owner, "addPlace", { name: "  Couch " });
    expect(couch).toMatchObject({ name: "Couch", platformIds: [] });
    const [xsx, sw2] = [await platformId("Xbox Series X|S"), await platformId("Switch 2")];
    const set = await h.call(h.owner, "setPlacePlatforms", { id: couch.id, platformIds: [xsx, sw2, xsx] });
    expect(set.platformIds).toEqual([xsx, sw2]);
    expect(await h.call(h.owner, "places")).toEqual([set]);
  });

  it("a Platform can be in several Places", async () => {
    const pc = await platformId("PC");
    const a = await h.call(h.owner, "addPlace", { name: "Game room" });
    const b = await h.call(h.owner, "addPlace", { name: "Office" });
    await h.call(h.owner, "setPlacePlatforms", { id: a.id, platformIds: [pc] });
    await h.call(h.owner, "setPlacePlatforms", { id: b.id, platformIds: [pc] });
    expect((await h.call(h.owner, "places")).map((p: { platformIds: string[] }) => p.platformIds)).toEqual([[pc], [pc]]);
  });

  it("names are unique ignoring case, and 1-50 characters", async () => {
    await h.call(h.owner, "addPlace", { name: "Couch" });
    await expect(h.call(h.owner, "addPlace", { name: "couch" })).rejects.toThrow("ValidationError");
    await expect(h.call(h.owner, "addPlace", { name: " " })).rejects.toThrow("ValidationError");
    await expect(h.call(h.owner, "addPlace", { name: "x".repeat(51) })).rejects.toThrow("ValidationError");
  });

  it("rename and delete", async () => {
    const p = await h.call(h.owner, "addPlace", { name: "Couch" });
    expect((await h.call(h.owner, "renamePlace", { id: p.id, name: "Living room" })).name).toBe("Living room");
    expect(await h.call(h.owner, "deletePlace", { id: p.id })).toBe(p.id);
    expect(await h.call(h.owner, "places")).toEqual([]);
  });

  it("only my own Platforms can go in a Place", async () => {
    const p = await h.call(h.owner, "addPlace", { name: "Couch" });
    const theirs = (await h.call(h.stranger, "platforms"))[0].id;
    await expect(h.call(h.owner, "setPlacePlatforms", { id: p.id, platformIds: [theirs] })).rejects.toThrow("NotFound");
    await expect(h.call(h.owner, "setPlacePlatforms", { id: p.id, platformIds: "pc" })).rejects.toThrow("ValidationError");
  });

  it("a deleted Platform drops out of its Places", async () => {
    const wii = await h.call(h.owner, "addPlatform", { name: "Wii" });
    const p = await h.call(h.owner, "addPlace", { name: "Couch" });
    await h.call(h.owner, "setPlacePlatforms", { id: p.id, platformIds: [wii.id, await platformId("Switch 2")] });
    await h.call(h.owner, "deletePlatform", { id: wii.id });
    expect((await h.call(h.owner, "places"))[0].platformIds).toEqual([await platformId("Switch 2")]);
  });

  it("someone else's Place is NotFound and never listed", async () => {
    const theirs = await h.call(h.stranger, "addPlace", { name: "Their couch" });
    await expect(h.call(h.owner, "renamePlace", { id: theirs.id, name: "Mine" })).rejects.toThrow("NotFound");
    await expect(h.call(h.owner, "deletePlace", { id: theirs.id })).rejects.toThrow("NotFound");
    expect(await h.call(h.owner, "places")).toEqual([]);
  });
});
