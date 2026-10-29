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
 * the nickname can be renamed. Copies point at it by id, so a rename follows. A Steam Account
 * may hold a Steam ID for the Import; it is private Account data that the API never returns,
 * so the client only learns whether one is set.
 */
export interface Account {
  id: string;
  store: Store;
  nickname: string;
  hasSteamId: boolean;
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
  /** The Steam app this Game matches, once a Steam Import created or matched it. Public data. */
  steamAppId?: number;
  createdAt: number;
  updatedAt: number;
}
