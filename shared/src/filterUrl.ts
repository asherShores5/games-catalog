// The Game list filter as URL query params, so a refresh or a shared link keeps it. Pure.
import { OWNERSHIPS, type GameFilter, type Ownership } from "./search";
import { PLAY_STATUSES, type PlayStatus } from "./types";

/** Query string for the filter, without the leading "?" ("" when nothing is set). Params: q, platform, show, status, tag (repeated). */
export function filterToUrl(filter: GameFilter): string {
  const params = new URLSearchParams();
  if (filter.query) params.set("q", filter.query);
  if (filter.platformId) params.set("platform", filter.platformId);
  if (filter.ownership) params.set("show", filter.ownership);
  if (filter.playStatus) params.set("status", filter.playStatus);
  for (const id of filter.tagIds ?? []) params.append("tag", id);
  return params.toString();
}

/** The filter in a query string (with or without "?"). Empty or unknown values are dropped, never errors. */
export function filterFromUrl(search: string): GameFilter {
  const params = new URLSearchParams(search);
  const filter: GameFilter = {};
  const query = params.get("q");
  if (query) filter.query = query;
  const platformId = params.get("platform");
  if (platformId) filter.platformId = platformId;
  const show = params.get("show");
  if (OWNERSHIPS.includes(show as Ownership)) filter.ownership = show as Ownership;
  const status = params.get("status");
  if (PLAY_STATUSES.includes(status as PlayStatus)) filter.playStatus = status as PlayStatus;
  const tagIds = [...new Set(params.getAll("tag").filter(Boolean))];
  if (tagIds.length > 0) filter.tagIds = tagIds;
  return filter;
}
