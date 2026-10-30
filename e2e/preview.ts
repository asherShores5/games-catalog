// Screenshots of the built web app (web/dist) with a fake backend, for design work. No network:
// config, Cognito and AppSync are all answered here, so nothing touches the live site.
//   npm run build:web (repo root), then: cd e2e && npm run preview
// Writes e2e/out/preview-*.png: login, list, an open Game, filters, Tags; desktop and iPhone,
// light and dark.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices, type BrowserContextOptions, type Page } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, "..", "web", "dist");
const OUT = path.join(HERE, "out");
const ORIGIN = "https://games.test";
const GRAPHQL = "https://preview.appsync-api.us-west-1.amazonaws.com/graphql";
const TYPES: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json",
};

const platforms = [
  { id: "pc", name: "PC" }, { id: "ps5", name: "PS5" }, { id: "switch", name: "Switch" }, { id: "xsx", name: "Xbox Series X" },
];
const accounts = [{ id: "steam", store: "Steam", nickname: "main", hasSteamId: true }, { id: "psn", store: "PSN", nickname: "main", hasSteamId: false }];
const tags = [
  { id: "coop", name: "Co-op" }, { id: "single", name: "Single-player" }, { id: "rpg", name: "RPG" },
  { id: "roguelike", name: "Roguelike" }, { id: "open", name: "Open world" }, { id: "remote", name: "Remote Play Together" },
];
let n = 0;
const copy = (platformId?: string, format?: "Digital" | "Physical", accountId?: string, edition?: string) =>
  ({ id: `c${++n}`, platformId: platformId ?? null, format: format ?? null, accountId: accountId ?? null, edition: edition ?? null, createdAt: 1 });
const game = (name: string, copies: ReturnType<typeof copy>[], o: { wishlist?: boolean; playStatus?: string; tags?: string[] } = {}) => ({
  id: `g${++n}`, name, copies, owned: copies.length > 0, wishlist: o.wishlist ?? false, playStatus: o.playStatus ?? null,
  tags: (o.tags ?? []).map((tagId, i) => ({ tagId, source: i === 0 ? "Import" : "Manual" })), steamAppId: null, createdAt: 1, updatedAt: 1,
});
const games = [
  game("Baldur's Gate 3", [copy("pc", "Digital", "steam")], { playStatus: "Playing", tags: ["rpg", "coop", "single"] }),
  game("Celeste", [copy("switch", "Physical")], { playStatus: "Finished", tags: ["single"] }),
  game("Deep Rock Galactic", [copy("pc", "Digital", "steam")], { tags: ["coop", "remote"] }),
  game("Elden Ring", [copy("ps5", "Physical", undefined, "Launch Edition"), copy("pc", "Digital", "steam")], { playStatus: "Backlog", tags: ["open", "rpg", "single"] }),
  game("Hades", [copy("pc", "Digital", "steam"), copy("switch", "Physical")], { playStatus: "Finished", tags: ["roguelike", "single"] }),
  game("Hades II", [], { wishlist: true, tags: ["roguelike"] }),
  game("Hollow Knight: Silksong", [], { wishlist: true }),
  game("It Takes Two", [copy("ps5", "Digital", "psn")], { tags: ["coop"] }),
  game("Mario Kart 8 Deluxe", [copy()]),
  game("Stardew Valley", [copy("pc", "Digital", "steam"), copy("switch", "Physical")], { playStatus: "Playing", tags: ["coop", "single"] }),
  game("The Witcher 3: Wild Hunt", [copy("pc", "Digital", "steam", "Game of the Year")], { playStatus: "Backlog", tags: ["open", "rpg", "single"] }),
  game("Valheim", [copy("pc", "Digital", "steam")], { tags: ["coop", "open"] }),
];

async function serve(page: Page, signedIn: boolean) {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/config.json") {
      return route.fulfill({ json: { region: "us-west-1", userPoolId: "us-west-1_preview", clientId: "preview", graphqlUrl: GRAPHQL } });
    }
    let file = path.join(DIST, decodeURIComponent(url.pathname));
    if (!file.startsWith(DIST) || !existsSync(file) || url.pathname === "/") file = path.join(DIST, "index.html");
    // No service worker in previews: it would cache the old CSS between runs.
    if (url.pathname.endsWith("sw.js")) return route.fulfill({ status: 404, body: "" });
    // Same CSP as CloudFront serves (infra/lib/hosting.ts), so a violation shows up here first.
    const csp = ["default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:",
      `connect-src 'self' https://${new URL(GRAPHQL).host} https://cognito-idp.us-west-1.amazonaws.com`, "object-src 'none'",
      "form-action 'self'", "manifest-src 'self'", "worker-src 'self'", "frame-ancestors 'none'", "base-uri 'self'"].join("; ");
    return route.fulfill({ body: readFileSync(file), contentType: TYPES[path.extname(file)] ?? "application/octet-stream", headers: { "Content-Security-Policy": csp } });
  });
  await page.route(GRAPHQL, async (route) => {
    const { query } = route.request().postDataJSON() as { query: string };
    const data = query.includes("games {") ? { games } : query.includes("platforms {") ? { platforms }
      : query.includes("accounts {") ? { accounts } : query.includes("tags {") ? { tags } : {};
    return route.fulfill({ json: { data } });
  });
  await page.route("https://cognito-idp.us-west-1.amazonaws.com/", (route) => route.fulfill({ status: 400, json: { __type: "NotAuthorizedException", message: "Preview only" } }));
  if (signedIn) {
    await page.addInitScript(() => localStorage.setItem("games.tokens", JSON.stringify({
      idToken: "preview", accessToken: "preview", refreshToken: "preview", expiresAt: Date.now() + 3_600_000, username: "asher",
    })));
  }
}

async function shoot(context: BrowserContextOptions, label: string) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(context);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const snap = (name: string) => page.screenshot({ path: path.join(OUT, `preview-${label}-${name}.png`), fullPage: true });

  await serve(page, false);
  await page.goto(ORIGIN);
  await page.getByPlaceholder("Password").waitFor();
  await snap("1-login");
  await ctx.clearCookies();

  const signed = await ctx.newPage();
  signed.on("pageerror", (e) => errors.push(e.message));
  signed.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await serve(signed, true);
  await signed.goto(ORIGIN);
  await signed.locator("ul.games").waitFor();
  const snap2 = (name: string) => signed.screenshot({ path: path.join(OUT, `preview-${label}-${name}.png`), fullPage: true });
  await snap2("2-list");
  await signed.locator("ul.games > li").filter({ hasText: "Elden Ring" }).locator("button.row").click();
  await signed.locator(".detail").first().waitFor();
  await snap2("3-open");
  await signed.locator("ul.games > li").filter({ hasText: "Elden Ring" }).locator("button.row").click();
  await signed.getByLabel("Search Games").fill("ha");
  await signed.getByLabel("Add a Tag filter").selectOption({ label: "Roguelike" });
  await signed.getByLabel("Wishlist or Owned").selectOption("all");
  await snap2("4-filtered");
  await signed.getByRole("button", { name: "Tags", exact: true }).click();
  await signed.getByRole("heading", { name: "Tags" }).waitFor();
  await snap2("5-tags");
  await browser.close();
  if (errors.length) console.log(`${label} page errors:\n  ${errors.join("\n  ")}`);
}

if (!existsSync(path.join(DIST, "index.html"))) {
  console.error("No web/dist: run `npm run build:web` from the repo root first.");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
await shoot({ viewport: { width: 1100, height: 800 }, colorScheme: "light" }, "desktop-light");
await shoot({ ...devices["iPhone 13"], colorScheme: "light" }, "iphone-light");
await shoot({ ...devices["iPhone 13"], colorScheme: "dark" }, "iphone-dark");
console.log(`Screenshots in ${OUT}`);
