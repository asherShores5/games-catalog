import { describe, expect, it } from "vitest";
import { storeTagNames } from "./steamTags";

describe("Steam store Categories and Genres as Tag names", () => {
  it("maps onto my common Tags", () => {
    expect(storeTagNames(["Single-player", "Online Co-op", "Online PvP"], [])).toEqual(["single-player", "co-op", "versus"]);
    expect(storeTagNames(["Co-op", "LAN Co-op", "Shared/Split Screen Co-op"], [])).toEqual(["co-op"]);
    expect(storeTagNames(["PvP", "LAN PvP", "Shared/Split Screen PvP"], [])).toEqual(["versus"]);
  });

  it("keeps unmapped Categories and Genres as they are, Genres after Categories, each once", () => {
    expect(storeTagNames(["Single-player", "Multi-player"], ["Action", "Indie", "action"])).toEqual([
      "single-player", "Multi-player", "Action", "Indie",
    ]);
  });

  it("matches Steam's names ignoring case, spacing and accents", () => {
    expect(storeTagNames([" single-PLAYER ", "online co-op"], [])).toEqual(["single-player", "co-op"]);
  });

  it("drops store features that don't describe the game (achievements, cloud saves, partial controller support…)", () => {
    expect(
      storeTagNames(
        ["Steam Achievements", "Steam Trading Cards", "Steam Cloud", "Partial Controller Support", "Family Sharing",
          "In-App Purchases", "Remote Play on TV", "Captions available", "Single-player"],
        ["Adventure"],
      ),
    ).toEqual(["single-player", "Adventure"]);
  });

  it("keeps Full controller support and Remote Play Together: they help me pick what to play", () => {
    expect(storeTagNames(["Full controller support", "Remote Play Together", "Steam Cloud"], [])).toEqual([
      "Full controller support",
      "Remote Play Together",
    ]);
  });

  it("skips blank names and trims overlong ones away (a Tag name is at most 50 characters)", () => {
    expect(storeTagNames(["", "   ", "x".repeat(51)], ["RPG"])).toEqual(["RPG"]);
  });
});
