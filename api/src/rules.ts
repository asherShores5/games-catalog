// Pure validation rules, kept free of AWS calls. Domain rules shared with the web app live in
// @games/shared; this file turns their "can't be one" answers into UserErrors.
import {
  ACCOUNT_NICKNAME_MAX, EDITION_MAX, FORMATS, GAME_NAME_MAX, PLATFORM_NAME_MAX, PLAY_STATUSES, STORES,
  accountLabel, cleanAccountNickname, cleanSteamId, needsAccount, cleanEdition, cleanGameName, cleanPlatformName, sameAccount, samePlatformName,
  type Account, type Format, type PlayStatus, type Store,
} from "@games/shared";
import { TAG_NAME_MAX, cleanTagName, sameTagName } from "@games/shared";

/** An error the caller caused. The client sees "<type>: <message>"; anything else is InternalError. */
export class UserError extends Error {
  constructor(public type: "ValidationError" | "NotFound" | "Conflict" | "SteamError", message: string) {
    super(message);
  }
}

export function validateGameName(raw: unknown): string {
  const name = cleanGameName(raw);
  if (name === undefined) throw new UserError("ValidationError", `Game name must be 1-${GAME_NAME_MAX} characters`);
  return name;
}

/**
 * The rule for a new or renamed name in an editable list (Platforms, Tags): valid, and not
 * another entry's name (`same` decides which names read as one). `selfId` is the entry being renamed.
 */
function uniqueName(
  what: string,
  max: number,
  clean: (raw: unknown) => string | undefined,
  same: (a: string, b: string) => boolean,
) {
  return (raw: unknown, existing: readonly { id: string; name: string }[], selfId?: string): string => {
    const name = clean(raw);
    if (name === undefined) throw new UserError("ValidationError", `${what} name must be 1-${max} characters`);
    const clash = existing.find((x) => x.id !== selfId && same(x.name, name));
    if (clash) throw new UserError("ValidationError", `There is already a ${what} called "${clash.name}"`);
    return name;
  };
}

/** A new or renamed Platform name: valid, and not another Platform's name (case-insensitive). */
export const validatePlatformName = uniqueName("Platform", PLATFORM_NAME_MAX, cleanPlatformName, samePlatformName);

/** A new or renamed Tag name: valid, and not another Tag's name (case- and accent-insensitive). */
export const validateTagName = uniqueName("Tag", TAG_NAME_MAX, cleanTagName, sameTagName);

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

/** A Steam ID for a Steam Account, or undefined to clear it (null or ""). Only Steam Accounts have one. */
export function validateSteamId(store: Store, raw: unknown): string | undefined {
  if (store !== "Steam") throw new UserError("ValidationError", "Only a Steam Account has a Steam ID");
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) return undefined;
  const id = cleanSteamId(raw);
  // The message never echoes the input: it is Account data and errors can reach logs.
  if (id === undefined) throw new UserError("ValidationError", "A Steam ID is the 17-digit number starting 7656119 on your Steam profile");
  return id;
}
