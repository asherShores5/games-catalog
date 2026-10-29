import { useEffect, useState } from "react";
import { accountLabel, byName, cleanGameName, type Account, type CopyNames, type Game, type Platform } from "@games/shared";
import { addGame, listAccounts, listGames, listPlatforms } from "../api";
import { signOut } from "../auth";
import { Accounts } from "./Accounts";
import { FilterBar, useUrlFilter } from "./FilterBar";
import { GameDetail } from "./GameDetail";
import { GameList } from "./GameList";
import { Platforms } from "./Platforms";
import type { Tag } from "@games/shared";
import { listTags } from "../api";
import { GameTags } from "./GameTags";
import { MergeGame } from "./MergeGame";
import { Tags } from "./Tags";

/** My Games: add one by name, search and filter the list, open one to manage its Copies. */
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
  const [filter, setFilter] = useUrlFilter();
  const [tags, setTags] = useState<Tag[]>([]);
  const [showTags, setShowTags] = useState(false);

  useEffect(() => {
    listTags().then(setTags, (e) => setError(String(e.message ?? e)));
  }, []);

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
  if (showTags) {
    const reloadGames = () => void listGames().then(setGames, (e) => setError(String(e.message ?? e)));
    return <Tags tags={tags} onChange={setTags} onGamesChanged={reloadGames} onClose={() => setShowTags(false)} />;
  }
  if (showAccounts) {
    const reload = () => {
      listGames().then(setGames, (e) => setError(String(e.message ?? e)));
      listPlatforms().then(setPlatforms, (e) => setError(String(e.message ?? e)));
    };
    return <Accounts accounts={accounts} onChange={setAccounts} onImported={reload} onClose={() => setShowAccounts(false)} />;
  }

  return (
    <main>
      <header>
        <h1>Games</h1>
        <span>
          <button className="link" onClick={() => setShowPlatforms(true)}>Platforms</button>
          <button className="link" onClick={() => setShowAccounts(true)}>Accounts</button>
          <button className="link" onClick={() => setShowTags(true)}>Tags</button>
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
          <FilterBar filter={filter} onChange={setFilter} platforms={platforms} tags={tags} />
          <GameList
            games={games}
            filter={filter}
            names={copyNames(platforms, accounts)}
            tagName={(id) => tags.find((t) => t.id === id)?.name}
            openId={openId}
            onToggle={(id) => setOpenId(openId === id ? undefined : id)}
            renderDetail={(g) => (
              <>
                <GameDetail game={g} platforms={platforms} accounts={accounts} onChange={replace} />
                <GameTags game={g} tags={tags} onChange={replace} onTagsChange={setTags} />
                <MergeGame
                  game={g}
                  games={games}
                  names={copyNames(platforms, accounts)}
                  tagName={(id) => tags.find((t) => t.id === id)?.name}
                  onMerged={(merged, goneId) => {
                    setGames((gs) => (gs ?? []).filter((x) => x.id !== goneId).map((x) => (x.id === merged.id ? merged : x)));
                    setOpenId(merged.id);
                  }}
                />
              </>
            )}
          />
        </>
      )}
    </main>
  );
}

/** Id-to-name lookups for the Copies shown in the list. */
function copyNames(platforms: Platform[], accounts: Account[]): CopyNames {
  return {
    platformName: (id) => platforms.find((p) => p.id === id)?.name ?? "Unknown Platform",
    accountName: (id) => {
      const a = accounts.find((x) => x.id === id);
      return a ? accountLabel(a) : "Unknown Account";
    },
  };
}
