import { useEffect, useState } from "react";
import { accountLabel, byName, cleanGameName, withoutUnknownTags, type Account, type CopyNames, type Game, type Place, type Platform } from "@games/shared";
import { addGame, listAccounts, listGames, listPlaces, listPlatforms } from "../api";
import { signOut } from "../auth";
import { exitDemo } from "../demo";
import { ReadOnlyGame } from "./ReadOnlyGame";
import { Accounts } from "./Accounts";
import { FilterBar, useUrlFilter } from "./FilterBar";
import { GameDetail } from "./GameDetail";
import { GameList } from "./GameList";
import { Places } from "./Places";
import { Platforms } from "./Platforms";
import type { Tag } from "@games/shared";
import { listTags } from "../api";
import { GameTags } from "./GameTags";
import { DeleteGame } from "./DeleteGame";
import { MergeGame } from "./MergeGame";
import { Tags } from "./Tags";

/**
 * My Games: add one by name, search and filter the list, open one to manage its Copies.
 * In the guest demo (`demo`), the same list over a sample library, browse-only: no adding,
 * editing, Import or list management.
 */
export function Games({ demo = false }: { demo?: boolean }) {
  const [games, setGames] = useState<Game[]>();
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [openId, setOpenId] = useState<string>();
  const [showPlatforms, setShowPlatforms] = useState(false);
  const [places, setPlaces] = useState<Place[]>([]);
  const [showPlaces, setShowPlaces] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showAccounts, setShowAccounts] = useState(false);
  const [filter, setFilter] = useUrlFilter();
  const [tags, setTags] = useState<Tag[]>([]);
  const [showTags, setShowTags] = useState(false);

  const [tagsLoaded, setTagsLoaded] = useState(false);

  useEffect(() => {
    listTags().then(
      (ts) => {
        setTags(ts);
        setTagsLoaded(true);
      },
      (e) => setError(String(e.message ?? e)),
    );
  }, []);

  // Once Tags are known, drop Tag ids from the filter (and so the URL) that no longer exist.
  useEffect(() => {
    if (!tagsLoaded) return;
    const pruned = withoutUnknownTags(filter, tags);
    if (pruned !== filter) setFilter(pruned);
  }, [tagsLoaded, tags, filter, setFilter]);

  useEffect(() => {
    listGames().then(setGames, (e) => setError(String(e.message ?? e)));
    listPlatforms().then(setPlatforms, (e) => setError(String(e.message ?? e)));
    listAccounts().then(setAccounts, (e) => setError(String(e.message ?? e)));
    listPlaces().then(setPlaces, (e) => setError(String(e.message ?? e)));
  }, []);

  const names = copyNames(platforms, accounts);
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

  if (showPlaces) {
    return <Places places={places} platforms={platforms} onChange={setPlaces} onClose={() => setShowPlaces(false)} />;
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
        {demo ? (
          <nav>
            <button className="link" onClick={exitDemo}>Exit demo</button>
          </nav>
        ) : (
        <nav>
          <button className="link" onClick={() => setShowPlaces(true)}>Places</button>
          <button className="link" onClick={() => setShowPlatforms(true)}>Platforms</button>
          <button className="link" onClick={() => setShowAccounts(true)}>Accounts</button>
          <button className="link" onClick={() => setShowTags(true)}>Tags</button>
          <button className="link" onClick={() => void signOut()}>Sign out</button>
        </nav>
        )}
      </header>
      {demo ? (
        <p className="demo-banner">
          <strong>Demo</strong> · A sample library, read-only. Search, filter and open any Game to see its Copies.
        </p>
      ) : (
        <form className="add" onSubmit={submit}>
          <input placeholder="Add a Game" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          <button className="primary" disabled={busy || !cleanGameName(name)}>Add</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      {!games ? (
        <p>Loading…</p>
      ) : (
        <>
          <FilterBar filter={filter} onChange={setFilter} platforms={platforms} places={places} tags={tags} />
          <GameList
            games={games}
            filter={filter}
            lookups={{ places, tagName: (id) => tags.find((t) => t.id === id)?.name }}
            names={names}
            tagName={(id) => tags.find((t) => t.id === id)?.name}
            openId={openId}
            onToggle={(id) => setOpenId(openId === id ? undefined : id)}
            renderDetail={(g) => demo ? (
              <ReadOnlyGame game={g} names={names} />
            ) : (
              <>
                <GameDetail game={g} platforms={platforms} accounts={accounts} onChange={replace} />
                <GameTags game={g} tags={tags} onChange={replace} onTagsChange={setTags} />
                <MergeGame
                  game={g}
                  games={games}
                  names={names}
                  tagName={(id) => tags.find((t) => t.id === id)?.name}
                  onMerged={(merged, goneId) => {
                    setGames((gs) => (gs ?? []).filter((x) => x.id !== goneId).map((x) => (x.id === merged.id ? merged : x)));
                    setOpenId(merged.id);
                  }}
                />
                <DeleteGame
                  game={g}
                  onDeleted={(id) => {
                    setGames((gs) => (gs ?? []).filter((x) => x.id !== id));
                    setOpenId(undefined);
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
