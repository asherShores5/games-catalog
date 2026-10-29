import { useEffect, useState } from "react";
import { byName, canWishlist, cleanGameName, type Account, type Game, type Platform } from "@games/shared";
import { addGame, listAccounts, listGames, listPlatforms } from "../api";
import { signOut } from "../auth";
import { Accounts } from "./Accounts";
import { GameDetail } from "./GameDetail";
import { Platforms } from "./Platforms";

/** My Games: add one by name, see the list, open one to manage its Copies. */
export function Games() {
  const [games, setGames] = useState<Game[]>();
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [openId, setOpenId] = useState<string>();
  const [showPlatforms, setShowPlatforms] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showAccounts, setShowAccounts] = useState(false);

  useEffect(() => {
    listGames().then(setGames, (e) => setError(String(e.message ?? e)));
    listPlatforms().then(setPlatforms, (e) => setError(String(e.message ?? e)));
    listAccounts().then(setAccounts, (e) => setError(String(e.message ?? e)));
  }, []);

  const replace = (game: Game) => setGames((gs) => (gs ?? []).map((g) => (g.id === game.id ? game : g)));

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

  if (showPlatforms) {
    return <Platforms platforms={platforms} onChange={setPlatforms} onClose={() => setShowPlatforms(false)} />;
  }
  if (showAccounts) {
    return <Accounts accounts={accounts} onChange={setAccounts} onClose={() => setShowAccounts(false)} />;
  }

  return (
    <main>
      <header>
        <h1>Games</h1>
        <span>
          <button className="link" onClick={() => setShowPlatforms(true)}>Platforms</button>
          <button className="link" onClick={() => setShowAccounts(true)}>Accounts</button>
          <button className="link" onClick={() => void signOut()}>Sign out</button>
        </span>
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
            <li key={g.id}>
              <button className="row" onClick={() => setOpenId(openId === g.id ? undefined : g.id)} aria-expanded={openId === g.id}>
                <span>{g.name}</span>
                <span className="badges">
                  {g.owned && <span className="badge">{g.copies.length === 1 ? "1 Copy" : `${g.copies.length} Copies`}</span>}
                  {g.wishlist && canWishlist(g.copies) && <span className="badge">Wishlist</span>}
                  {g.playStatus && <span className="badge">{g.playStatus}</span>}
                </span>
              </button>
              {openId === g.id && <GameDetail game={g} platforms={platforms} accounts={accounts} onChange={replace} />}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
