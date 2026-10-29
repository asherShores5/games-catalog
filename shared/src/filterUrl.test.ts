import { describe, expect, it } from "vitest";
import { filterFromUrl, filterToUrl } from "./filterUrl";

describe("filter in the URL", () => {
  it("round-trips every field, search text included", () => {
    const filter = { query: "Marvel's Spider-Man & co #2 é?", platformId: "pc-123", ownership: "owned" as const, playStatus: "Backlog" as const };
    expect(filterFromUrl(filterToUrl(filter))).toEqual(filter);
    expect(filterFromUrl("?" + filterToUrl(filter))).toEqual(filter);
  });

  it("writes readable, stable params and nothing for unset fields", () => {
    expect(filterToUrl({ query: "half life", ownership: "wishlist" })).toBe("q=half+life&show=wishlist");
    expect(filterToUrl({ playStatus: "Playing", platformId: "ps5", query: "x" })).toBe("q=x&platform=ps5&status=Playing");
    expect(filterToUrl({})).toBe("");
    expect(filterToUrl({ query: "" })).toBe("");
  });

  it("reads an empty URL as the full list", () => {
    expect(filterFromUrl("")).toEqual({});
    expect(filterFromUrl("?")).toEqual({});
  });

  it("ignores values it doesn't know and unrelated params", () => {
    expect(filterFromUrl("?show=sold&status=Abandoned&q=&platform=&utm=x")).toEqual({});
    expect(filterFromUrl("?status=playing")).toEqual({});
  });
});
