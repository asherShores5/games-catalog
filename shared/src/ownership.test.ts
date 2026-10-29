import { describe, expect, it } from "vitest";
import { afterCopyAdded, canWishlist, isOwned } from "./ownership";

describe("Owned", () => {
  it("is false with no Copies and true with one or more", () => {
    expect(isOwned([])).toBe(false);
    expect(isOwned([{}])).toBe(true);
    expect(isOwned([{}, {}])).toBe(true);
  });
});

describe("adding a Copy", () => {
  it("to a Wishlist Game clears Wishlist and sets Play status to Backlog", () => {
    expect(afterCopyAdded({ wishlist: true, playStatus: null })).toEqual({ wishlist: false, playStatus: "Backlog" });
  });

  it("to a Wishlist Game overrides a Play status set while wishlisted", () => {
    expect(afterCopyAdded({ wishlist: true, playStatus: "Finished" })).toEqual({ wishlist: false, playStatus: "Backlog" });
  });

  it("to a Game that isn't on the Wishlist leaves its Play status alone", () => {
    expect(afterCopyAdded({ wishlist: false, playStatus: null })).toEqual({ wishlist: false, playStatus: null });
    expect(afterCopyAdded({ wishlist: false, playStatus: "Playing" })).toEqual({ wishlist: false, playStatus: "Playing" });
  });
});

describe("Wishlist", () => {
  it("can be set only on a Game with no Copies", () => {
    expect(canWishlist([])).toBe(true);
    expect(canWishlist([{}])).toBe(false);
  });
});
