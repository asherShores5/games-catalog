// The guest demo's sample library. Game names come from the Seed list already public in this repo
// (api/seed/), plus a few extras; every Copy, Account, Place, Tag link and Play status is invented,
// so nothing is read from the live catalog.
// Chosen so every filter has something to find (Wishlist, each Play status, Missing info, Places).
import { SIMPLE_TAGS, byName, type Account, type Copy, type Format, type Game, type Place, type Platform, type PlayStatus, type Tag } from "@games/shared";

export interface DemoLibrary {
  games: Game[];
  platforms: Platform[];
  accounts: Account[];
  places: Place[];
  tags: Tag[];
}

const platforms: Platform[] = [
  { id: "pc", name: "PC" },
  { id: "ps5", name: "PS5" },
  { id: "switch", name: "Switch" },
  { id: "deck", name: "Steam Deck" },
  { id: "xsx", name: "Xbox Series X" },
];

const accounts: Account[] = [
  { id: "steam", store: "Steam", nickname: "demo", hasSteamId: false },
  { id: "psn", store: "PSN", nickname: "demo", hasSteamId: false },
  { id: "eshop", store: "Nintendo", nickname: "demo", hasSteamId: false },
  { id: "xbox", store: "Xbox", nickname: "demo", hasSteamId: false },
];

const places: Place[] = [
  { id: "couch", name: "Couch", platformIds: ["ps5", "switch", "xsx"] },
  { id: "desk", name: "Desk", platformIds: ["pc"] },
  { id: "travel", name: "Travel", platformIds: ["switch", "deck"] },
];

const tagId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const tags: Tag[] = SIMPLE_TAGS.map((name) => ({ id: tagId(name), name }));

const T0 = Date.UTC(2026, 9, 1);
let nextId = 0;

type CopySpec = [platformId: string, format: Format, edition?: string] | "unknown";
const ACCOUNT_FOR: Record<string, string> = { pc: "steam", deck: "steam", ps5: "psn", switch: "eshop", xsx: "xbox" };

function copy(spec: CopySpec): Copy {
  const id = `c${++nextId}`;
  if (spec === "unknown") return { id, createdAt: T0 };
  const [platformId, format, edition] = spec;
  return { id, platformId, format, accountId: format === "Digital" ? ACCOUNT_FOR[platformId] : undefined, edition, createdAt: T0 };
}

function game(name: string, copies: CopySpec[], o: { status?: PlayStatus; wish?: boolean; tags?: string[]; steamAppId?: number } = {}): Game {
  const cs = copies.map(copy);
  return {
    id: `g${++nextId}`,
    name,
    copies: cs,
    owned: cs.length > 0,
    wishlist: cs.length === 0 && (o.wish ?? false),
    playStatus: o.status ?? null,
    steamAppId: o.steamAppId,
    // First Tag as if an Import brought it, the rest added by hand.
    tags: (o.tags ?? []).map((t, i) => ({ tagId: tagId(t), source: i === 0 && o.steamAppId ? "Import" : "Manual" })),
    createdAt: T0,
    updatedAt: T0,
  };
}

const PC: CopySpec = ["pc", "Digital"];

const games: Game[] = [
  game("Stardew Valley", [PC, ["switch", "Physical"]], { status: "Playing", steamAppId: 413150, tags: ["Simulation", "Co-op", "Couch co-op", "Casual", "Single-player"] }),
  game("Schedule 1", [PC], { status: "Playing", steamAppId: 3164500, tags: ["Simulation", "Co-op", "Online"] }),
  game("Stray", [["ps5", "Digital"]], { status: "Finished", tags: ["Adventure", "Single-player", "Controller"] }),
  game("Elden Ring", [["ps5", "Physical", "Launch Edition"], PC], { status: "Backlog", steamAppId: 1245620, tags: ["RPG", "Action", "Single-player", "Online"] }),
  game("Hades", [PC, ["switch", "Physical"]], { status: "Finished", steamAppId: 1145360, tags: ["Action", "Single-player", "Controller"] }),
  game("Kingdom Come: Deliverance", [PC], { status: "Backlog", steamAppId: 379430, tags: ["RPG", "Single-player"] }),
  game("Cry of Fear", ["unknown"]),
  game("Valheim", [PC], { steamAppId: 892970, tags: ["Co-op", "Online", "Adventure"] }),
  game("Star Wars Jedi: Survivor", [["xsx", "Physical"]], { status: "Backlog", tags: ["Action", "Adventure", "Single-player"] }),
  game("Mirror's Edge", [["pc", "Digital"]], { status: "Finished", steamAppId: 17410, tags: ["Action", "Single-player"] }),
  game("Subnautica", [PC, ["deck", "Digital"]], { status: "Finished", steamAppId: 264710, tags: ["Adventure", "Single-player"] }),
  game("Half-Life 2", [["pc", "Digital", "Episodes bundle"]], { status: "Finished", steamAppId: 220, tags: ["Action", "Single-player"] }),
  game("Dark Souls 3", ["unknown"], { tags: ["RPG", "Action"] }),
  game("Bendy and the Ink Machine", [PC]),
  game("Batman: Arkham", [["pc", "Digital", "Collection"]], { status: "Backlog", tags: ["Action", "Single-player"] }),
  game("Hitman: World of Assassination", [PC], { steamAppId: 1659040, tags: ["Action", "Single-player"] }),
  game("Middle-earth: Shadow of War", ["unknown"]),
  game("Tomb Raider", [PC, ["ps5", "Digital", "Definitive Edition"]], { status: "Finished", tags: ["Action", "Adventure", "Single-player"] }),
  game("The Witcher 3", [["pc", "Digital", "Game of the Year"], ["switch", "Physical", "Complete"]], { status: "Playing", tags: ["RPG", "Single-player", "Adventure"] }),
  game("Clair Obscur: Expedition 33", [], { wish: true, tags: ["RPG", "Single-player"] }),
  game("Donkey Kong Bananza", [], { wish: true, tags: ["Adventure", "Couch co-op"] }),
  game("Hades 2", [], { wish: true, tags: ["Action"] }),
  game("Hollow Knight: Silksong", [], { wish: true }),
  game("Kingdom Come: Deliverance 2", [], { wish: true, tags: ["RPG"] }),
  game("Black Myth: Wukong", [], { wish: true, tags: ["Action"] }),
  game("Balatro", [["switch", "Digital"], ["deck", "Digital"]], { status: "Playing", tags: ["Strategy", "Casual", "Single-player"] }),
  game("Baldur's Gate 3", [PC], { status: "Backlog", steamAppId: 1086940, tags: ["RPG", "Co-op", "Single-player", "Strategy"] }),
  game("Mario Kart 8 Deluxe", [["switch", "Physical"]], { tags: ["Racing", "Couch co-op", "Versus", "Multiplayer"] }),
  game("It Takes Two", [["ps5", "Digital"]], { status: "Finished", tags: ["Co-op", "Couch co-op", "Adventure"] }),
].sort(byName);

/** A fresh copy each time, so nothing the UI does to one answer leaks into the next. */
export const demoLibrary = (): DemoLibrary => structuredClone({ games, platforms, accounts, places, tags });
