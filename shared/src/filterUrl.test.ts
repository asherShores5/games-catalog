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
    expect(filterToUrl({ ownership: "all" })).toBe("show=all");
    expect(filterFromUrl("?show=all")).toEqual({ ownership: "all" });
    expect(filterToUrl({ playStatus: "Playing", platformId: "ps5", query: "x" })).toBe("q=x&platform=ps5&status=Playing");
    expect(filterToUrl({})).toBe("");
    expect(filterToUrl({ query: "" })).toBe("");
  });

  it("keeps selected Tags as repeated tag params, after the others", () => {
    const filter = { query: "x", playStatus: "Playing" as const, tagIds: ["co-op", "open,world"] };
    expect(filterToUrl(filter)).toBe("q=x&status=Playing&tag=co-op&tag=open%2Cworld");
    expect(filterFromUrl(filterToUrl(filter))).toEqual(filter);
    expect(filterToUrl({ tagIds: [] })).toBe("");
    expect(filterFromUrl("?tag=&tag=a&tag=a")).toEqual({ tagIds: ["a"] });
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
