export const EDITION_MAX = 100;

/** An optional Edition: missing or blank is none; otherwise trimmed, at most EDITION_MAX characters. */
export function cleanEdition(raw: unknown): { ok: true; edition: string | undefined } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, edition: undefined };
  if (typeof raw !== "string") return { ok: false };
  const edition = raw.trim();
  if (edition.length > EDITION_MAX) return { ok: false };
  return { ok: true, edition: edition || undefined };
}
