import { useEffect, useState } from "react";
import { byName, filterFromUrl, filterToUrl, PLAY_STATUSES, type GameFilter, type Missing, type Ownership, type Place, type Platform, type PlayStatus, type Tag } from "@games/shared";

/** The list filter, kept in the page URL (replaceState, so typing doesn't pile up history entries). */
export function useUrlFilter(): [GameFilter, (filter: GameFilter) => void] {
  const [filter, setFilter] = useState(() => filterFromUrl(location.search));
  useEffect(() => {
    const search = filterToUrl(filter);
    const url = location.pathname + (search ? `?${search}` : "") + location.hash;
    if (url !== location.pathname + location.search + location.hash) history.replaceState(history.state, "", url);
  }, [filter]);
  return [filter, setFilter];
}

/**
 * Search box (names and Tag names) plus Place, Platform, Wishlist / Owned, Play status, Missing
 * info and Tag filters. All combine (AND); picked Tags must all be on a Game.
 */
export function FilterBar({ filter, onChange, platforms, places = [], tags = [] }: {
  filter: GameFilter;
  onChange: (filter: GameFilter) => void;
  platforms: Platform[];
  places?: Place[];
  tags?: Tag[];
}) {
  const set = (patch: Partial<GameFilter>) => onChange(drop({ ...filter, ...patch }));
  const selectedTags = filter.tagIds ?? [];
  const tagName = (id: string) => tags.find((t) => t.id === id)?.name ?? "Unknown Tag";
  const toggleTag = (id: string) =>
    set({ tagIds: selectedTags.includes(id) ? selectedTags.filter((x) => x !== id) : [...selectedTags, id] });
  const knownPlace = !filter.placeId || places.some((p) => p.id === filter.placeId);
  const knownPlatform = !filter.platformId || platforms.some((p) => p.id === filter.platformId);
  const anySet = filterToUrl(filter) !== "";

  return (
    <div className="filters">
      <input type="search" className="search" placeholder="Search names and Tags" aria-label="Search Games" value={filter.query ?? ""} onChange={(e) => set({ query: e.target.value })} />
      <div className="filter-row">
        {places.length > 0 && (
          <select aria-label="Place" value={filter.placeId ?? ""} onChange={(e) => set({ placeId: e.target.value })}>
            <option value="">Anywhere</option>
            {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            {!knownPlace && <option value={filter.placeId}>Unknown Place</option>}
          </select>
        )}
        <select aria-label="Platform" value={filter.platformId ?? ""} onChange={(e) => set({ platformId: e.target.value })}>
          <option value="">Any Platform</option>
          {[...platforms].sort(byName).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          {!knownPlatform && <option value={filter.platformId}>Unknown Platform</option>}
        </select>
        <select aria-label="Wishlist or Owned" value={filter.ownership ?? ""} onChange={(e) => set({ ownership: (e.target.value || undefined) as Ownership | undefined })}>
          <option value="">Not on Wishlist</option>
          <option value="owned">Owned</option>
          <option value="wishlist">Wishlist</option>
          <option value="all">All, Wishlist too</option>
        </select>
        <select aria-label="Play status" value={filter.playStatus ?? ""} onChange={(e) => set({ playStatus: (e.target.value || undefined) as PlayStatus | undefined })}>
          <option value="">Any Play status</option>
          {PLAY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Missing info" value={filter.missing ?? ""} onChange={(e) => set({ missing: (e.target.value || undefined) as Missing | undefined })}>
          <option value="">Any info</option>
          <option value="location">No location</option>
          <option value="tags">No Tags</option>
          <option value="any">Missing either</option>
        </select>
        {anySet && <button className="link" onClick={() => onChange({})}>Clear all</button>}
      </div>
      {tags.length > 0 && (
        <details className="tag-filter" open={selectedTags.length > 0 || undefined}>
          <summary>
            Tags{selectedTags.length > 0 && <span className="count"> · {selectedTags.length} picked, Games with all of them</span>}
          </summary>
          <div className="chips" role="group" aria-label="Tag filter">
            {tags.map((t) => {
              const on = selectedTags.includes(t.id);
              return (
                <button key={t.id} className={on ? "chip on" : "chip"} aria-pressed={on} onClick={() => toggleTag(t.id)}>{t.name}</button>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

/** Removes empty fields so an emptied control means "unset", same as the URL form. */
function drop(filter: GameFilter): GameFilter {
  return Object.fromEntries(
    Object.entries(filter).filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)),
  ) as GameFilter;
}
