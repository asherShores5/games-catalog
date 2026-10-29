import { describe, expect, it } from "vitest";
import { planMerge, type MergeSide } from "./merge";
import type { Copy } from "./types";

const side = (over: Partial<MergeSide> = {}): MergeSide => ({ copies: [], wishlist: false, playStatus: null, tags: [], ...over });
const pc = (id: string, createdAt = 1): Copy => ({ id, platformId: "pc", format: "Digital", accountId: "steam", createdAt });
const ps5 = (id: string, createdAt = 1): Copy => ({ id, platformId: "ps5", format: "Physical", createdAt });
const unknown = (id: string, createdAt = 1, edition?: string): Copy => ({ id, createdAt, edition });

describe("Merge Games: Play status, Owned, Wishlist", () => {
  it("keeps the more advanced Play status: Playing > Finished > Backlog > none", () => {
    const order = ["Playing", "Finished", "Backlog", null] as const;
    for (const [i, a] of order.entries()) {
      for (const b of order.slice(i)) {
        expect(planMerge(side({ playStatus: a }), side({ playStatus: b })).playStatus).toBe(a);
        expect(planMerge(side({ playStatus: b }), side({ playStatus: a })).playStatus).toBe(a);
      }
    }
  });

  it("uses the Play status I choose instead, including none", () => {
    expect(planMerge(side({ playStatus: "Playing" }), side(), { playStatus: "Backlog" }).playStatus).toBe("Backlog");
    expect(planMerge(side({ playStatus: "Playing" }), side({ playStatus: "Finished" }), { playStatus: null }).playStatus).toBe(null);
  });

  it("is Owned if either was, and then Wishlist clears", () => {
    const m = planMerge(side({ wishlist: true }), side({ copies: [ps5("b")] }));
    expect(m.owned).toBe(true);
    expect(m.wishlist).toBe(false);
  });

  it("stays on the Wishlist when neither is Owned and either was wished for", () => {
    expect(planMerge(side(), side({ wishlist: true }))).toMatchObject({ owned: false, wishlist: true });
    expect(planMerge(side(), side())).toMatchObject({ owned: false, wishlist: false });
  });
});

const ids = (cs: Copy[]) => cs.map((c) => c.id);

describe("Merge Games: Copies", () => {
  it("keeps every Copy of both Games, even two on the same Platform, Format and Account", () => {
    const m = planMerge(side({ copies: [pc("a1")] }), side({ copies: [pc("b1"), ps5("b2")] }));
    expect(ids(m.copies).sort()).toEqual(["a1", "b1", "b2"]);
    expect(m.droppedCopyIds).toEqual([]);
  });

  it("drops an Unknown Copy once the other Game says where it is (either direction)", () => {
    const seeded = side({ copies: [unknown("u")], playStatus: "Playing" });
    const imported = side({ copies: [pc("s")] });
    for (const [into, from] of [[seeded, imported], [imported, seeded]]) {
      const m = planMerge(into, from);
      expect(ids(m.copies)).toEqual(["s"]);
      expect(m.droppedCopyIds).toEqual(["u"]);
    }
  });

  it("two Unknown Copies become one: the surviving Game's", () => {
    const m = planMerge(side({ copies: [unknown("ua", 5)] }), side({ copies: [unknown("ub", 1)] }));
    expect(ids(m.copies)).toEqual(["ua"]);
    expect(m.droppedCopyIds).toEqual(["ub"]);
  });

  it("keeps an Unknown Copy that sat beside known Copies, or that notes an Edition", () => {
    const mixed = planMerge(side({ copies: [pc("s")] }), side({ copies: [ps5("p"), unknown("u")] }));
    expect(ids(mixed.copies).sort()).toEqual(["p", "s", "u"]);
    const goty = planMerge(side({ copies: [pc("s")] }), side({ copies: [unknown("u", 1, "GOTY")] }));
    expect(ids(goty.copies).sort()).toEqual(["s", "u"]);
    expect(goty.droppedCopyIds).toEqual([]);
  });
});

describe("Merge Games: Steam app IDs and Tags", () => {
  it("carries the Steam app ID over to a Game that had none", () => {
    expect(planMerge(side(), side({ steamAppId: 620 }))).toMatchObject({ steamAppId: 620, mergedSteamAppIds: [] });
  });

  it("with two different Steam app IDs, keeps the surviving Game's and remembers the other", () => {
    const m = planMerge(side({ steamAppId: 489830, mergedSteamAppIds: [1] }), side({ steamAppId: 72850, mergedSteamAppIds: [2, 1] }));
    expect(m.steamAppId).toBe(489830);
    expect([...m.mergedSteamAppIds].sort((a, b) => a - b)).toEqual([1, 2, 72850]);
  });

  it("the same Steam app ID on both is kept once", () => {
    expect(planMerge(side({ steamAppId: 620 }), side({ steamAppId: 620 }))).toMatchObject({ steamAppId: 620, mergedSteamAppIds: [] });
  });

  it("Tags combine: once each, Manual over Import, a link beats a removal, removals kept", () => {
    const m = planMerge(
      side({ tags: [{ tagId: "coop", source: "Import" }], removedTagIds: ["versus"] }),
      side({ tags: [{ tagId: "coop", source: "Manual" }, { tagId: "narrative", source: "Import" }], removedTagIds: ["platformer", "coop"] }),
    );
    expect(m.tags).toEqual({
      tags: [{ tagId: "coop", source: "Manual" }, { tagId: "narrative", source: "Import" }],
      removedTagIds: ["versus", "platformer"],
    });
  });
});
