import type { ReactNode } from "react";
import { canWishlist, copyParts, gameMatches, type CopyNames, type Game, type GameFilter } from "@games/shared";

/**
 * The Game list narrowed by a filter (client-side, re-run on every keystroke). Each row shows
 * every Copy (Platform, Format, Account, Edition); clicking a row opens it via renderDetail.
 */
export function GameList({ games, filter, names, openId, onToggle, renderDetail, tagName }: {
  games: Game[];
  /** Tag id to name; Tags it doesn't know aren't shown. */
  tagName?: (id: string) => string | undefined;
  filter: GameFilter;
  names: CopyNames;
  openId: string | undefined;
  onToggle: (id: string) => void;
  renderDetail: (game: Game) => ReactNode;
}) {
  if (games.length === 0) return <p className="empty">No Games yet.</p>;
  const shown = games.filter((g) => gameMatches(g, filter));
  if (shown.length === 0) return <p className="empty">No Games match.</p>;

  return (
    <ul className="games">
      {shown.map((g) => (
        <li key={g.id}>
          <button className="row" onClick={() => onToggle(g.id)} aria-expanded={openId === g.id}>
            <span>
              {g.name}
              {openId !== g.id && g.copies.length > 0 && (
                <span className="copy-summary">
                  {g.copies.map((c) => (
                    <span key={c.id}>{copyParts(c, names).join(" · ")}</span>
                  ))}
                </span>
              )}
            </span>
            <span className="badges">
              {g.owned && <span className="badge count">{g.copies.length === 1 ? "1 Copy" : `${g.copies.length} Copies`}</span>}
              {g.wishlist && canWishlist(g.copies) && <span className="badge wishlist">Wishlist</span>}
              {g.playStatus && <span className={`badge status ${g.playStatus.toLowerCase()}`}>{g.playStatus}</span>}
              {tagName && g.tags.map((t) => {
                const n = tagName(t.tagId);
                return n && <span key={t.tagId} className="badge tag">{n}</span>;
              })}
            </span>
          </button>
          {openId === g.id && renderDetail(g)}
        </li>
      ))}
    </ul>
  );
}
