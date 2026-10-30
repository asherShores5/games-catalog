import { describe, expect, it } from "vitest";
import { STEAM_TAGS, storeTagNames } from "./steamTags";
import { SIMPLE_TAGS } from "./tag";

describe("Steam store Categories and Genres as Tag names", () => {
  it("keeps only the simple Tags that help pick what to play, in Tag-list order", () => {
    expect(storeTagNames(["Single-player", "Steam Achievements", "DualShock Controller Support"], ["Indie", "Action"]))
      .toEqual(["Single-player", "Offline", "Action"]);
  });

  it("splits Steam's multiplayer flavours into Multiplayer, Co-op, Couch co-op, Online and Versus", () => {
    expect(storeTagNames(["Online Co-op"], [])).toEqual(["Multiplayer", "Co-op", "Online"]);
    expect(storeTagNames(["Shared/Split Screen Co-op"], [])).toEqual(["Multiplayer", "Co-op", "Couch co-op", "Offline"]);
    expect(storeTagNames(["Shared/Split Screen PvP"], [])).toEqual(["Multiplayer", "Offline", "Versus"]);
    expect(storeTagNames(["Online PvP", "Cross-Platform Multiplayer"], [])).toEqual(["Multiplayer", "Online", "Versus"]);
    expect(storeTagNames([], ["Massively Multiplayer"])).toEqual(["Multiplayer", "Online"]);
  });

  it("a whole co-op game: each Tag once", () => {
    const stardew = ["Single-player", "Multi-player", "Co-op", "Online Co-op", "LAN Co-op", "Shared/Split Screen Co-op",
      "Shared/Split Screen", "Steam Achievements", "Full controller support", "Steam Trading Cards", "Steam Cloud", "Remote Play Together"];
    expect(storeTagNames(stardew, ["Indie", "RPG", "Simulation"]))
      .toEqual(["Single-player", "Multiplayer", "Co-op", "Couch co-op", "Online", "Offline", "Controller", "RPG", "Simulation"]);
  });

  it("matches Steam's names ignoring case, spacing and accents", () => {
    expect(storeTagNames(["  single-PLAYER ", "full Controller Support"], ["rpg"])).toEqual(["Single-player", "Offline", "Controller", "RPG"]);
  });

  it("drops everything not on the list: store features, controller brands, Indie, software", () => {
    expect(storeTagNames(["Remote Play Together", "Steam Input API Support", "VR Support", "Includes level editor"],
      ["Indie", "Free To Play", "Early Access", "Utilities", "Photo Editing"])).toEqual([]);
  });

  it("every Tag it can produce is in SIMPLE_TAGS", () => {
    const all = storeTagNames(Object.keys(STEAM_TAGS), []);
    expect(all.every((n) => SIMPLE_TAGS.includes(n))).toBe(true);
  });
});
