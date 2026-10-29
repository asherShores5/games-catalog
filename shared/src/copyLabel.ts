import type { Copy } from "./types";

/** How the list turns ids into names. accountName is optional until the web loads Accounts. */
export interface CopyNames {
  platformName: (platformId: string) => string;
  accountName?: (accountId: string) => string;
}

/**
 * The parts shown for one Copy, in order: Platform, Format, then Account and Edition only when
 * the Copy has them. `accountId` is read only if present, so this works before and after
 * Copies carry Accounts.
 */
export function copyParts(
  copy: Pick<Copy, "platformId" | "format" | "edition"> & { accountId?: string },
  names: CopyNames,
): string[] {
  const parts = [names.platformName(copy.platformId), copy.format];
  if (copy.accountId && names.accountName) parts.push(names.accountName(copy.accountId));
  if (copy.edition) parts.push(copy.edition);
  return parts;
}
