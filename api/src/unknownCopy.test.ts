import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(() => h.reset());

async function platformId(name: string): Promise<string> {
  return (await h.call(h.owner, "platforms")).find((x: { name: string }) => x.name === name).id;
}

/** A Seeded Owned Game: one Unknown Copy. */
async function seeded(name = "Hades") {
  await h.seed(h.owner, [{ name, status: "Owned" }]);
  const game = (await h.call(h.owner, "games")).find((g: { name: string }) => g.name === name);
  return { game, copy: game.copies[0] };
}

describe("filling in an Unknown Copy", () => {
  it("gives it a Platform and Format in place; the Game stays Owned with one Copy", async () => {
    const { game, copy } = await seeded();
    const ps5 = await platformId("PS5");

    const updated = await h.call(h.owner, "fillUnknownCopy", { gameId: game.id, copyId: copy.id, platformId: ps5, format: "Physical" });

    expect(updated.owned).toBe(true);
    expect(updated.copies).toEqual([expect.objectContaining({ id: copy.id, platformId: ps5, format: "Physical" })]);
    expect((await h.call(h.owner, "games"))[0]).toEqual(updated);
  });

  it("as Digital it needs an Account, and keeps the one it is given", async () => {
    const { game, copy } = await seeded();
    const pc = await platformId("PC");
    const fill = { gameId: game.id, copyId: copy.id, platformId: pc, format: "Digital" };

    await expect(h.call(h.owner, "fillUnknownCopy", fill)).rejects.toThrow(/ValidationError: A Digital Copy needs an Account/);

    const steam = await h.call(h.owner, "addAccount", { store: "Steam", nickname: "main" });
    const updated = await h.call(h.owner, "fillUnknownCopy", { ...fill, accountId: steam.id });
    expect(updated.copies[0]).toMatchObject({ id: copy.id, platformId: pc, format: "Digital", accountId: steam.id });
  });

  it("as Physical it refuses an Account", async () => {
    const { game, copy } = await seeded();
    const steam = await h.call(h.owner, "addAccount", { store: "Steam", nickname: "main" });

    await expect(
      h.call(h.owner, "fillUnknownCopy", { gameId: game.id, copyId: copy.id, platformId: await platformId("PS5"), format: "Physical", accountId: steam.id }),
    ).rejects.toThrow(/ValidationError: A Physical Copy can't have an Account/);
  });

  it("refuses a Platform or Account that doesn't exist", async () => {
    const { game, copy } = await seeded();
    const fill = { gameId: game.id, copyId: copy.id, format: "Digital" };

    await expect(h.call(h.owner, "fillUnknownCopy", { ...fill, platformId: "nope", accountId: "nope" })).rejects.toThrow(/NotFound: No such Platform/);
    await expect(h.call(h.owner, "fillUnknownCopy", { ...fill, platformId: await platformId("PC"), accountId: "nope" })).rejects.toThrow(
      /NotFound: No such Account/,
    );
  });

  it("only works on an Unknown Copy", async () => {
    const { game, copy } = await seeded();
    const ps5 = await platformId("PS5");
    const fill = { gameId: game.id, copyId: copy.id, platformId: ps5, format: "Physical" };
    await h.call(h.owner, "fillUnknownCopy", fill);

    await expect(h.call(h.owner, "fillUnknownCopy", fill)).rejects.toThrow(/ValidationError: That Copy's location is already known/);
    await expect(h.call(h.owner, "fillUnknownCopy", { ...fill, copyId: "nope" })).rejects.toThrow(/NotFound: No such Copy/);
  });

  it("another user can't fill in the owner's Copy", async () => {
    const { game, copy } = await seeded();

    await expect(
      h.call(h.stranger, "fillUnknownCopy", { gameId: game.id, copyId: copy.id, platformId: await platformId("PS5"), format: "Physical" }),
    ).rejects.toThrow(/NotFound: No such Game/);
  });

  it("an Unknown Copy can be removed like any other, leaving the Game not Owned", async () => {
    const { game, copy } = await seeded();

    expect(await h.call(h.owner, "removeCopy", { gameId: game.id, copyId: copy.id })).toMatchObject({ copies: [], owned: false });
  });
});
