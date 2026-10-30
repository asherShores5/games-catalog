// Merge Games (see GLOSSARY.md: Merge). Pure: the API writes this plan, the web previews it.
import { isUnknownCopy } from "./copy";
import { isOwned } from "./ownership";
import { combineGameTags, type GameTag, type GameTags } from "./tag";
import type { Copy, PlayStatus } from "./types";

/** What a Merge reads from each Game. `removedTagIds` and `mergedSteamAppIds` are private (API only). */
export interface MergeSide {
  copies: Copy[];
  wishlist: boolean;
  playStatus: PlayStatus | null;
  tags: GameTag[];
  removedTagIds?: string[];
  steamAppId?: number;
  mergedSteamAppIds?: number[];
}

/** The surviving Game's state after the other Game is merged into it. */
export interface MergePlan {
  /** Every Copy the merged Game keeps (both Games' Copies, minus `droppedCopyIds`). */
  copies: Copy[];
  /** Redundant Unknown Copies the Merge removes (see `planMerge`). */
  droppedCopyIds: string[];
  owned: boolean;
  wishlist: boolean;
  playStatus: PlayStatus | null;
  /** The Steam app ID the merged Game shows: the surviving Game's, else the other's. */
  steamAppId?: number;
  /** Other Steam app IDs that also match this Game in an Import (e.g. a second Steam edition). Private. */
  mergedSteamAppIds: number[];
  tags: GameTags;
}

const RANK: Record<string, number> = { Playing: 3, Finished: 2, Backlog: 1 };
const rank = (s: PlayStatus | null) => (s ? RANK[s] : 0);

/** The more advanced Play status: Playing > Finished > Backlog > none. */
export function mergedPlayStatus(a: PlayStatus | null, b: PlayStatus | null): PlayStatus | null {
  return rank(a) >= rank(b) ? a : b;
}

/** A side whose only Copies are Unknown Copies: it knows the Game is owned, not where. */
const onlyUnknown = (copies: Copy[]) => copies.length > 0 && copies.every(isUnknownCopy);
/** Unknown Copies that say nothing beyond "owned" (no Edition). */
const bareUnknown = (copies: Copy[]) => copies.filter((c) => isUnknownCopy(c) && !c.edition).map((c) => c.id);

/**
 * Merge `from` into `into`. Every Copy and Tag combines (Tags via combineGameTags). Play status
 * is the more advanced of the two unless `choice` names one (null = none). Owned if either was;
 * Wishlist then clears.
 *
 * Unknown Copies: when one Game's only Copies are Unknown, its edition-less ones are redundant
 * once the other Game has a Copy, so they're dropped: the other Game's known Copies say where it
 * is (same idea as an Import filling in a lone Unknown Copy). Two Games with only Unknown Copies
 * keep the surviving Game's. An Unknown Copy that sat beside known Copies, or notes an Edition,
 * is kept. Copies are never otherwise deduped: two on the same Platform, Format and Account stay.
 *
 * Steam app IDs: the surviving Game's stays its `steamAppId` (else the other's); any other one
 * goes in `mergedSteamAppIds`, so an Import still matches either app to this Game.
 */
export function planMerge(into: MergeSide, from: MergeSide, choice?: { playStatus: PlayStatus | null }): MergePlan {
  const dropped = new Set<string>();
  if (onlyUnknown(from.copies) && into.copies.length > 0) bareUnknown(from.copies).forEach((id) => dropped.add(id));
  if (onlyUnknown(into.copies) && from.copies.some((c) => !isUnknownCopy(c))) bareUnknown(into.copies).forEach((id) => dropped.add(id));
  const copies = [...into.copies, ...from.copies].filter((c) => !dropped.has(c.id));
  const owned = isOwned(copies);

  const appIds = [into.steamAppId, from.steamAppId, ...(into.mergedSteamAppIds ?? []), ...(from.mergedSteamAppIds ?? [])];
  const steamAppId = into.steamAppId ?? from.steamAppId;
  const mergedSteamAppIds = [...new Set(appIds.filter((id): id is number => id !== undefined && id !== steamAppId))];

  return {
    copies,
    droppedCopyIds: [...dropped],
    owned,
    wishlist: !owned && (into.wishlist || from.wishlist),
    playStatus: choice ? choice.playStatus : mergedPlayStatus(into.playStatus, from.playStatus),
    steamAppId,
    mergedSteamAppIds,
    tags: combineGameTags(
      { tags: into.tags, removedTagIds: into.removedTagIds ?? [] },
      { tags: from.tags, removedTagIds: from.removedTagIds ?? [] },
    ),
  };
}
