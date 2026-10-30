import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(() => h.reset());

const names = (games: { name: string }[]) => games.map((g) => g.name);

describe("adding and listing Games", () => {
  it("a Game I add shows in my list", async () => {
    const added = await h.call(h.owner, "addGame", { name: "Hades" });
    expect(added).toMatchObject({ name: "Hades" });
    expect(typeof added.id).toBe("string");

    expect(await h.call(h.owner, "games")).toEqual([added]);
  });

  it("another signed-in user never sees my Games, and I never see theirs", async () => {
    await h.call(h.owner, "addGame", { name: "Hades" });
    await h.call(h.stranger, "addGame", { name: "Tetris" });

    expect(names(await h.call(h.owner, "games"))).toEqual(["Hades"]);
    expect(names(await h.call(h.stranger, "games"))).toEqual(["Tetris"]);
  });

  it("lists my Games in name order, ignoring case", async () => {
    for (const name of ["zelda", "Hades", "celeste", "Balatro"]) await h.call(h.owner, "addGame", { name });
    expect(names(await h.call(h.owner, "games"))).toEqual(["Balatro", "celeste", "Hades", "zelda"]);
  });

  it("rejects a call with no signed-in user", async () => {
    await expect(h.invoke({ ...h.event(h.owner, "games"), identity: null })).rejects.toThrow("Forbidden");
  });
});

describe("Game names", () => {
  it("trims surrounding whitespace", async () => {
    expect((await h.call(h.owner, "addGame", { name: "  The Witcher 3  " })).name).toBe("The Witcher 3");
  });

  it("rejects a blank name and stores nothing", async () => {
    await expect(h.call(h.owner, "addGame", { name: "   " })).rejects.toThrow("ValidationError");
    expect(await h.call(h.owner, "games")).toEqual([]);
  });

  it("rejects a name over 200 characters", async () => {
    await expect(h.call(h.owner, "addGame", { name: "x".repeat(201) })).rejects.toThrow("ValidationError");
  });
});
