import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(() => h.reset());

const labels = (as: { store: string; nickname: string }[]) => as.map((a) => `${a.store}: ${a.nickname}`);

describe("Accounts", () => {
  it("starts empty", async () => {
    expect(await h.call(h.owner, "accounts")).toEqual([]);
  });

  it("I can add an Account (Store + nickname) and it shows in the list", async () => {
    const added = await h.call(h.owner, "addAccount", { store: "Steam", nickname: "  main " });
    expect(added).toMatchObject({ store: "Steam", nickname: "main" });
    expect(await h.call(h.owner, "accounts")).toEqual([added]);
  });

  it("rejects an unknown Store or a blank nickname", async () => {
    await expect(h.call(h.owner, "addAccount", { store: "Itch", nickname: "main" })).rejects.toThrow("ValidationError");
    await expect(h.call(h.owner, "addAccount", { store: "Steam", nickname: "  " })).rejects.toThrow("ValidationError");
  });

  it("nicknames are unique per Store, ignoring case, but may repeat across Stores", async () => {
    await h.call(h.owner, "addAccount", { store: "Steam", nickname: "main" });
    await expect(h.call(h.owner, "addAccount", { store: "Steam", nickname: "MAIN" })).rejects.toThrow(/ValidationError: .*Steam: main/);
    await h.call(h.owner, "addAccount", { store: "PSN", nickname: "main" });
    expect(labels(await h.call(h.owner, "accounts"))).toEqual(["PSN: main", "Steam: main"]);
  });

  it("I can rename an Account; its Store stays", async () => {
    const a = await h.call(h.owner, "addAccount", { store: "Steam", nickname: "mian" });
    expect(await h.call(h.owner, "renameAccount", { id: a.id, nickname: "main" })).toEqual({ id: a.id, store: "Steam", nickname: "main" });
    expect(labels(await h.call(h.owner, "accounts"))).toEqual(["Steam: main"]);
  });

  it("can't rename an Account onto another on the same Store", async () => {
    await h.call(h.owner, "addAccount", { store: "Steam", nickname: "main" });
    const alt = await h.call(h.owner, "addAccount", { store: "Steam", nickname: "alt" });
    await expect(h.call(h.owner, "renameAccount", { id: alt.id, nickname: "Main" })).rejects.toThrow("ValidationError");
    expect((await h.call(h.owner, "renameAccount", { id: alt.id, nickname: "ALT" })).nickname).toBe("ALT");
  });

  it("I can delete an unused Account", async () => {
    const a = await h.call(h.owner, "addAccount", { store: "GOG", nickname: "main" });
    expect(await h.call(h.owner, "deleteAccount", { id: a.id })).toBe(a.id);
    expect(await h.call(h.owner, "accounts")).toEqual([]);
  });

  it("renaming or deleting an Account that doesn't exist, or is another user's, is NotFound", async () => {
    await expect(h.call(h.owner, "renameAccount", { id: "nope", nickname: "x" })).rejects.toThrow("NotFound");
    await expect(h.call(h.owner, "deleteAccount", { id: "nope" })).rejects.toThrow("NotFound");
    const theirs = await h.call(h.stranger, "addAccount", { store: "Steam", nickname: "main" });
    await expect(h.call(h.owner, "renameAccount", { id: theirs.id, nickname: "mine" })).rejects.toThrow("NotFound");
    await expect(h.call(h.owner, "deleteAccount", { id: theirs.id })).rejects.toThrow("NotFound");
    expect(await h.call(h.owner, "accounts")).toEqual([]);
  });
});

async function platformId(name: string, caller = h.owner): Promise<string> {
  return (await h.call(caller, "platforms")).find((p: { name: string }) => p.name === name).id;
}

const onlyGame = async () => (await h.call(h.owner, "games"))[0];

describe("Copies and Accounts", () => {
  it("a Digital Copy picks an Account and shows it", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Hades" });
    const steam = await h.call(h.owner, "addAccount", { store: "Steam", nickname: "main" });
    const updated = await h.call(h.owner, "addCopy", { gameId: game.id, platformId: await platformId("PC"), format: "Digital", accountId: steam.id });
    expect(updated.copies).toEqual([expect.objectContaining({ format: "Digital", accountId: steam.id })]);
    expect(await onlyGame()).toEqual(updated);
  });

  it("rejects a Digital Copy without an Account, and nothing is added", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Hades" });
    await expect(h.call(h.owner, "addCopy", { gameId: game.id, platformId: await platformId("PC"), format: "Digital" })).rejects.toThrow(
      /ValidationError: .*Account/,
    );
    expect(await onlyGame()).toMatchObject({ copies: [], owned: false });
  });

  it("rejects a Physical Copy with an Account; without one it has none", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Elden Ring" });
    const psn = await h.call(h.owner, "addAccount", { store: "PSN", nickname: "main" });
    const ps5 = await platformId("PS5");
    await expect(h.call(h.owner, "addCopy", { gameId: game.id, platformId: ps5, format: "Physical", accountId: psn.id })).rejects.toThrow(
      /ValidationError: .*Physical/,
    );
    const updated = await h.call(h.owner, "addCopy", { gameId: game.id, platformId: ps5, format: "Physical", accountId: null });
    expect(updated.copies).toHaveLength(1);
    expect(updated.copies[0].accountId).toBeUndefined();
  });

  it("rejects an Account that doesn't exist or is another user's", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Hades" });
    const pc = await platformId("PC");
    await expect(h.call(h.owner, "addCopy", { gameId: game.id, platformId: pc, format: "Digital", accountId: "nope" })).rejects.toThrow(
      "NotFound: No such Account",
    );
    const theirs = await h.call(h.stranger, "addAccount", { store: "Steam", nickname: "main" });
    await expect(h.call(h.owner, "addCopy", { gameId: game.id, platformId: pc, format: "Digital", accountId: theirs.id })).rejects.toThrow(
      "NotFound: No such Account",
    );
    expect((await onlyGame()).copies).toEqual([]);
  });

  it("an Account with Copies can't be deleted, with a clear error; it can once they're gone", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Hades" });
    const steam = await h.call(h.owner, "addAccount", { store: "Steam", nickname: "main" });
    const added = await h.call(h.owner, "addCopy", { gameId: game.id, platformId: await platformId("PC"), format: "Digital", accountId: steam.id });

    await expect(h.call(h.owner, "deleteAccount", { id: steam.id })).rejects.toThrow(/Conflict: .*Steam: main.* 1 Copy/);
    await h.call(h.owner, "removeCopy", { gameId: game.id, copyId: added.copies[0].id });
    expect(await h.call(h.owner, "deleteAccount", { id: steam.id })).toBe(steam.id);
  });

  it("renaming an Account shows the new name on its Copies, and the Copies are untouched", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Hades" });
    const steam = await h.call(h.owner, "addAccount", { store: "Steam", nickname: "main" });
    const before = await h.call(h.owner, "addCopy", { gameId: game.id, platformId: await platformId("PC"), format: "Digital", accountId: steam.id });
    await h.call(h.owner, "renameAccount", { id: steam.id, nickname: "family" });

    const after = await onlyGame();
    expect(after).toEqual(before);
    const accounts: { id: string; store: string; nickname: string }[] = await h.call(h.owner, "accounts");
    const account = accounts.find((a) => a.id === after.copies[0].accountId);
    expect(account && labels([account])).toEqual(["Steam: family"]);
  });

  it("Digital Copies saved before Accounts existed still load, with no Account", async () => {
    const game = await h.call(h.owner, "addGame", { name: "Hades" });
    const pc = await platformId("PC");
    h.db.seed({
      PK: "OWNER#" + h.owner.userId, SK: "GAME#" + game.id + "#COPY#legacy", gameId: game.id,
      id: "legacy", platformId: pc, format: "Digital", createdAt: 1,
    });
    const listed = await onlyGame();
    expect(listed).toMatchObject({ owned: true, copies: [expect.objectContaining({ id: "legacy", format: "Digital" })] });
    expect(listed.copies[0].accountId).toBeUndefined();
    // It doesn't block deleting an Account, and can still be removed.
    const steam = await h.call(h.owner, "addAccount", { store: "Steam", nickname: "main" });
    expect(await h.call(h.owner, "deleteAccount", { id: steam.id })).toBe(steam.id);
    expect(await h.call(h.owner, "removeCopy", { gameId: game.id, copyId: "legacy" })).toMatchObject({ owned: false });
  });
});
