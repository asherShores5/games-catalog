// Ownership rules (see GLOSSARY.md: Owned, Wishlist, Play status). Pure, shared by API and web.
import type { PlayStatus } from "./types";

/** Owned is derived: a Game with at least one Copy (Unknown Copies included). */
export function isOwned(copies: readonly unknown[]): boolean {
  return copies.length > 0;
}

/** Wishlist means "don't own, want", so it can be set only while the Game has no Copies. */
export function canWishlist(copies: readonly unknown[]): boolean {
  return !isOwned(copies);
}

interface OwnershipState {
  wishlist: boolean;
  playStatus: PlayStatus | null;
}

/** A Game's Wishlist and Play status after a Copy is added: buying a Wishlist Game puts it in the Backlog. */
export function afterCopyAdded(game: OwnershipState): OwnershipState {
  return game.wishlist ? { wishlist: false, playStatus: "Backlog" } : { wishlist: false, playStatus: game.playStatus };
}
