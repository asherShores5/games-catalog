import { beforeEach, describe, expect, it, vi } from "vitest";

// Guest demo: a visitor can browse a sample library without an account. Demo mode lives in
// sessionStorage (one tab), is entered from the Login page or a ?demo link, and never reaches
// the real API.

let session: Map<string, string>;

async function launch(search = "") {
  vi.resetModules();
  vi.stubGlobal("location", { search });
  return import("./demo");
}

beforeEach(() => {
  session = new Map();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => session.get(k) ?? null,
    setItem: (k: string, v: string) => void session.set(k, v),
    removeItem: (k: string) => void session.delete(k),
  });
});

describe("demo mode", () => {
  it("is off by default", async () => {
    const demo = await launch();
    expect(demo.isDemo()).toBe(false);
  });

  it("turns on from a ?demo link and survives a reload in the same tab", async () => {
    expect((await launch("?demo")).isDemo()).toBe(true);
    expect((await launch("")).isDemo()).toBe(true);
  });

  it("turns on and off by hand, telling listeners", async () => {
    const demo = await launch();
    const seen: boolean[] = [];
    demo.onDemoChange(() => seen.push(demo.isDemo()));
    demo.enterDemo();
    demo.exitDemo();
    expect(seen).toEqual([true, false]);
    expect((await launch()).isDemo()).toBe(false);
  });
});
