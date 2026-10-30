import { useState } from "react";
import type { Game } from "@games/shared";
import { deleteGame } from "../api";

/** Delete the opened Game, after a confirm. A Steam Game also stays out of later Imports. */
export function DeleteGame({ game, onDeleted }: { game: Game; onDeleted: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function remove() {
    const steam = game.steamAppId !== undefined ? " A Steam Import won't add it back." : "";
    if (!confirm(`Delete "${game.name}" and its ${game.copies.length === 1 ? "Copy" : "Copies"}?${steam}`)) return;
    setBusy(true);
    setError(undefined);
    try {
      onDeleted(await deleteGame(game.id));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="link danger" disabled={busy} onClick={() => void remove()}>Delete Game…</button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
