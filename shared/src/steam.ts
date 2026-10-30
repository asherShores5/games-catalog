// Steam Import rules shared by API and web (see GLOSSARY.md: Import).

/**
 * A SteamID64 as stored: trimmed, 17 digits starting 7656119 (the individual-account range).
 * Undefined when the input can't be one. Vanity names ("gaben") aren't accepted: resolving them
 * would need another Steam call, and the Steam profile page shows the number.
 */
export function cleanSteamId(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const id = raw.trim();
  return /^7656119\d{10}$/.test(id) ? id : undefined;
}

/** The Platform every Steam Import Copy lands on. */
export const STEAM_PLATFORM = "PC";

/** What an Import reports back: how many Games it added and how many were already there. */
export interface SteamImportSummary {
  added: number;
  alreadyPresent: number;
  /** Names of the Games that got a new Copy, in name order. */
  addedNames: string[];
  /** Library entries that couldn't be saved this time: an error, or the Import ran out of time (re-running retries them). */
  failed: number;
  /** Games whose store Categories/Genres were read and applied as Tags this time. */
  tagged: number;
  /** Games still waiting for a store Tag lookup (per-Import limit, or the store was busy); re-run to continue. */
  tagsPending: number;
}
