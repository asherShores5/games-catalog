// Where the signed-in browser session lives: outside the repo, readable only by me. It holds
// Cognito tokens (the refresh token lasts 30 days), never the password.
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";

export const SITE = process.env.GAMES_QA_SITE ?? "https://games.ashershores.com";
export const STATE_DIR = path.join(homedir(), ".config", "games-qa");
export const STATE_FILE = path.join(STATE_DIR, "state.json");

export function ensureStateDir() {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  chmodSync(STATE_DIR, 0o700);
}

export function lockDown() {
  if (existsSync(STATE_FILE)) chmodSync(STATE_FILE, 0o600);
}
