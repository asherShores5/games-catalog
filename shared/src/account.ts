import type { Account, Format, Store } from "./types";

export const ACCOUNT_NICKNAME_MAX = 50;

/** An Account nickname as stored: trimmed, 1..ACCOUNT_NICKNAME_MAX characters. Undefined when the input can't be one. */
export function cleanAccountNickname(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const nickname = raw.trim();
  return nickname.length > 0 && nickname.length <= ACCOUNT_NICKNAME_MAX ? nickname : undefined;
}

/** True when two Accounts would read as the same login: same Store, nickname equal ignoring case and accents. */
export function sameAccount(a: { store: Store; nickname: string }, b: { store: Store; nickname: string }): boolean {
  return a.store === b.store && a.nickname.trim().localeCompare(b.nickname.trim(), "en", { sensitivity: "base" }) === 0;
}

/** How an Account reads everywhere: "Steam: main". */
export const accountLabel = (a: { store: Store; nickname: string }) => `${a.store}: ${a.nickname}`;

/** List order for Accounts: by label, ignoring case and accents. */
export function byAccountLabel(a: Account, b: Account): number {
  return accountLabel(a).localeCompare(accountLabel(b), "en", { sensitivity: "base" });
}

/** A Digital Copy must name its Account; a Physical Copy can't have one. */
export const needsAccount = (format: Format) => format === "Digital";
