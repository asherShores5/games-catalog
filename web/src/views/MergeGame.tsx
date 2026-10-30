import { useState } from "react";
import { PLAY_STATUSES, byName, copyParts, planMerge, type CopyNames, type Game, type PlayStatus } from "@games/shared";
import { mergeGames } from "../api";

/**
 * Merge the opened Game into another one (the one that stays). Pick the Game, then a confirm
 * step shows what combines, using the same planMerge the API applies.
 */
export function MergeGame({ game, games, names, tagName, onMerged }: {
  game: Game;
  games: Game[];
  names: CopyNames;
  tagName: (id: string) => string | undefined;
  onMerged: (merged: Game, goneId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [intoId, setIntoId] = useState("");
  // "" = the more advanced Play status (automatic); "none" = none; else that status.
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const others = games.filter((g) => g.id !== game.id).sort(byName);
  const into = others.find((g) => g.id === intoId);

  if (!open) {
    return (
      <div>
        <button className="link" disabled={others.length === 0} onClick={() => setOpen(true)}>Merge into another Game…</button>
      </div>
    );
  }

  const choice = status === "" ? undefined : { playStatus: status === "none" ? null : (status as PlayStatus) };
  const plan = into && planMerge(into, game, choice);
  const auto = into && planMerge(into, game).playStatus;
  const dropped = new Set(plan?.droppedCopyIds ?? []);
  const label = (c: Game["copies"][number]) => copyParts(c, names).join(" · ");

  async function confirm() {
    if (!into) return;
    setBusy(true);
    setError(undefined);
    try {
      onMerged(await mergeGames(game.id, into.id, choice), game.id);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="detail merge">
      <label>
        Merge “{game.name}” into{" "}
        <select value={intoId} onChange={(e) => setIntoId(e.target.value)}>
          <option value="">Pick the Game to keep…</option>
          {others.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </label>
      {into && plan && (
        <>
          <p>“{into.name}” stays; “{game.name}” is deleted. The result:</p>
          <ul>
            <li>
              Copies: {plan.copies.length}
              <ul>
                {[...into.copies, ...game.copies].map((c) => (
                  <li key={c.id}>{dropped.has(c.id) ? <s>{label(c)}</s> : label(c)}{dropped.has(c.id) && " (location now known; removed)"}</li>
                ))}
              </ul>
            </li>
            <li>Tags: {plan.tags.tags.map((t) => tagName(t.tagId)).filter(Boolean).join(", ") || "none"}</li>
            <li>{plan.owned ? "Owned" : plan.wishlist ? "Not owned, on the Wishlist" : "Not owned"}</li>
            <li>
              Play status{" "}
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">{auto ?? "none"} (the more advanced)</option>
                {PLAY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                <option value="none">none</option>
              </select>
            </li>
            {plan.steamAppId !== undefined && (
              <li>
                Steam app {plan.steamAppId}
                {plan.mergedSteamAppIds.length > 0 && ` (Imports also match app ${plan.mergedSteamAppIds.join(", ")})`}
              </li>
            )}
          </ul>
        </>
      )}
      <div className="add">
        <button className="primary" disabled={busy || !into} onClick={() => void confirm()}>Merge</button>
        <button className="link" disabled={busy} onClick={() => { setOpen(false); setIntoId(""); setStatus(""); setError(undefined); }}>Cancel</button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
