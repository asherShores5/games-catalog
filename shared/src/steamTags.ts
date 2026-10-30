// Steam store Categories and Genres -> Tag names (see GLOSSARY.md: Tag, Import). Pure.
import { SIMPLE_TAGS, cleanTagName, sameTagName, type Tag } from "./tag";

/**
 * A Tag as an Import sees it. `aliases` are the Tag's former names and the names of Tags merged
 * into it (private, API only): a store name matching one lands on this Tag, so my renames and
 * merges stick across Imports.
 */
export interface ImportableTag extends Tag {
  aliases: string[];
}

/** What an Import does with one store Tag name. */
export type ImportTagMatch = { tagId: string } | { create: string } | { skip: true };

/**
 * Resolve one store Tag name (after storeTagNames) against my Tags:
 * 1. a Tag with that name now;
 * 2. else a Tag that had that name (renamed) or absorbed it (merged);
 * 3. else, if I deleted a Tag by that name (`droppedNames`), nothing: deleting it means I don't want it;
 * 4. else a new Tag with that name.
 * A current name wins over an alias, so a Tag I re-create by hand after a delete is used again.
 */
export function matchImportTag(name: string, tags: ImportableTag[], droppedNames: string[]): ImportTagMatch {
  const byName = tags.find((t) => sameTagName(t.name, name));
  if (byName) return { tagId: byName.id };
  const byAlias = tags.find((t) => t.aliases.some((a) => sameTagName(a, name)));
  if (byAlias) return { tagId: byAlias.id };
  if (droppedNames.some((n) => sameTagName(n, name))) return { skip: true };
  return { create: name };
}

/** `names` plus `more`, each name once (sameTagName). */
export function addTagNames(names: string[], ...more: string[]): string[] {
  const out = [...names];
  for (const n of more) if (!out.some((x) => sameTagName(x, n))) out.push(n);
  return out;
}

/**
 * Steam store Category or Genre -> the simple Tags it means. Anything not here (achievements,
 * controller brands, Remote Play, VR, Indie, Free To Play, software genres…) is dropped: it
 * doesn't help pick a game. Offline comes from playing alone or on one screen.
 */
export const STEAM_TAGS: Readonly<Record<string, readonly string[]>> = {
  "Single-player": ["Single-player", "Offline"],
  "Multi-player": ["Multiplayer"],
  "Co-op": ["Multiplayer", "Co-op"],
  "Online Co-op": ["Multiplayer", "Co-op", "Online"],
  "LAN Co-op": ["Multiplayer", "Co-op"],
  "Shared/Split Screen Co-op": ["Multiplayer", "Co-op", "Couch co-op", "Offline"],
  "Shared/Split Screen": ["Multiplayer", "Offline"],
  "PvP": ["Multiplayer", "Versus"],
  "Online PvP": ["Multiplayer", "Online", "Versus"],
  "LAN PvP": ["Multiplayer", "Versus"],
  "Shared/Split Screen PvP": ["Multiplayer", "Offline", "Versus"],
  "MMO": ["Multiplayer", "Online"],
  "Massively Multiplayer": ["Multiplayer", "Online"],
  "Cross-Platform Multiplayer": ["Multiplayer", "Online"],
  "Full controller support": ["Controller"],
  "Action": ["Action"],
  "Adventure": ["Adventure"],
  "RPG": ["RPG"],
  "Strategy": ["Strategy"],
  "Simulation": ["Simulation"],
  "Casual": ["Casual"],
  "Racing": ["Racing"],
  "Sports": ["Sports"],
};

/** The simple Tags one Steam app brings (STEAM_TAGS), each once, in SIMPLE_TAGS order. */
export function storeTagNames(categories: string[], genres: string[]): string[] {
  const wanted = new Set<string>();
  for (const raw of [...categories, ...genres]) {
    const name = cleanTagName(raw);
    if (!name) continue;
    const entry = Object.entries(STEAM_TAGS).find(([steam]) => sameTagName(steam, name));
    for (const tag of entry?.[1] ?? []) wanted.add(tag);
  }
  return SIMPLE_TAGS.filter((t) => wanted.has(t));
}
