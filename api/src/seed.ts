// The Seed's pure rules: what a row of the Notion "Gaming catalog" page may say, and what Game
// each one becomes. The writes live in handler.ts (`seedGames`) so they share the API's records
// and guards. See GLOSSARY.md: Seed, Unknown Copy.
import { searchKey, type PlayStatus } from "@games/shared";
import { UserError, validateGameName } from "./rules";

/** The Status column on the Notion page. */
export const SEED_STATUSES = ["Playing", "Owned", "Not owned"] as const;
export type SeedStatus = (typeof SEED_STATUSES)[number];

export interface SeedRow {
  name: string;
  status: SeedStatus;
}

/** What a Seeded Game starts as. Owned rows get one Unknown Copy; Not owned rows go on the Wishlist. */
export function seedState(status: SeedStatus): { wishlist: boolean; playStatus: PlayStatus | null; unknownCopy: boolean } {
  if (status === "Not owned") return { wishlist: true, playStatus: null, unknownCopy: false };
  return { wishlist: false, playStatus: status === "Playing" ? "Playing" : null, unknownCopy: true };
}

/**
 * Two names are the same Game for the Seed when they match ignoring case, accents, punctuation
 * and spacing (the search key), so "Half Life 2" in the catalog blocks a Seeded "Half-Life 2".
 */
export const seedKey = (name: string) => searchKey(name);

/** Check every row before anything is written: valid names and statuses, no Game listed twice. */
export function parseSeedRows(raw: unknown): SeedRow[] {
  if (!Array.isArray(raw)) throw new UserError("ValidationError", "Seed data must be a list of { name, status } rows");
  const seen = new Map<string, string>();
  return raw.map((row, i) => {
    const r = (row ?? {}) as { name?: unknown; status?: unknown };
    const where = `Seed row ${i + 1}`;
    let name: string;
    try {
      name = validateGameName(r.name);
    } catch (e) {
      throw new UserError("ValidationError", `${where}: ${(e as Error).message}`);
    }
    if (!SEED_STATUSES.includes(r.status as SeedStatus)) {
      throw new UserError("ValidationError", `${where} (${name}): status must be ${SEED_STATUSES.join(", ")}`);
    }
    const dup = seen.get(seedKey(name));
    if (dup !== undefined) throw new UserError("ValidationError", `${where}: "${name}" repeats "${dup}"`);
    seen.set(seedKey(name), name);
    return { name, status: r.status as SeedStatus };
  });
}
