import { describe, expect, it } from "vitest";
import { gameMatches, matchesName, withoutUnknownTags } from "./search";

describe("name search", () => {
  it("matches anywhere in the name, ignoring case", () => {
    expect(matchesName("The Witcher 3", "witcher")).toBe(true);
    expect(matchesName("The Witcher 3", "WITCHER 3")).toBe(true);
    expect(matchesName("The Witcher 3", "zelda")).toBe(false);
  });

  it("ignores accents in the name and the query", () => {
    expect(matchesName("Pokémon Scarlet", "pokemon")).toBe(true);
    expect(matchesName("Pokemon Scarlet", "pokémon")).toBe(true);
    expect(matchesName("Ōkami HD", "okami")).toBe(true);
  });

  it("ignores punctuation and spacing", () => {
    expect(matchesName("Marvel's Spider-Man 2", "marvels spiderman")).toBe(true);
    expect(matchesName("Baldur's Gate 3", "baldurs")).toBe(true);
    expect(matchesName("Half-Life: Alyx", "half life alyx")).toBe(true);
    expect(matchesName("Tom Clancy's The Division", "  division ")).toBe(true);
    expect(matchesName("Ratchet & Clank", "ratchet clank")).toBe(true);
  });

  it("matches every name when the query is empty or only punctuation", () => {
    expect(matchesName("Celeste", "")).toBe(true);
    expect(matchesName("Celeste", "  ")).toBe(true);
    expect(matchesName("Celeste", "-")).toBe(true);
  });

  it("does not match across a gap the query doesn't have", () => {
    expect(matchesName("Hades II", "hades 2")).toBe(false);
  });
});

describe("Game list filter", () => {
  const game = (name: string) => ({ name, copies: [], wishlist: false, playStatus: null });

  it("keeps every Game when nothing is set", () => {
    expect(gameMatches(game("Celeste"), {})).toBe(true);
    expect(gameMatches(game("Celeste"), { query: "" })).toBe(true);
  });

  it("keeps only Games whose name matches the search", () => {
    expect(gameMatches(game("The Witcher 3"), { query: "witcher" })).toBe(true);
    expect(gameMatches(game("Celeste"), { query: "witcher" })).toBe(false);
  });
});

describe("Platform filter", () => {
  const copy = (platformId: string) => ({ id: platformId + "-copy", platformId, format: "Digital" as const, createdAt: 1 });
  const game = (copies: ReturnType<typeof copy>[]) => ({ name: "Hades", copies, wishlist: false, playStatus: null });

  it("keeps a Game with any Copy on that Platform", () => {
    expect(gameMatches(game([copy("ps5"), copy("pc")]), { platformId: "pc" })).toBe(true);
    expect(gameMatches(game([copy("pc")]), { platformId: "pc" })).toBe(true);
  });

  it("drops a Game with no Copy on that Platform, including Games with no Copies", () => {
    expect(gameMatches(game([copy("ps5")]), { platformId: "pc" })).toBe(false);
    expect(gameMatches(game([]), { platformId: "pc" })).toBe(false);
  });
});

describe("Wishlist / Owned filter", () => {
  const pc = { id: "c1", platformId: "pc", format: "Physical" as const, createdAt: 1 };
  const owned = { name: "Celeste", copies: [pc], wishlist: false, playStatus: null };
  const wished = { name: "Hades II", copies: [], wishlist: true, playStatus: null };
  const neither = { name: "Tetris", copies: [], wishlist: false, playStatus: null };

  it("with no choice, Wishlist Games are left out", () => {
    expect(gameMatches(owned, {})).toBe(true);
    expect(gameMatches(neither, {})).toBe(true);
    expect(gameMatches(wished, {})).toBe(false);
  });

  it("All brings the Wishlist back in", () => {
    for (const g of [owned, wished, neither]) expect(gameMatches(g, { ownership: "all" })).toBe(true);
  });

  it("Owned keeps only Games with a Copy", () => {
    expect(gameMatches(owned, { ownership: "owned" })).toBe(true);
    expect(gameMatches(wished, { ownership: "owned" })).toBe(false);
    expect(gameMatches(neither, { ownership: "owned" })).toBe(false);
  });

  it("Wishlist keeps only Wishlist Games", () => {
    expect(gameMatches(wished, { ownership: "wishlist" })).toBe(true);
    expect(gameMatches(owned, { ownership: "wishlist" })).toBe(false);
    expect(gameMatches(neither, { ownership: "wishlist" })).toBe(false);
  });

  it("a stale Wishlist flag on an owned Game doesn't put it on the Wishlist", () => {
    expect(gameMatches({ ...owned, wishlist: true }, { ownership: "wishlist" })).toBe(false);
    expect(gameMatches({ ...owned, wishlist: true }, { ownership: "owned" })).toBe(true);
    expect(gameMatches({ ...owned, wishlist: true }, {})).toBe(true);
  });
});

describe("Play status filter", () => {
  const game = (playStatus: "Playing" | "Backlog" | "Finished" | null) => ({ name: "Celeste", copies: [], wishlist: false, playStatus });

  it("keeps only Games with that Play status", () => {
    expect(gameMatches(game("Playing"), { playStatus: "Playing" })).toBe(true);
    expect(gameMatches(game("Backlog"), { playStatus: "Playing" })).toBe(false);
    expect(gameMatches(game(null), { playStatus: "Finished" })).toBe(false);
  });
});

describe("combined filters", () => {
  const pc = { id: "c1", platformId: "pc", format: "Digital" as const, createdAt: 1 };
  const ps5 = { id: "c2", platformId: "ps5", format: "Physical" as const, createdAt: 1 };
  const games = [
    { name: "Hades", copies: [pc], wishlist: false, playStatus: "Playing" as const },
    { name: "Hades II", copies: [], wishlist: true, playStatus: null },
    { name: "Hollow Knight", copies: [ps5], wishlist: false, playStatus: "Playing" as const },
    { name: "Celeste", copies: [pc], wishlist: false, playStatus: "Finished" as const },
  ];
  const names = (filter: Parameters<typeof gameMatches>[1]) => games.filter((g) => gameMatches(g, filter)).map((g) => g.name);

  it("needs every set filter to match, search included", () => {
    expect(names({ query: "hades", ownership: "owned" })).toEqual(["Hades"]);
    expect(names({ platformId: "pc", playStatus: "Playing" })).toEqual(["Hades"]);
    expect(names({ query: "h", playStatus: "Playing" })).toEqual(["Hades", "Hollow Knight"]);
    expect(names({ platformId: "pc", ownership: "wishlist" })).toEqual([]);
  });

  it("an empty filter keeps everything but the Wishlist; All keeps the full list", () => {
    expect(names({})).toEqual(["Hades", "Hollow Knight", "Celeste"]);
    expect(names({ ownership: "all" })).toEqual(["Hades", "Hades II", "Hollow Knight", "Celeste"]);
  });
});

describe("Tag filter", () => {
  const pc = { id: "c1", platformId: "pc", format: "Physical" as const, createdAt: 1 };
  const tagged = (name: string, tagIds: string[], copies = [pc]) => ({
    name, copies, wishlist: false, playStatus: null,
    tags: tagIds.map((tagId) => ({ tagId, source: tagId === "versus" ? ("Import" as const) : ("Manual" as const) })),
  });
  const games = [
    tagged("It Takes Two", ["coop", "narrative"]),
    tagged("Valheim", ["coop", "open-world"]),
    tagged("Elden Ring", ["open-world", "versus"]),
    tagged("Grounded", ["coop", "open-world"], []),
    { name: "Celeste", copies: [pc], wishlist: false, playStatus: null },
  ];
  const names = (filter: Parameters<typeof gameMatches>[1]) => games.filter((g) => gameMatches(g, filter)).map((g) => g.name);

  it("keeps Games with every selected Tag (AND), whatever the Tag source", () => {
    expect(names({ tagIds: ["coop"] })).toEqual(["It Takes Two", "Valheim", "Grounded"]);
    expect(names({ tagIds: ["coop", "open-world"] })).toEqual(["Valheim", "Grounded"]);
    expect(names({ tagIds: ["versus"] })).toEqual(["Elden Ring"]);
    expect(names({ tagIds: ["coop", "versus"] })).toEqual([]);
  });

  it("no selected Tags keeps every Game, including Games with no Tags", () => {
    expect(names({ tagIds: [] })).toHaveLength(5);
  });

  it("combines with search and the other filters", () => {
    expect(names({ tagIds: ["coop", "open-world"], platformId: "pc" })).toEqual(["Valheim"]);
    expect(names({ tagIds: ["open-world"], query: "ring" })).toEqual(["Elden Ring"]);
    expect(names({ tagIds: ["coop"], ownership: "owned" })).toEqual(["It Takes Two", "Valheim"]);
  });
});

describe("pruning Tags that no longer exist from the filter", () => {
  const tags = [{ id: "coop", name: "co-op" }, { id: "rpg", name: "RPG" }];

  it("drops Tag ids I've since deleted or merged away, keeping the rest", () => {
    expect(withoutUnknownTags({ query: "ring", tagIds: ["coop", "gone"] }, tags)).toEqual({ query: "ring", tagIds: ["coop"] });
  });

  it("drops tagIds entirely when none are left", () => {
    expect(withoutUnknownTags({ platformId: "pc", tagIds: ["gone"] }, tags)).toEqual({ platformId: "pc" });
  });

  it("returns the same filter when every Tag still exists, so callers can skip an update", () => {
    const filter = { tagIds: ["coop", "rpg"] };
    expect(withoutUnknownTags(filter, tags)).toBe(filter);
    const none = { query: "x" };
    expect(withoutUnknownTags(none, tags)).toBe(none);
  });
});

describe("Missing info filter", () => {
  const known = { id: "c1", platformId: "pc", format: "Digital" as const, createdAt: 1 };
  const unknown = { id: "c2", createdAt: 1 };
  const g = (name: string, copies: object[], tagIds: string[] = [], wishlist = false) =>
    ({ name, copies, wishlist, playStatus: null, tags: tagIds.map((tagId) => ({ tagId, source: "Manual" as const })) }) as never;
  const games = [
    g("Complete", [known], ["coop"]),
    g("Nowhere", [unknown], ["coop"]),
    g("Untagged", [known]),
    g("Both", [unknown]),
    g("Wished", [], [], true),
  ];
  const names = (filter: Parameters<typeof gameMatches>[1]) => games.filter((x) => gameMatches(x, filter)).map((x: { name: string }) => x.name);

  it("No location keeps Games with an Unknown Copy", () => {
    expect(names({ missing: "location" })).toEqual(["Nowhere", "Both"]);
  });

  it("No Tags keeps Games without a Tag", () => {
    expect(names({ missing: "tags" })).toEqual(["Untagged", "Both"]);
    expect(names({ missing: "tags", ownership: "all" })).toEqual(["Untagged", "Both", "Wished"]);
  });

  it("Either keeps Games missing one or the other", () => {
    expect(names({ missing: "any" })).toEqual(["Nowhere", "Untagged", "Both"]);
  });
});
