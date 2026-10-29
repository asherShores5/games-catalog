/** Folds a name or query for search: lower case, accents stripped, punctuation and spacing dropped. */
export function searchKey(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
}

/** True when the query appears anywhere in the name. An empty query matches every name. */
export function matchesName(name: string, query: string): boolean {
  return searchKey(name).includes(searchKey(query));
}

/**
 * What narrows the Game list. Ticket 04 has the name search only; the filter bar (Tags,
 * Platform, Wishlist / Owned, Play status) adds optional fields here and checks in gameMatches.
 * An unset field never excludes a Game.
 */
export interface GameFilter {
  query?: string;
}

/** True when the Game belongs in the list under this filter (every set field must match). */
export function gameMatches(game: { name: string }, filter: GameFilter): boolean {
  return matchesName(game.name, filter.query ?? "");
}
