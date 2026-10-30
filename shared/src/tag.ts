// Tags and Game–Tag links (see GLOSSARY.md: Tag, Tag source). Pure: the API and web both use these.

/** A descriptor of a Game. One shared list; Games link to it by id, so a rename follows. */
export interface Tag {
  id: string;
  name: string;
}

export const TAG_NAME_MAX = 50;

/** Tags every new catalog starts with. Editable afterwards like any other. */
/**
 * The Tag list: a few broad Tags that answer "what can I play tonight, alone or with my wife?".
 * How it plays first, then genre. Every account starts with these; Imports produce only these.
 */
export const SIMPLE_TAGS: readonly string[] = [
  "Single-player", "Multiplayer", "Co-op", "Couch co-op", "Online", "Offline", "Versus", "Controller",
  "Action", "Adventure", "RPG", "Strategy", "Simulation", "Casual", "Racing", "Sports",
];
export const SEED_TAGS = SIMPLE_TAGS;

/** A Tag name as stored: trimmed, 1..TAG_NAME_MAX characters. Undefined when the input can't be one. */
export function cleanTagName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const name = raw.trim();
  return name.length > 0 && name.length <= TAG_NAME_MAX ? name : undefined;
}

/** True when two Tag names would read as the same Tag (case- and accent-insensitive). */
export function sameTagName(a: string, b: string): boolean {
  return a.trim().localeCompare(b.trim(), "en", { sensitivity: "base" }) === 0;
}

/**
 * Where a Game's Tag came from: Manual (I added it) or Import (a Store Import added it).
 * Manual beats Import: an Import never downgrades or removes a Manual Tag.
 */
export type TagSource = "Manual" | "Import";
export const TAG_SOURCES: readonly TagSource[] = ["Manual", "Import"];

/** One Game–Tag link. */
export interface GameTag {
  tagId: string;
  source: TagSource;
}

/**
 * A Game's Tag state as stored on the Game: its links, plus the Tags I removed from it, so a
 * later Import doesn't add them back. A Tag is never both linked and removed.
 */
export interface GameTags {
  tags: GameTag[];
  removedTagIds: string[];
}

/** One link per Tag (Manual wins), first-seen order; removals of linked Tags are dropped. */
function normalize(tags: GameTag[], removedTagIds: string[]): GameTags {
  const byId = new Map<string, GameTag>();
  for (const t of tags) {
    const seen = byId.get(t.tagId);
    if (!seen || t.source === "Manual") byId.set(t.tagId, seen ? { ...seen, source: "Manual" } : t);
  }
  const removed = [...new Set(removedTagIds)].filter((id) => !byId.has(id));
  return { tags: [...byId.values()], removedTagIds: removed };
}

/** I add a Tag by hand: it becomes Manual (even if an Import brought it) and any removal is forgotten. */
export function addManualTag(g: GameTags, tagId: string): GameTags {
  return normalize([...g.tags, { tagId, source: "Manual" }], g.removedTagIds);
}

/** I remove a Tag: the link goes and the removal is remembered for later Imports. */
export function removeGameTag(g: GameTags, tagId: string): GameTags {
  return normalize(g.tags.filter((t) => t.tagId !== tagId), [...g.removedTagIds, tagId]);
}

/** An Import brings these Tags: adds Import links, skipping Tags already linked or removed by me. */
export function importTags(g: GameTags, tagIds: string[]): GameTags {
  const skip = new Set([...g.tags.map((t) => t.tagId), ...g.removedTagIds]);
  return normalize([...g.tags, ...tagIds.filter((id) => !skip.has(id)).map((tagId) => ({ tagId, source: "Import" as const }))], g.removedTagIds);
}

/** Two Games' Tags as one (Merge Games): every Tag once, Manual over Import; a link beats a removal. */
export function combineGameTags(a: GameTags, b: GameTags): GameTags {
  return normalize([...a.tags, ...b.tags], [...a.removedTagIds, ...b.removedTagIds]);
}

/** Tag `fromId` was merged into `intoId`: re-point its link and removal, deduping. */
export function moveTag(g: GameTags, fromId: string, intoId: string): GameTags {
  const swap = (id: string) => (id === fromId ? intoId : id);
  return normalize(g.tags.map((t) => ({ ...t, tagId: swap(t.tagId) })), g.removedTagIds.map(swap));
}

/** Tag `tagId` was deleted: its link and its removal record both go. */
export function dropTag(g: GameTags, tagId: string): GameTags {
  return { tags: g.tags.filter((t) => t.tagId !== tagId), removedTagIds: g.removedTagIds.filter((id) => id !== tagId) };
}

/** True when the Game touches this Tag at all (linked or removed). */
export function mentionsTag(g: GameTags, tagId: string): boolean {
  return g.tags.some((t) => t.tagId === tagId) || g.removedTagIds.includes(tagId);
}
