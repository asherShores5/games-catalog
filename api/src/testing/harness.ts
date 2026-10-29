// API test harness: call the real Lambda handler as a signed-in caller against an in-memory table.
//
//   const h = harness();
//   beforeEach(() => h.reset());
//   await h.call(h.owner, "addGame", { name: "Hades" });
//   const games = await h.call(h.owner, "games");
//
// handler.ts reads TABLE_NAME at import time, so tests must import the handler through this
// module (never statically) for the env below to take effect.
import type { AppSyncIdentityCognito, AppSyncResolverEvent } from "aws-lambda";
import { FakeDocClient } from "./fakeDynamo";
import { FakeSteamLibrary } from "./fakeSteam";

/** A signed-in Cognito user. `userId` is the token's `sub`. */
export interface Caller {
  userId: string;
  username: string;
}

/** The catalog's owner (Asher), and a second user who must never see the owner's Games. */
export const owner: Caller = { userId: "sub-owner", username: "owner" };
export const stranger: Caller = { userId: "sub-stranger", username: "stranger" };

process.env.TABLE_NAME = "test-table";

const { handler, setDocClient, seedGames, setSteamLibrary } = await import("../handler");

const db = new FakeDocClient();
setDocClient(db);
const steam = new FakeSteamLibrary();
setSteamLibrary(steam);

const QUERIES = ["games", "platforms", "accounts", "tags"];

/** AppSync-shaped resolver event for one caller invoking one field. */
export function appSyncEvent(caller: Caller, fieldName: string, args: Record<string, unknown> = {}) {
  const identity = {
    sub: caller.userId,
    username: caller.username,
    claims: { sub: caller.userId, "cognito:username": caller.username },
    issuer: "test", sourceIp: [], defaultAuthStrategy: "ALLOW", groups: null,
  } satisfies AppSyncIdentityCognito;
  return {
    arguments: args,
    identity,
    source: null,
    request: { headers: {}, domainName: null },
    info: { fieldName, parentTypeName: QUERIES.includes(fieldName) ? "Query" : "Mutation", variables: args, selectionSetList: [], selectionSetGraphQL: "" },
    prev: null,
    stash: {},
  } as AppSyncResolverEvent<Record<string, unknown>>;
}

export function harness() {
  return {
    owner,
    stranger,
    db,
    /** The fake Steam Web API the Import calls. */
    steam,
    /** Empty the table and forget every fake Steam library. */
    reset: () => {
      db.reset();
      steam.reset();
    },
    event: appSyncEvent,
    /** Invoke the handler with a hand-built event (e.g. one with no identity). */
    invoke: (event: AppSyncResolverEvent<Record<string, unknown>>): Promise<any> => handler(event),
    /** Invoke the handler as `caller`. Rejects with the same Error the client would see. */
    call: (caller: Caller, fieldName: string, args: Record<string, unknown> = {}): Promise<any> =>
      handler(appSyncEvent(caller, fieldName, args)),
    /** Run the Seed for `caller` against the in-memory table (scripts/seed.ts does this for real). */
    seed: (caller: Caller, rows: unknown, opts?: { dryRun?: boolean }) => seedGames(caller.userId, rows, opts),
  };
}
