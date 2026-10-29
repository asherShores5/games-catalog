// Cognito user-pool auth via the public JSON API (no SDK), as in Honey Do. Password sign-in only for
// now; the refresh token keeps the session for 30 days.
import { getConfig } from "./config";

interface Tokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  username: string;
}

const KEY = "games.tokens";
let tokens: Tokens | null = JSON.parse(localStorage.getItem(KEY) ?? "null");
const listeners = new Set<() => void>();

export function onAuthChange(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function save(t: Tokens | null) {
  tokens = t;
  if (t) localStorage.setItem(KEY, JSON.stringify(t));
  else localStorage.removeItem(KEY);
  listeners.forEach((fn) => fn());
}

export function isSignedIn() {
  return tokens !== null;
}

async function cognito<T = any>(target: string, body: object): Promise<T> {
  const { region } = getConfig();
  const r = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}` },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.message ?? json.__type ?? `Cognito ${target} failed`);
  return json as T;
}

function accept(result: any, username: string, refreshToken?: string) {
  const a = result.AuthenticationResult;
  if (!a) throw new Error(`Unexpected sign-in step: ${result.ChallengeName ?? "unknown"}`);
  save({
    idToken: a.IdToken,
    accessToken: a.AccessToken,
    refreshToken: a.RefreshToken ?? refreshToken,
    expiresAt: Date.now() + a.ExpiresIn * 1000,
    username,
  });
}

export async function signInWithPassword(username: string, password: string) {
  const { clientId } = getConfig();
  const u = username.trim().toLowerCase();
  let r = await cognito("InitiateAuth", {
    AuthFlow: "USER_AUTH",
    ClientId: clientId,
    AuthParameters: { USERNAME: u, PREFERRED_CHALLENGE: "PASSWORD", PASSWORD: password },
  });
  if (r.ChallengeName === "PASSWORD" || r.ChallengeName === "SELECT_CHALLENGE") {
    r = await cognito("RespondToAuthChallenge", {
      ClientId: clientId,
      ChallengeName: r.ChallengeName,
      Session: r.Session,
      ChallengeResponses: { USERNAME: u, PASSWORD: password, ...(r.ChallengeName === "SELECT_CHALLENGE" ? { ANSWER: "PASSWORD" } : {}) },
    });
  }
  accept(r, u);
}

let refreshing: Promise<Tokens> | null = null;

/** Valid tokens, refreshing if within 5 minutes of expiry. */
export async function freshTokens(): Promise<Tokens> {
  if (!tokens) throw new Error("signed out");
  if (tokens.expiresAt - Date.now() > 5 * 60_000) return tokens;
  refreshing ??= (async () => {
    const t = tokens!;
    try {
      const r = await cognito("InitiateAuth", {
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: getConfig().clientId,
        AuthParameters: { REFRESH_TOKEN: t.refreshToken },
      });
      accept(r, t.username, t.refreshToken);
      return tokens!;
    } catch (e) {
      // Only a rejected refresh token signs you out; network errors keep the session.
      if (navigator.onLine && /token|auth/i.test(String((e as Error).message))) save(null);
      throw e;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function signOut() {
  const t = tokens;
  save(null);
  if (t) await cognito("RevokeToken", { Token: t.refreshToken, ClientId: getConfig().clientId }).catch(() => {});
}
