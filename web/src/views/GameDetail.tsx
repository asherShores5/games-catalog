import { useState } from "react";
import { EDITION_MAX, FORMATS, PLAY_STATUSES, canWishlist, type Format, type Game, type Platform, type PlayStatus } from "@games/shared";
import { addCopy, removeCopy, setPlayStatus, setWishlist } from "../api";

/** One Game opened: its Copies (add/remove), Play status and Wishlist. */
export function GameDetail({ game, platforms, onChange }: { game: Game; platforms: Platform[]; onChange: (g: Game) => void }) {
  const [platformId, setPlatformId] = useState(platforms[0]?.id ?? "");
  const [format, setFormat] = useState<Format>("Digital");
  const [edition, setEdition] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const platformName = (id: string) => platforms.find((p) => p.id === id)?.name ?? "Unknown Platform";

  async function run(action: () => Promise<Game>) {
    setBusy(true);
    setError(undefined);
    try {
      onChange(await action());
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitCopy(e: React.FormEvent) {
    e.preventDefault();
    const chosen = platformId || platforms[0]?.id;
    if (!chosen) return;
    if (await run(() => addCopy({ gameId: game.id, platformId: chosen, format, edition: edition.trim() || undefined }))) setEdition("");
  }

  return (
    <div className="detail">
      <ul className="copies">
        {game.copies.map((c) => (
          <li key={c.id}>
            <span>
              {platformName(c.platformId)} · {c.format}
              {c.edition && ` · ${c.edition}`}
            </span>
            <button className="link" disabled={busy} onClick={() => void run(() => removeCopy(game.id, c.id))}>Remove</button>
          </li>
        ))}
        {game.copies.length === 0 && <li className="empty">No Copies: not Owned.</li>}
      </ul>

      <form className="add" onSubmit={submitCopy}>
        <select value={platformId} onChange={(e) => setPlatformId(e.target.value)} aria-label="Platform">
          {platforms.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select value={format} onChange={(e) => setFormat(e.target.value as Format)} aria-label="Format">
          {FORMATS.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <input placeholder="Edition (optional)" value={edition} onChange={(e) => setEdition(e.target.value)} maxLength={EDITION_MAX} />
        <button className="primary" disabled={busy || platforms.length === 0}>Add Copy</button>
      </form>

      <div className="add">
        <label>
          Play status{" "}
          <select
            value={game.playStatus ?? ""}
            disabled={busy}
            onChange={(e) => void run(() => setPlayStatus(game.id, (e.target.value || null) as PlayStatus | null))}
          >
            <option value="">None</option>
            {PLAY_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label title={canWishlist(game.copies) ? "" : "Owned Games can't be on the Wishlist"}>
          <input
            type="checkbox"
            checked={game.wishlist}
            disabled={busy || (!game.wishlist && !canWishlist(game.copies))}
            onChange={(e) => void run(() => setWishlist(game.id, e.target.checked))}
          />{" "}
          Wishlist
        </label>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
