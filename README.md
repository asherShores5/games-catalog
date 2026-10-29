# Games Catalog

A personal master list of every game I own across Stores, Accounts, Platforms and discs.
Search by name to find where I own something; filter by Tags like co-op, narrative or
open-world. Steam libraries import automatically; everything else is entered by hand.

Status: walking skeleton (add and list Games). See `docs/specs/2026-10-29-v1.md` and `GLOSSARY.md`.

## Layout

npm workspaces: `shared` (types and rules used by both sides), `api` (AppSync Lambda resolvers),
`web` (Vite + React), `infra` (CDK). The GraphQL schema is `schema/schema.graphql`.

## Develop

Node 22.

```sh
npm install
npm test            # vitest in shared, api and web
npm run typecheck   # tsc in every workspace
npm run synth       # cdk synth into infra/cdk.out (no deploy, no credentials needed)
```

API tests call the real Lambda handler against an in-memory DynamoDB
(`api/src/testing/harness.ts` and `fakeDynamo.ts`).

To run the web app against a deployed stack: copy `web/public/config.example.json` to
`web/public/config.json` (gitignored), fill in the stack outputs, then `npm run dev -w web`.

No AWS account IDs, hosted zone IDs, Steam IDs or keys go in tracked files. The account comes
from the deploying credentials; the region defaults to us-west-1 (`-c region=...` to override).

License: MIT.
