// One-time Seed: load the Notion "Gaming catalog" rows (api/seed/notion-gaming-catalog.json) into
// one owner's catalog. Runs the API's own seedGames() in-process against a real table, so every
// row goes through the same validation and record layout as the app. Idempotent: rows whose Game
// is already in the catalog (same name ignoring case/punctuation) are skipped.
//
// Dry run (default, writes nothing):
//   npx tsx api/scripts/seed.ts --table <TableName output> --owner <Cognito sub> --region <region>
// Write for real (ticket 12, only after Asher's go):
//   npx tsx api/scripts/seed.ts --table <TableName output> --owner <Cognito sub> --region <region> --apply
//
// Uses the default AWS credential chain. Never pass a table or owner you didn't look up just now.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    table: { type: "string" },
    owner: { type: "string" },
    region: { type: "string" },
    data: { type: "string" },
    apply: { type: "boolean", default: false },
  },
});

if (!values.table || !values.owner || !values.region) {
  console.error("usage: seed.ts --table <TableName> --owner <Cognito sub> --region <region> [--apply] [--data <file.json>]");
  process.exit(2);
}

// handler.ts reads these at import time.
process.env.TABLE_NAME = values.table;
process.env.AWS_REGION = values.region;
const { seedGames } = await import("../src/handler");

const file = values.data ?? new URL("../seed/notion-gaming-catalog.json", import.meta.url);
const rows = JSON.parse(readFileSync(file, "utf8"));
const dryRun = !values.apply;

const { added, present } = await seedGames(values.owner, rows, { dryRun });

console.log(`${dryRun ? "DRY RUN (nothing written; add --apply to write)" : "Seeded"}: table ${values.table}, region ${values.region}`);
console.log(`${dryRun ? "Would add" : "Added"} ${added.length}: ${added.join(", ") || "-"}`);
console.log(`Already present ${present.length}: ${present.join(", ") || "-"}`);
