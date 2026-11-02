import { isUnknownCopy } from "./copy";
import type { Place } from "./place";
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
  /** Keep Games with at least one Copy on a Platform in this Place. An unknown Place filters nothing. */
  placeId?: string;
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

/** What the filter needs besides the Game: the Places, and Tag names for search. */
export interface FilterLookups {
  places?: readonly Place[];
  tagName?: (id: string) => string | undefined;
}

/**
 * Search: the whole query in the name (as always), or else every word of it in the name or in
 * one of the Game's Tag names. So "co-op rpg" finds Games tagged both, and "rpg ring" Elden Ring.
 */
export function matchesSearch(game: Pick<FilterableGame, "name" | "tags">, query: string, tagName?: (id: string) => string | undefined): boolean {
  if (matchesName(game.name, query)) return true;
  const words = query.split(/\s+/).map(searchKey).filter(Boolean);
  if (words.length === 0) return true;
  const name = searchKey(game.name);
  const tags = (game.tags ?? []).map((t) => tagName?.(t.tagId)).filter((n): n is string => !!n).map(searchKey);
  return words.every((w) => name.includes(w) || tags.some((t) => t.includes(w)));
}

/** True when the Game belongs in the list under this filter (every set field must match). */
export function gameMatches(game: FilterableGame, filter: GameFilter, lookups: FilterLookups = {}): boolean {
  if (!matchesSearch(game, filter.query ?? "", lookups.tagName)) return false;
  const place = filter.placeId ? lookups.places?.find((p) => p.id === filter.placeId) : undefined;
  if (place && !game.copies.some((c) => c.platformId !== undefined && place.platformIds.includes(c.platformId))) return false;
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
