import type { GameTag } from "./tag";

/** Digital or Physical (see GLOSSARY.md). */
export type Format = "Digital" | "Physical";
export const FORMATS: readonly Format[] = ["Digital", "Physical"];

/** Playing, Backlog, Finished, or none (null). Independent of ownership. */
export type PlayStatus = "Playing" | "Backlog" | "Finished";
export const PLAY_STATUSES: readonly PlayStatus[] = ["Playing", "Backlog", "Finished"];

/** The hardware a Copy runs on. An editable list; Copies point at it by id, so a rename follows. */
export interface Platform {
  id: string;
  name: string;
}

/** Where Digital Copies are bought. A fixed set; "Other" covers anything not listed. */
export type Store = "Steam" | "Epic" | "GOG" | "PSN" | "Xbox" | "Nintendo" | "Other";
export const STORES: readonly Store[] = ["Steam", "Epic", "GOG", "PSN", "Xbox", "Nintendo", "Other"];

/**
 * One login on a Store, with a nickname ("Steam: main"). The Store is fixed once created; only
 * the nickname can be renamed. Copies point at it by id, so a rename follows. Store-specific
 * data (a Steam Account's Steam ID, ticket 07) will be optional fields here.
 */
export interface Account {
  id: string;
  store: Store;
  nickname: string;
}

/**
 * One way a Game is owned. A Digital Copy names its Account; a Physical Copy has none. Copies
 * written before Accounts existed (ticket 03) may be Digital with no `accountId`: they still read
 * fine; the rule is enforced when a Copy is written.
 */
export interface Copy {
  id: string;
  platformId: string;
  format: Format;
  accountId?: string;
  edition?: string;
  createdAt: number;
}

/** One title, however many ways it is owned (see GLOSSARY.md). */
export interface Game {
  id: string;
  name: string;
  /** Every Copy of this Game, oldest first. */
  copies: Copy[];
  /** Derived: at least one Copy. Never stored, never set by hand. */
  owned: boolean;
  wishlist: boolean;
  playStatus: PlayStatus | null;
  /** Its Tags, each with its Tag source, in the order they were added. */
  tags: GameTag[];
  createdAt: number;
  updatedAt: number;
}
