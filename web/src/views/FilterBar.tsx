import { useEffect, useState } from "react";
import { byName, filterFromUrl, filterToUrl, PLAY_STATUSES, type GameFilter, type Ownership, type Platform, type PlayStatus } from "@games/shared";

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

/** Search box plus Platform, Wishlist / Owned and Play status filters. All combine (AND). */
export function FilterBar({ filter, onChange, platforms }: {
  filter: GameFilter;
  onChange: (filter: GameFilter) => void;
  platforms: Platform[];
}) {
  const set = (patch: Partial<GameFilter>) => onChange(drop({ ...filter, ...patch }));
  const knownPlatform = !filter.platformId || platforms.some((p) => p.id === filter.platformId);
  const anySet = filterToUrl(filter) !== "";

  return (
    <div className="filters">
      <input type="search" className="search" placeholder="Search Games" aria-label="Search Games" value={filter.query ?? ""} onChange={(e) => set({ query: e.target.value })} />
      <div className="filter-row">
        <select aria-label="Platform" value={filter.platformId ?? ""} onChange={(e) => set({ platformId: e.target.value })}>
          <option value="">Any Platform</option>
          {[...platforms].sort(byName).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          {!knownPlatform && <option value={filter.platformId}>Unknown Platform</option>}
        </select>
        <select aria-label="Wishlist or Owned" value={filter.ownership ?? ""} onChange={(e) => set({ ownership: (e.target.value || undefined) as Ownership | undefined })}>
          <option value="">Owned or not</option>
          <option value="owned">Owned</option>
          <option value="wishlist">Wishlist</option>
        </select>
        <select aria-label="Play status" value={filter.playStatus ?? ""} onChange={(e) => set({ playStatus: (e.target.value || undefined) as PlayStatus | undefined })}>
          <option value="">Any Play status</option>
          {PLAY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {anySet && <button className="link" onClick={() => onChange({})}>Clear all</button>}
      </div>
    </div>
  );
}

/** Removes empty fields so an emptied control means "unset", same as the URL form. */
function drop(filter: GameFilter): GameFilter {
  return Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined && v !== "")) as GameFilter;
}
