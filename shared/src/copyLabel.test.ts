import { describe, expect, it } from "vitest";
import { copyParts } from "./copyLabel";

const names = {
  platformName: (id: string) => ({ p1: "PC", p2: "PS5" })[id] ?? "Unknown Platform",
  accountName: (id: string) => ({ a1: "Steam: main" })[id] ?? "Unknown Account",
};

describe("a Copy in the Game list", () => {
  it("shows Platform and Format", () => {
    expect(copyParts({ platformId: "p2", format: "Physical" }, names)).toEqual(["PS5", "Physical"]);
  });

  it("shows its Account and Edition when it has them", () => {
    expect(copyParts({ platformId: "p1", format: "Digital", accountId: "a1", edition: "GOTY" }, names)).toEqual([
      "PC",
      "Digital",
      "Steam: main",
      "GOTY",
    ]);
  });

  it("shows an Edition without an Account", () => {
    expect(copyParts({ platformId: "p2", format: "Physical", edition: "Deluxe" }, names)).toEqual(["PS5", "Physical", "Deluxe"]);
  });

  it("leaves the Account out when no Account names are available", () => {
    expect(copyParts({ platformId: "p1", format: "Digital", accountId: "a1" }, { platformName: names.platformName })).toEqual([
      "PC",
      "Digital",
    ]);
  });
});
