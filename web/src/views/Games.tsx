import { useEffect, useState } from "react";
import { byName, cleanGameName, type Game } from "@games/shared";
import { addGame, listGames } from "../api";
import { signOut } from "../auth";

/** My Games: add one by name, see the list. */
export function Games() {
  const [games, setGames] = useState<Game[]>();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    listGames().then(setGames, (e) => setError(String(e.message ?? e)));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = cleanGameName(name);
    if (!clean) return;
    setBusy(true);
    setError(undefined);
    try {
      const game = await addGame(clean);
      setGames((gs) => [...(gs ?? []), game].sort(byName));
      setName("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header>
        <h1>Games</h1>
        <button className="link" onClick={() => void signOut()}>Sign out</button>
      </header>
      <form className="add" onSubmit={submit}>
        <input placeholder="Add a Game" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        <button className="primary" disabled={busy || !cleanGameName(name)}>Add</button>
      </form>
      {error && <p className="error">{error}</p>}
      {!games ? (
        <p>Loading…</p>
      ) : games.length === 0 ? (
        <p className="empty">No Games yet.</p>
      ) : (
        <ul className="games">
          {games.map((g) => (
            <li key={g.id}>{g.name}</li>
          ))}
        </ul>
      )}
    </main>
  );
}
