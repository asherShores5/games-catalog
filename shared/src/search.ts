import { isUnknownCopy } from "./copy";
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
  /**
   * Unset: everything but the Wishlist (the default view). Owned: has a Copy. Wishlist: on the
   * Wishlist and no Copy. All: everything, Wishlist included.
   */
  ownership?: Ownership;
  /** Keep Games with exactly this Play status. */
  playStatus?: PlayStatus;
  /** Keep Games missing key info: an Unknown Copy (location), no Tags, or either (any). */
  missing?: Missing;
  /** Keep Games that have every one of these Tags (AND), from any Tag source. Empty means unset. */
  tagIds?: string[];
}

export type Missing = "location" | "tags" | "any";
export const MISSINGS: readonly Missing[] = ["location", "tags", "any"];

export type Ownership = "owned" | "wishlist" | "all";
export const OWNERSHIPS: readonly Ownership[] = ["owned", "wishlist", "all"];

/**
 * The filter without Tag ids that aren't in `tags` (deleted or merged away since the URL was
 * made), so a stale link doesn't show "Unknown Tag" and zero results. Returns `filter` itself
 * when nothing changes.
 */
export function withoutUnknownTags(filter: GameFilter, tags: readonly { id: string }[]): GameFilter {
  if (!filter.tagIds?.length) return filter;
  const kept = filter.tagIds.filter((id) => tags.some((t) => t.id === id));
  if (kept.length === filter.tagIds.length) return filter;
  const { tagIds: _dropped, ...rest } = filter;
  return kept.length ? { ...rest, tagIds: kept } : rest;
}

/** The parts of a Game the list filter looks at. Missing `tags` reads as none. */
export type FilterableGame = Pick<Game, "name" | "copies" | "wishlist" | "playStatus"> & Partial<Pick<Game, "tags">>;

/** True when the Game belongs in the list under this filter (every set field must match). */
export function gameMatches(game: FilterableGame, filter: GameFilter): boolean {
  if (!matchesName(game.name, filter.query ?? "")) return false;
  if (filter.platformId && !game.copies.some((c) => c.platformId === filter.platformId)) return false;
  if (filter.ownership === "owned" && !isOwned(game.copies)) return false;
  const onWishlist = game.wishlist && canWishlist(game.copies);
  if (filter.ownership === "wishlist" && !onWishlist) return false;
  if (!filter.ownership && onWishlist) return false;
  if (filter.playStatus && game.playStatus !== filter.playStatus) return false;
  if (filter.tagIds?.some((id) => !game.tags?.some((t) => t.tagId === id))) return false;
  if (filter.missing) {
    const noLocation = game.copies.some(isUnknownCopy);
    const noTags = !game.tags?.length;
    if (filter.missing === "location" ? !noLocation : filter.missing === "tags" ? !noTags : !(noLocation || noTags)) return false;
  }
  return true;
}
