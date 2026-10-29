import { describe, expect, it } from "vitest";
import { gameMatches, matchesName } from "./search";

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
  const game = (name: string) => ({ name });

  it("keeps every Game when nothing is set", () => {
    expect(gameMatches(game("Celeste"), {})).toBe(true);
    expect(gameMatches(game("Celeste"), { query: "" })).toBe(true);
  });

  it("keeps only Games whose name matches the search", () => {
    expect(gameMatches(game("The Witcher 3"), { query: "witcher" })).toBe(true);
    expect(gameMatches(game("Celeste"), { query: "witcher" })).toBe(false);
  });
});
