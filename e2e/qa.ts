// QA against the live site, signed in with the session login.ts saved.
//   npm run qa          read-only: nothing is saved
//   npm run qa:write    also adds, renames, merges and deletes QA-… Platforms, Tags and Accounts,
//                       then sweeps any QA-… rows left behind. Real records are never touched.
// Screenshots go to e2e/out/ (gitignored). Exit code 1 if any check fails.
import { existsSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices, type Browser, type BrowserContext, type Page } from "playwright";
import { SITE, STATE_FILE, lockDown } from "./session";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
const WRITE = process.argv.includes("--write");
const QA = "QA-";
const run = `${QA}${Date.now().toString(36)}`;

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
const problems: string[] = [];
let shot = 0;

async function check(page: Page, name: string, fn: () => Promise<string | void>) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail || undefined });
  } catch (e) {
    const file = path.join(OUT, `fail-${String(++shot).padStart(2, "0")}.png`);
    await page.screenshot({ path: file, fullPage: true }).catch(() => {});
    results.push({ name, ok: false, detail: `${(e as Error).message.split("\n")[0]} (${path.basename(file)})` });
  }
}

const expect = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const snap = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });

/** Console errors, page crashes, failed requests and GraphQL errors, from every page. */
function watch(page: Page, label: string) {
  page.on("console", (m) => { if (m.type() === "error") problems.push(`${label} console: ${m.text().slice(0, 200)}`); });
  page.on("pageerror", (e) => problems.push(`${label} page error: ${e.message.slice(0, 200)}`));
  page.on("requestfailed", (r) => problems.push(`${label} request failed: ${r.method()} ${new URL(r.url()).host} ${r.failure()?.errorText}`));
  page.on("response", async (r) => {
    if (!r.url().includes("appsync-api")) return;
    if (r.status() >= 400) return void problems.push(`${label} GraphQL HTTP ${r.status()}`);
    const body = await r.json().catch(() => undefined);
    for (const err of body?.errors ?? []) problems.push(`${label} GraphQL error: ${String(err.message).slice(0, 200)}`);
  });
}

async function openSignedIn(browser: Browser, label: string, options: Parameters<Browser["newContext"]>[0] = {}) {
  const context = await browser.newContext({ ...options, storageState: STATE_FILE });
  const page = await context.newPage();
  watch(page, label);
  await page.goto(SITE);
  const heading = page.getByRole("heading", { name: "Games", exact: true });
  const login = page.getByPlaceholder("Password");
  await Promise.race([heading.waitFor({ timeout: 20_000 }), login.waitFor({ timeout: 20_000 })]);
  if (await login.isVisible()) throw new Error("Session expired: run `npm run login` (or games-qa-login) again");
  await page.locator("ul.games, p.empty").first().waitFor({ timeout: 20_000 });
  return { context, page };
}

const rows = (page: Page) => page.locator("ul.games > li");
const rowNames = (page: Page) => page.locator("ul.games > li > button.row > span:first-child").evaluateAll(
  (spans) => spans.map((s) => (s.childNodes[0]?.textContent ?? "").trim()),
);

async function search(page: Page, text: string) {
  await page.getByLabel("Search Games").fill(text);
  await page.waitForTimeout(150);
}

async function clearFilters(page: Page) {
  const clear = page.getByRole("button", { name: "Clear all" });
  if (await clear.isVisible()) await clear.click();
}

// ---------------------------------------------------------------------------------------------
async function readOnly(page: Page) {
  let total = 0;
  await check(page, "Games list loads", async () => {
    total = await rows(page).count();
    expect(total > 0, "no Games shown");
    await snap(page, "01-games");
    return `${total} Games`;
  });

  await check(page, "list is sorted by name", async () => {
    const names = await rowNames(page);
    const sorted = [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    expect(JSON.stringify(names) === JSON.stringify(sorted), `out of order near "${names.find((n, i) => n !== sorted[i])}"`);
  });

  for (const term of ["witcher", "hades"]) {
    await check(page, `search "${term}"`, async () => {
      await search(page, term);
      const names = await rowNames(page);
      expect(names.length > 0, "no matches");
      expect(names.every((n) => n.toLowerCase().includes(term)), `non-matching row: ${names.find((n) => !n.toLowerCase().includes(term))}`);
      await snap(page, `02-search-${term}`);
      return names.join(", ");
    });
  }

  await check(page, "search ignores case and spacing", async () => {
    await search(page, "  WITCHER ");
    const upper = await rows(page).count();
    await search(page, "witcher");
    expect(upper === (await rows(page).count()), "different results for '  WITCHER ' and 'witcher'");
  });

  await check(page, "search with no match says so", async () => {
    await search(page, "zzqqxx-no-such-game");
    await page.getByText("No Games match.").waitFor({ timeout: 3000 });
    await search(page, "");
    expect((await rows(page).count()) === total, "clearing search didn't bring every Game back");
  });

  await check(page, "Wishlist Games are hidden by default; All brings them back", async () => {
    const badges = await page.locator("ul.games > li .badges").allInnerTexts();
    expect(!badges.some((b) => b.includes("Wishlist")), "a Wishlist Game in the default list");
    await page.getByLabel("Wishlist or Owned").selectOption("all");
    const all = await rows(page).count();
    expect(all >= total, "All shows fewer Games");
    await clearFilters(page);
    return `${total} shown, ${all - total} Wishlist hidden`;
  });

  await check(page, "Wishlist filter", async () => {
    await page.getByLabel("Wishlist or Owned").selectOption("wishlist");
    const n = await rows(page).count();
    expect(n > 0, "no Wishlist Games");
    const badges = await page.locator("ul.games > li .badges").allInnerTexts();
    expect(badges.every((b) => b.includes("Wishlist")), "a row without the Wishlist badge");
    expect(badges.every((b) => !/Cop(y|ies)/.test(b)), "a Wishlist row that has Copies");
    await snap(page, "03-wishlist");
    return `${n} Games`;
  });

  await check(page, "filters live in the URL and survive a reload", async () => {
    expect(page.url().includes("?"), `URL has no filter: ${page.url()}`);
    await page.reload();
    await page.locator("ul.games, p.empty").first().waitFor();
    expect((await page.getByLabel("Wishlist or Owned").inputValue()) === "wishlist", "filter lost on reload");
    await clearFilters(page);
    expect(!page.url().includes("?"), "Clear all left the filter in the URL");
    expect((await rows(page).count()) === total, "Clear all didn't bring every Game back");
  });

  await check(page, "Owned filter", async () => {
    await page.getByLabel("Wishlist or Owned").selectOption("owned");
    const badges = await page.locator("ul.games > li .badges").allInnerTexts();
    expect(badges.length > 0, "no Owned Games");
    expect(badges.every((b) => /Cop(y|ies)/.test(b)), "an Owned row without a Copy count");
    await clearFilters(page);
    return `${badges.length} Games`;
  });

  await check(page, "Play status filter: Playing", async () => {
    await page.getByLabel("Play status").selectOption("Playing");
    const badges = await page.locator("ul.games > li .badges").allInnerTexts();
    expect(badges.every((b) => b.includes("Playing")), "a row that isn't Playing");
    await clearFilters(page);
    return `${badges.length} Games`;
  });

  await check(page, "Platform filter shows only Games with a Copy on it", async () => {
    const options = await page.getByLabel("Platform").first().locator("option").allInnerTexts();
    const platform = options.find((o) => o !== "Any Platform");
    expect(platform, "no Platforms to filter by");
    await page.getByLabel("Platform").first().selectOption({ label: platform! });
    const summaries = await page.locator("ul.games > li .copy-summary").allInnerTexts();
    expect(summaries.every((s) => s.includes(platform!)), `a row with no ${platform} Copy`);
    const n = await rows(page).count();
    await clearFilters(page);
    return `${platform}: ${n} Games`;
  });

  await check(page, "open and close a Game", async () => {
    const first = rows(page).first().locator("button.row");
    await first.click();
    expect((await first.getAttribute("aria-expanded")) === "true", "row didn't open");
    await page.locator(".detail").first().waitFor();
    await snap(page, "04-game-open");
    await first.click();
    expect((await first.getAttribute("aria-expanded")) === "false", "row didn't close");
  });

  await check(page, "an Unknown Copy shows 'location unknown' with Fill in", async () => {
    const row = rows(page).filter({ has: page.locator(".copy-summary", { hasText: "location unknown" }) }).first();
    if (!(await row.count())) return "no Unknown Copies (skipped)";
    await row.locator("button.row").click();
    await row.getByRole("button", { name: "Fill in" }).waitFor({ timeout: 5000 });
    await row.locator("button.row").click();
  });

  for (const screen of ["Platforms", "Accounts", "Tags"]) {
    await check(page, `${screen} screen opens and goes back`, async () => {
      await page.getByRole("button", { name: screen, exact: true }).click();
      await page.getByRole("heading", { name: screen }).waitFor();
      const n = await page.locator("ul.games > li").count();
      await snap(page, `05-${screen.toLowerCase()}`);
      await page.getByRole("button", { name: "Back to Games" }).click();
      await page.getByRole("heading", { name: "Games", exact: true }).waitFor();
      return `${n} rows`;
    });
  }

  await check(page, "installable: manifest and service worker", async () => {
    const manifest = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(manifest, "no manifest link");
    const res = await page.request.get(new URL(manifest!, SITE).href);
    expect(res.ok(), `manifest HTTP ${res.status()}`);
    const sw = await page.evaluate(async () => (await navigator.serviceWorker?.getRegistration())?.active?.state);
    expect(sw === "activated", `service worker: ${sw ?? "none"}`);
  });

  await check(page, "security headers", async () => {
    const res = await page.request.get(SITE);
    const h = res.headers();
    const missing = ["strict-transport-security", "content-security-policy", "x-content-type-options"].filter((k) => !h[k]);
    expect(missing.length === 0, `missing ${missing.join(", ")}`);
  });
}

async function mobile(browser: Browser) {
  const { context, page } = await openSignedIn(browser, "iPhone", { ...devices["iPhone 13"] });
  await check(page, "iPhone: no sideways scrolling", async () => {
    const wide = async () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect((await wide()) <= 0, `list is ${await wide()}px too wide`);
    await rows(page).first().locator("button.row").click();
    await page.locator(".detail").first().waitFor();
    expect((await wide()) <= 0, `open Game is ${await wide()}px too wide`);
    await snap(page, "06-iphone-game-open");
  });
  await check(page, "iPhone: buttons are big enough to tap", async () => {
    const small = await page.locator("button:visible").evaluateAll((bs) =>
      bs.map((b) => ({ t: (b.textContent ?? "").trim().slice(0, 20), h: b.getBoundingClientRect().height })).filter((b) => b.h < 24));
    expect(small.length === 0, `under 24px tall: ${small.slice(0, 5).map((b) => `"${b.t}" ${Math.round(b.h)}px`).join(", ")}`);
  });
  await context.close();
}

// ---------------------------------------------------------------------------------------------
async function goTo(page: Page, screen: string) {
  await page.getByRole("button", { name: screen, exact: true }).click();
  await page.getByRole("heading", { name: screen }).waitFor();
}
const back = async (page: Page) => {
  await page.getByRole("button", { name: "Back to Games" }).click();
  await page.getByRole("heading", { name: "Games", exact: true }).waitFor();
};
const listRow = (page: Page, name: string) => page.locator("ul.games > li.row").filter({ has: page.getByText(name, { exact: true }) });
const noError = async (page: Page) => {
  await page.waitForTimeout(300);
  const err = page.locator("main > p.error");
  if (await err.isVisible()) throw new Error(`app error: ${await err.innerText()}`);
};

async function addRow(page: Page, placeholder: string, name: string) {
  await page.getByPlaceholder(placeholder).fill(name);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await listRow(page, name).waitFor({ timeout: 10_000 });
  await noError(page);
}
async function renameRow(page: Page, from: string, to: string) {
  await listRow(page, from).getByRole("button", { name: "Rename" }).click();
  const input = page.locator("ul.games > li.row input");
  await input.fill(to);
  await page.locator("ul.games > li.row").getByRole("button", { name: "Save" }).click();
  await listRow(page, to).waitFor({ timeout: 10_000 });
  await noError(page);
}
async function deleteRow(page: Page, name: string) {
  await listRow(page, name).getByRole("button", { name: "Delete" }).click();
  await listRow(page, name).waitFor({ state: "detached", timeout: 10_000 });
  await noError(page);
}

async function writes(page: Page) {
  page.on("dialog", (d) => void d.accept()); // Tag delete asks to confirm

  await check(page, "Platforms: add, rename, delete", async () => {
    await goTo(page, "Platforms");
    await addRow(page, "Add a Platform", `${run}-plat`);
    await renameRow(page, `${run}-plat`, `${run}-plat2`);
    await page.reload(); await page.getByRole("button", { name: "Platforms", exact: true }).click();
    await listRow(page, `${run}-plat2`).waitFor({ timeout: 10_000 });
    await deleteRow(page, `${run}-plat2`);
    await back(page);
    return "rename survived a reload";
  });

  await check(page, "Platforms: duplicate name is refused", async () => {
    await goTo(page, "Platforms");
    const before = await page.locator("ul.games > li.row").count();
    const existing = (await page.locator("ul.games > li.row > span:first-child").first().innerText()).trim();
    await page.getByPlaceholder("Add a Platform").fill(` ${existing.toUpperCase()} `);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.locator("main > p.error").waitFor({ timeout: 10_000 });
    expect((await page.locator("ul.games > li.row").count()) === before, "duplicate added");
    await page.getByPlaceholder("Add a Platform").fill("");
    await back(page);
    return `" ${existing.toUpperCase()} " refused`;
  });

  await check(page, "Accounts: add, rename, delete", async () => {
    await goTo(page, "Accounts");
    await page.getByLabel("Store").selectOption("Other");
    await addRow(page, "Nickname, e.g. main", `${run}-acct`);
    await renameRow(page, `${run}-acct`, `${run}-acct2`);
    await deleteRow(page, `${run}-acct2`);
    await back(page);
  });

  await check(page, "Tags: add two, rename, merge, delete", async () => {
    await goTo(page, "Tags");
    await addRow(page, "Add a Tag", `${run}-a`);
    await addRow(page, "Add a Tag", `${run}-b`);
    await renameRow(page, `${run}-b`, `${run}-c`);
    await listRow(page, `${run}-a`).getByRole("button", { name: "Merge" }).click();
    await page.getByLabel("Merge into").selectOption({ label: `${run}-c` });
    await page.locator("ul.games > li.row form").getByRole("button", { name: "Merge" }).click();
    await listRow(page, `${run}-a`).waitFor({ state: "detached", timeout: 10_000 });
    await noError(page);
    await deleteRow(page, `${run}-c`);
    await back(page);
  });

  results.push({ name: "Games: add / Copies / Tags / merge", ok: true, detail: "SKIPPED: the app can't delete a Game, so a QA Game would stay in the catalog" });
}

/** Deletes every QA-… Platform, Account and Tag, including ones a crashed earlier run left. */
async function sweep(page: Page) {
  page.on("dialog", (d) => void d.accept());
  const left: string[] = [];
  for (const screen of ["Platforms", "Accounts", "Tags"]) {
    await goTo(page, screen);
    for (;;) {
      const row = page.locator("ul.games > li.row").filter({ hasText: new RegExp(`^${QA}`) }).first();
      if (!(await row.count())) break;
      const name = (await row.locator("span").first().innerText()).trim();
      await row.getByRole("button", { name: "Delete" }).click();
      await page.waitForTimeout(800);
      if (await page.locator("main > p.error").isVisible()) { left.push(`${screen}: ${name} (${await page.locator("main > p.error").innerText()})`); break; }
      results.push({ name: `swept leftover ${screen}: ${name}`, ok: true });
    }
    await back(page);
  }
  const games = await page.locator("ul.games > li > button.row").filter({ hasText: new RegExp(`^${QA}`) }).count();
  if (games) left.push(`${games} QA Games (no delete in the app)`);
  results.push({ name: "nothing QA-… left behind", ok: left.length === 0, detail: left.join("; ") || undefined });
}

// ---------------------------------------------------------------------------------------------
if (!existsSync(STATE_FILE)) {
  console.error("No saved session. Run `npm run login` (or games-qa-login) first.");
  process.exit(2);
}
lockDown();
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
let context: BrowserContext | undefined;
try {
  const opened = await openSignedIn(browser, "desktop", { viewport: { width: 1280, height: 900 } });
  context = opened.context;
  await readOnly(opened.page);
  await mobile(browser);
  if (WRITE) {
    await writes(opened.page);
    await sweep(opened.page);
  }
  // Keep the session file current: the app rotates the refresh token.
  await context.storageState({ path: STATE_FILE });
  lockDown();
} catch (e) {
  results.push({ name: "run", ok: false, detail: (e as Error).message });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `: ${r.detail}` : ""}`);
const uniqueProblems = [...new Set(problems)];
if (uniqueProblems.length) {
  console.log(`\nBrowser problems (${uniqueProblems.length}):`);
  for (const p of uniqueProblems.slice(0, 20)) console.log(`  ${p}`);
}
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed${WRITE ? "" : " (read-only)"}. Screenshots: ${OUT}`);
process.exit(failed.length || uniqueProblems.length ? 1 : 0);
