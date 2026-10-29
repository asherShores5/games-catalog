export const GAME_NAME_MAX = 200;

/** A Game name as stored: trimmed, 1..GAME_NAME_MAX characters. Undefined when the input can't be one. */
export function cleanGameName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const name = raw.trim();
  return name.length > 0 && name.length <= GAME_NAME_MAX ? name : undefined;
}

/** List order for Games: by name, ignoring case and accents. */
export function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
}
