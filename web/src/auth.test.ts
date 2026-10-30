import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// auth.ts against a fake Cognito JSON API: the sign-in survives an app relaunch (fresh module,
// same localStorage), expired tokens refresh with rotation, and only a rejected refresh token signs out.

const CONFIG = { region: "us-west-1", userPoolId: "us-west-1_TEST", clientId: "client-1", graphqlUrl: "https://api.example/graphql" };

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

type Reply = { status: number; body: unknown } | "network-error";
let storage: MemoryStorage;
let cognito: Record<string, Reply[]>;
let calls: { target: string; body: any }[];

const ok = (AuthenticationResult: object) => ({ status: 200, body: { AuthenticationResult } });
const tokens = (n: number, refresh?: string) => ({ IdToken: `id-${n}`, AccessToken: `access-${n}`, ExpiresIn: 3600, ...(refresh ? { RefreshToken: refresh } : {}) });

async function launch() {
  vi.resetModules();
  const config = await import("./config");
  await config.loadConfig();
  return import("./auth");
}

beforeEach(() => {
  storage = new MemoryStorage();
  cognito = {};
  calls = [];
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url === "/config.json") return new Response(JSON.stringify(CONFIG));
    const target = String((init?.headers as Record<string, string>)["X-Amz-Target"]).split(".")[1];
    calls.push({ target, body: JSON.parse(String(init?.body)) });
    const reply = cognito[target]?.shift();
    if (!reply) throw new Error(`unexpected Cognito call ${target}`);
    if (reply === "network-error") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function signedIn() {
  cognito.InitiateAuth = [ok(tokens(1, "refresh-1"))];
  const auth = await launch();
  await auth.signInWithPassword("Asher", "a-long-password-here");
  return auth;
}

describe("staying signed in", () => {
  it("a relaunched app is still signed in, with no Cognito call", async () => {
    await signedIn();
    const relaunched = await launch();
    expect(relaunched.isSignedIn()).toBe(true);
    expect((await relaunched.freshTokens()).idToken).toBe("id-1");
    expect(calls.map((c) => c.target)).toEqual(["InitiateAuth"]);
  });

  it("expired tokens refresh with the stored refresh token and keep the rotated one", async () => {
    await signedIn();
    vi.useFakeTimers({ now: Date.now() + 2 * 3600_000, toFake: ["Date"] });
    cognito.GetTokensFromRefreshToken = [ok(tokens(2, "refresh-2")), ok(tokens(3, "refresh-3"))];

    const auth = await launch();
    expect((await auth.freshTokens()).idToken).toBe("id-2");
    expect(calls.at(-1)).toEqual({ target: "GetTokensFromRefreshToken", body: { ClientId: "client-1", RefreshToken: "refresh-1" } });

    // the next refresh (after another relaunch) uses the rotated token
    vi.setSystemTime(Date.now() + 2 * 3600_000);
    expect((await (await launch()).freshTokens()).idToken).toBe("id-3");
    expect(calls.at(-1)?.body.RefreshToken).toBe("refresh-2");
  });

  it("a network failure during refresh keeps the session", async () => {
    await signedIn();
    vi.useFakeTimers({ now: Date.now() + 2 * 3600_000, toFake: ["Date"] });
    cognito.GetTokensFromRefreshToken = ["network-error"];
    const auth = await launch();
    await expect(auth.freshTokens()).rejects.toThrow();
    expect(auth.isSignedIn()).toBe(true);
  });

  it("a server error during refresh keeps the session", async () => {
    await signedIn();
    vi.useFakeTimers({ now: Date.now() + 2 * 3600_000, toFake: ["Date"] });
    cognito.GetTokensFromRefreshToken = [{ status: 500, body: { __type: "InternalErrorException", message: "token service hiccup" } }];
    const auth = await launch();
    await expect(auth.freshTokens()).rejects.toThrow();
    expect(auth.isSignedIn()).toBe(true);
  });

  it("a rejected refresh token signs out", async () => {
    await signedIn();
    vi.useFakeTimers({ now: Date.now() + 2 * 3600_000, toFake: ["Date"] });
    cognito.GetTokensFromRefreshToken = [{ status: 400, body: { __type: "NotAuthorizedException", message: "Refresh Token has expired" } }];
    const auth = await launch();
    await expect(auth.freshTokens()).rejects.toThrow(/expired/);
    expect(auth.isSignedIn()).toBe(false);
    expect((await launch()).isSignedIn()).toBe(false);
  });
});
