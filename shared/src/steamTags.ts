// Steam store Categories and Genres -> Tag names (see GLOSSARY.md: Tag, Import). Pure.
import { cleanTagName, sameTagName } from "./tag";

/**
 * Steam names that land on one of my common Tags. Matched like Tag names (sameTagName), and the
 * target is matched against my Tags the same way, so a renamed "Co-op" still catches "co-op".
 */
export const STEAM_TAG_MAP: Readonly<Record<string, string>> = {
  "Single-player": "single-player",
  "Co-op": "co-op",
  "Online Co-op": "co-op",
  "LAN Co-op": "co-op",
  "Shared/Split Screen Co-op": "co-op",
  "PvP": "versus",
  "Online PvP": "versus",
  "LAN PvP": "versus",
  "Shared/Split Screen PvP": "versus",
};

/**
 * Store Categories that describe the Steam store or client, not the game. They'd flood the Tag
 * list without helping me pick what to play, so an Import skips them. Everything else Steam
 * sends (Multi-player, MMO, VR Only, every Genre…) becomes a Tag as-is.
 */
export const STEAM_IGNORED_CATEGORIES: readonly string[] = [
  "Steam Achievements", "Steam Trading Cards", "Steam Cloud", "Steam Leaderboards", "Steam Workshop",
  "Steam Turn Notifications", "Steam Timeline", "Steam is learning about this game", "SteamVR Collectibles",
  "Steam China Workshop", "Stats", "Full controller support", "Partial Controller Support",
  "Tracked Controller Support", "Family Sharing", "In-App Purchases", "Downloadable Content",
  "Remote Play on Phone", "Remote Play on Tablet", "Remote Play on TV", "Remote Play Together",
  "Valve Anti-Cheat enabled", "Includes Source SDK", "Captions available", "Commentary available",
  "HDR available", "Profile Features Limited", "Additional High-Quality Audio",
  // Steam's accessibility features.
  "Adjustable Text Size", "Adjustable Difficulty", "Color Alternatives", "Camera Comfort",
  "Custom Volume Controls", "Playable without Timed Input", "Stereo Sound", "Surround Sound",
  "Save Anytime", "Subtitle Options", "Mouse Only Option", "Touch Only Option", "Keyboard Only Option",
  "Narrated Game Menus", "Chat Speech-to-text", "Chat Text-to-speech",
];

/**
 * The Tag names one Steam app brings: Categories then Genres, mapped (STEAM_TAG_MAP), store
 * features dropped, blanks and names too long for a Tag skipped, each name once.
 */
export function storeTagNames(categories: string[], genres: string[]): string[] {
  const out: string[] = [];
  for (const raw of [...categories, ...genres]) {
    const name = cleanTagName(raw);
    if (!name || STEAM_IGNORED_CATEGORIES.some((n) => sameTagName(n, name))) continue;
    const mapped = Object.entries(STEAM_TAG_MAP).find(([steam]) => sameTagName(steam, name))?.[1] ?? name;
    if (!out.some((n) => sameTagName(n, mapped))) out.push(mapped);
  }
  return out;
}
