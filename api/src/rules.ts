// Pure validation rules, kept free of AWS calls. Domain rules shared with the web app live in
// @games/shared; this file turns their "can't be one" answers into UserErrors.
import {
  ACCOUNT_NICKNAME_MAX, EDITION_MAX, FORMATS, GAME_NAME_MAX, PLATFORM_NAME_MAX, PLAY_STATUSES, STORES,
  accountLabel, cleanAccountNickname, needsAccount, cleanEdition, cleanGameName, cleanPlatformName, sameAccount, samePlatformName,
  type Account, type Format, type Platform, type PlayStatus, type Store,
} from "@games/shared";

/** An error the caller caused. The client sees "<type>: <message>"; anything else is InternalError. */
export class UserError extends Error {
  constructor(public type: "ValidationError" | "NotFound" | "Conflict", message: string) {
    super(message);
  }
}

export function validateGameName(raw: unknown): string {
  const name = cleanGameName(raw);
  if (name === undefined) throw new UserError("ValidationError", `Game name must be 1-${GAME_NAME_MAX} characters`);
  return name;
}

/** A new or renamed Platform name: valid, and not another Platform's name (case-insensitive). */
export function validatePlatformName(raw: unknown, existing: Platform[], selfId?: string): string {
  const name = cleanPlatformName(raw);
  if (name === undefined) throw new UserError("ValidationError", `Platform name must be 1-${PLATFORM_NAME_MAX} characters`);
  const clash = existing.find((p) => p.id !== selfId && samePlatformName(p.name, name));
  if (clash) throw new UserError("ValidationError", `There is already a Platform called "${clash.name}"`);
  return name;
}

export function validateFormat(raw: unknown): Format {
  if (!FORMATS.includes(raw as Format)) throw new UserError("ValidationError", `Format must be ${FORMATS.join(" or ")}`);
  return raw as Format;
}

/** Optional Edition: missing or blank means none. */
export function validateEdition(raw: unknown): string | undefined {
  const r = cleanEdition(raw);
  if (!r.ok) throw new UserError("ValidationError", `Edition must be at most ${EDITION_MAX} characters`);
  return r.edition;
}

/** Play status, or null for none. */
export function validatePlayStatus(raw: unknown): PlayStatus | null {
  if (raw === null || raw === undefined) return null;
  if (!PLAY_STATUSES.includes(raw as PlayStatus)) {
    throw new UserError("ValidationError", `Play status must be ${PLAY_STATUSES.join(", ")} or none`);
  }
  return raw as PlayStatus;
}

export function validateStore(raw: unknown): Store {
  if (!STORES.includes(raw as Store)) throw new UserError("ValidationError", `Store must be one of ${STORES.join(", ")}`);
  return raw as Store;
}

/** A new or renamed Account nickname: valid, and not another Account on the same Store (case-insensitive). */
export function validateAccountNickname(raw: unknown, store: Store, existing: Account[], selfId?: string): string {
  const nickname = cleanAccountNickname(raw);
  if (nickname === undefined) {
    throw new UserError("ValidationError", `Account nickname must be 1-${ACCOUNT_NICKNAME_MAX} characters`);
  }
  const clash = existing.find((a) => a.id !== selfId && sameAccount(a, { store, nickname }));
  if (clash) throw new UserError("ValidationError", `There is already an Account "${accountLabel(clash)}"`);
  return nickname;
}

/**
 * The Account a new Copy names, by id: required for Digital, refused for Physical. Missing, null
 * or "" all mean none. Whether the Account exists is the caller's check.
 */
export function validateCopyAccount(format: Format, raw: unknown): string | undefined {
  const accountId = raw === null || raw === undefined || raw === "" ? undefined : raw;
  if (accountId !== undefined && typeof accountId !== "string") throw new UserError("ValidationError", "accountId must be an id");
  if (needsAccount(format) && accountId === undefined) {
    throw new UserError("ValidationError", "A Digital Copy needs an Account; add one under Accounts first if needed");
  }
  if (!needsAccount(format) && accountId !== undefined) throw new UserError("ValidationError", "A Physical Copy can't have an Account");
  return accountId;
}
