import { useState } from "react";
import {
  EDITION_MAX, FORMATS, PLAY_STATUSES, UNKNOWN_LOCATION, accountLabel, canWishlist, needsAccount,
  type Account, type Format, type Game, type Platform, type PlayStatus,
} from "@games/shared";
import { addCopy, fillUnknownCopy, removeCopy, setPlayStatus, setWishlist } from "../api";

/** One Game opened: its Copies (add/remove, fill in an Unknown Copy), Play status and Wishlist. */
export function GameDetail({ game, platforms, accounts, onChange }: {
  game: Game;
  platforms: Platform[];
  accounts: Account[];
  onChange: (g: Game) => void;
}) {
  const [platformId, setPlatformId] = useState(platforms[0]?.id ?? "");
  const [format, setFormat] = useState<Format>("Digital");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [edition, setEdition] = useState("");
  // The Unknown Copy the form below is filling in, or undefined when it adds a new Copy.
  const [fillingId, setFillingId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const platformName = (id: string) => platforms.find((p) => p.id === id)?.name ?? "Unknown Platform";
  const accountName = (id: string | undefined) => {
    const a = id && accounts.find((x) => x.id === id);
    return a ? accountLabel(a) : id ? "Unknown Account" : "no Account";
  };
  // A Digital Copy needs an Account; Physical never sends one.
  const chosenAccount = accountId || accounts[0]?.id;
  const accountMissing = needsAccount(format) && !chosenAccount;

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
    if (!chosen || accountMissing) return;
    const account = needsAccount(format) ? chosenAccount : undefined;
    const copy = { gameId: game.id, platformId: chosen, format, accountId: account, edition: edition.trim() || undefined };
    const saved = fillingId
      ? await run(() => fillUnknownCopy({ ...copy, copyId: fillingId }))
      : await run(() => addCopy(copy));
    if (saved) {
      setEdition("");
      setFillingId(undefined);
    }
  }

  return (
    <div className="detail">
      <ul className="copies">
        {game.copies.map((c) => (
          <li key={c.id}>
            {c.platformId === undefined || c.format === undefined ? (
              <span>
                <em>{UNKNOWN_LOCATION}</em>
                {c.edition && ` · ${c.edition}`}{" "}
                <button className="link" disabled={busy} onClick={() => setFillingId(fillingId === c.id ? undefined : c.id)}>
                  {fillingId === c.id ? "Cancel" : "Fill in"}
                </button>
              </span>
            ) : (
              <span>
                {platformName(c.platformId)} · {c.format}
                {needsAccount(c.format) && ` · ${accountName(c.accountId)}`}
                {c.edition && ` · ${c.edition}`}
              </span>
            )}
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
        {needsAccount(format) && (
          <select value={chosenAccount ?? ""} onChange={(e) => setAccountId(e.target.value)} aria-label="Account">
            {accounts.length === 0 && <option value="">Add an Account first</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{accountLabel(a)}</option>
            ))}
          </select>
        )}
        <input placeholder="Edition (optional)" value={edition} onChange={(e) => setEdition(e.target.value)} maxLength={EDITION_MAX} />
        <button className="primary" disabled={busy || platforms.length === 0 || accountMissing}>
          {fillingId ? "Save location" : "Add Copy"}
        </button>
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
