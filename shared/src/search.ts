import { canWishlist, isOwned } from "./ownership";
import type { Game, PlayStatus } from "./types";

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
 * What narrows the Game list. Every field is optional and an unset field never excludes a Game;
 * set fields combine with AND.
 */
export interface GameFilter {
  /** Name search (see matchesName). */
  query?: string;
  /** Keep Games with at least one Copy on this Platform. */
  platformId?: string;
  /** Owned: has a Copy. Wishlist: on the Wishlist and no Copy. */
  ownership?: Ownership;
  /** Keep Games with exactly this Play status. */
  playStatus?: PlayStatus;
}

export type Ownership = "owned" | "wishlist";
export const OWNERSHIPS: readonly Ownership[] = ["owned", "wishlist"];

/** The parts of a Game the list filter looks at. */
export type FilterableGame = Pick<Game, "name" | "copies" | "wishlist" | "playStatus">;

/** True when the Game belongs in the list under this filter (every set field must match). */
export function gameMatches(game: FilterableGame, filter: GameFilter): boolean {
  if (!matchesName(game.name, filter.query ?? "")) return false;
  if (filter.platformId && !game.copies.some((c) => c.platformId === filter.platformId)) return false;
  if (filter.ownership === "owned" && !isOwned(game.copies)) return false;
  if (filter.ownership === "wishlist" && !(game.wishlist && canWishlist(game.copies))) return false;
  if (filter.playStatus && game.playStatus !== filter.playStatus) return false;
  return true;
}
