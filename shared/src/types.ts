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

/**
 * One way a Game is owned. Accounts (for Digital Copies) arrive in ticket 03 as an optional
 * `accountId`; nothing here assumes a Copy is fully described by Platform + Format.
 */
export interface Copy {
  id: string;
  platformId: string;
  format: Format;
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
  createdAt: number;
  updatedAt: number;
}
