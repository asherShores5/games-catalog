import type { Copy } from "./types";

export const EDITION_MAX = 100;

/** An optional Edition: missing or blank is none; otherwise trimmed, at most EDITION_MAX characters. */
export function cleanEdition(raw: unknown): { ok: true; edition: string | undefined } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, edition: undefined };
  if (typeof raw !== "string") return { ok: false };
  const edition = raw.trim();
  if (edition.length > EDITION_MAX) return { ok: false };
  return { ok: true, edition: edition || undefined };
}

/** An Unknown Copy: owned, but its Platform and Format aren't known yet (see GLOSSARY.md). */
export function isUnknownCopy(copy: Pick<Copy, "platformId" | "format">): boolean {
  return copy.platformId === undefined || copy.format === undefined;
}

/** How an Unknown Copy reads wherever a Copy's Platform and Format would. */
export const UNKNOWN_LOCATION = "location unknown";
