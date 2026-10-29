export const PLATFORM_NAME_MAX = 50;

/** Platforms every new catalog starts with. Editable afterwards like any other. */
export const SEED_PLATFORMS = ["PC", "PS5", "PS4", "Xbox Series X|S", "Xbox One", "Switch", "Switch 2"] as const;

/** A Platform name as stored: trimmed, 1..PLATFORM_NAME_MAX characters. Undefined when the input can't be one. */
export function cleanPlatformName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const name = raw.trim();
  return name.length > 0 && name.length <= PLATFORM_NAME_MAX ? name : undefined;
}

/** True when two Platform names would read as the same Platform (case- and accent-insensitive). */
export function samePlatformName(a: string, b: string): boolean {
  return a.trim().localeCompare(b.trim(), "en", { sensitivity: "base" }) === 0;
}
