import { useEffect, useState } from "react";
import { byName, cleanGameName, type CopyNames, type Game, type Platform } from "@games/shared";
import { addGame, listGames, listPlatforms } from "../api";
import { signOut } from "../auth";
import { FilterBar, useUrlFilter } from "./FilterBar";
import { GameDetail } from "./GameDetail";
import { GameList } from "./GameList";
import { Platforms } from "./Platforms";

/** My Games: add one by name, search and filter the list, open one to manage its Copies. */
export function Games() {
  const [games, setGames] = useState<Game[]>();
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [openId, setOpenId] = useState<string>();
  const [showPlatforms, setShowPlatforms] = useState(false);
  const [filter, setFilter] = useUrlFilter();

  useEffect(() => {
    listGames().then(setGames, (e) => setError(String(e.message ?? e)));
    listPlatforms().then(setPlatforms, (e) => setError(String(e.message ?? e)));
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

  return (
    <main>
      <header>
        <h1>Games</h1>
        <span>
          <button className="link" onClick={() => setShowPlatforms(true)}>Platforms</button>
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
      ) : (
        <>
          <FilterBar filter={filter} onChange={setFilter} platforms={platforms} />
          <GameList
            games={games}
            filter={filter}
            names={copyNames(platforms)}
            openId={openId}
            onToggle={(id) => setOpenId(openId === id ? undefined : id)}
            renderDetail={(g) => <GameDetail game={g} platforms={platforms} onChange={replace} />}
          />
        </>
      )}
    </main>
  );
}

/** Id-to-name lookups for the Copies shown in the list. */
function copyNames(platforms: Platform[]): CopyNames {
  return { platformName: (id) => platforms.find((p) => p.id === id)?.name ?? "Unknown Platform" };
}
