import { copyParts, type CopyNames, type Game } from "@games/shared";

/** One Game opened in the guest demo: its Copies, shown but not editable. */
export function ReadOnlyGame({ game, names }: { game: Game; names: CopyNames }) {
  return (
    <div className="detail">
      <ul className="copies">
        {game.copies.map((c) => (
          <li key={c.id}>
            <span>{copyParts(c, names).join(" · ")}</span>
          </li>
        ))}
        {game.copies.length === 0 && <li className="empty">No Copies: not Owned.</li>}
      </ul>
    </div>
  );
}
