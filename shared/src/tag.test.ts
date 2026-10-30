import { describe, expect, it } from "vitest";
import { addManualTag, combineGameTags, dropTag, importTags, moveTag, removeGameTag, type GameTags } from "./tag";

const none: GameTags = { tags: [], removedTagIds: [] };

describe("Game–Tag links", () => {
  it("a Tag I add by hand is Manual, once", () => {
    const once = addManualTag(none, "coop");
    expect(once).toEqual({ tags: [{ tagId: "coop", source: "Manual" }], removedTagIds: [] });
    expect(addManualTag(once, "coop")).toEqual(once);
  });

  it("adding by hand a Tag an Import brought makes it Manual", () => {
    const imported = importTags(none, ["coop"]);
    expect(imported.tags).toEqual([{ tagId: "coop", source: "Import" }]);
    expect(addManualTag(imported, "coop").tags).toEqual([{ tagId: "coop", source: "Manual" }]);
  });

  it("removing a Tag is remembered, and a later Import doesn't bring it back", () => {
    const removed = removeGameTag(importTags(none, ["coop", "versus"]), "versus");
    expect(removed).toEqual({ tags: [{ tagId: "coop", source: "Import" }], removedTagIds: ["versus"] });
    expect(importTags(removed, ["coop", "versus", "narrative"])).toEqual({
      tags: [{ tagId: "coop", source: "Import" }, { tagId: "narrative", source: "Import" }],
      removedTagIds: ["versus"],
    });
  });

  it("an Import never downgrades a Manual Tag", () => {
    const manual = addManualTag(none, "coop");
    expect(importTags(manual, ["coop"])).toEqual(manual);
  });

  it("adding a removed Tag back by hand forgets the removal", () => {
    expect(addManualTag(removeGameTag(addManualTag(none, "coop"), "coop"), "coop")).toEqual(addManualTag(none, "coop"));
  });

  it("combining two Games' Tags keeps every Tag once, Manual winning over Import", () => {
    const a: GameTags = { tags: [{ tagId: "coop", source: "Import" }, { tagId: "rpg", source: "Manual" }], removedTagIds: ["versus"] };
    const b: GameTags = { tags: [{ tagId: "coop", source: "Manual" }, { tagId: "narrative", source: "Import" }], removedTagIds: [] };
    expect(combineGameTags(a, b)).toEqual({
      tags: [{ tagId: "coop", source: "Manual" }, { tagId: "rpg", source: "Manual" }, { tagId: "narrative", source: "Import" }],
      removedTagIds: ["versus"],
    });
  });

  it("a removal on one Game doesn't hide a Tag the other Game still has", () => {
    const a: GameTags = { tags: [], removedTagIds: ["coop"] };
    const b: GameTags = { tags: [{ tagId: "coop", source: "Import" }], removedTagIds: [] };
    expect(combineGameTags(a, b)).toEqual({ tags: [{ tagId: "coop", source: "Import" }], removedTagIds: [] });
  });

  it("moving a merged Tag onto another dedupes the link and keeps Manual", () => {
    const g: GameTags = { tags: [{ tagId: "coop2", source: "Manual" }, { tagId: "coop", source: "Import" }], removedTagIds: [] };
    expect(moveTag(g, "coop2", "coop")).toEqual({ tags: [{ tagId: "coop", source: "Manual" }], removedTagIds: [] });
    expect(moveTag({ tags: [], removedTagIds: ["coop2"] }, "coop2", "coop")).toEqual({ tags: [], removedTagIds: ["coop"] });
  });

  it("dropping a deleted Tag removes its link and its removal record", () => {
    const g: GameTags = { tags: [{ tagId: "coop", source: "Manual" }, { tagId: "rpg", source: "Import" }], removedTagIds: ["coop", "versus"] };
    expect(dropTag(g, "coop")).toEqual({ tags: [{ tagId: "rpg", source: "Import" }], removedTagIds: ["versus"] });
  });
});
