// Signs in to the live site once and saves the browser session for qa.ts. Asks for the password
// with echo off; it goes to the sign-in form and nowhere else.
//   npm run login            (or: games-qa-login)
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { chromium } from "playwright";
import { SITE, STATE_FILE, ensureStateDir, lockDown } from "./session";

function ask(question: string, hidden: boolean): Promise<string> {
  let muted = false;
  const out = new Writable({ write(chunk, _enc, done) { if (!muted) process.stdout.write(chunk); done(); } });
  const rl = createInterface({ input: process.stdin, output: out, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(answer); });
    muted = hidden;
  });
}

const username = (await ask("Username [asher]: ", false)).trim() || "asher";
const password = await ask("Password: ", true);
if (!password) throw new Error("No password entered");

const browser = await chromium.launch();
const page = await browser.newPage();
try {
  await page.goto(SITE);
  await page.getByPlaceholder("Username").fill(username);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  const signedIn = page.getByRole("heading", { name: "Games", exact: true });
  const failed = page.locator(".login .error");
  await Promise.race([signedIn.waitFor({ timeout: 20_000 }), failed.waitFor({ timeout: 20_000 })]);
  if (await failed.isVisible()) throw new Error(`Sign-in failed: ${await failed.innerText()}`);
  const saved = await page.evaluate(() => localStorage.getItem("games.tokens") !== null);
  if (!saved) throw new Error("Signed-in screen showed but no tokens were stored; nothing saved");
  ensureStateDir();
  await page.context().storageState({ path: STATE_FILE });
  lockDown();
  console.log(`Signed in as ${username}. Session saved to ${STATE_FILE} (600).`);
} finally {
  await browser.close();
}
