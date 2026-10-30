// The Lambda behind AppSync: one resolver per GraphQL field. Each area lives in its own module
// (games.ts, platforms.ts, accounts.ts, tags.ts, importSteam.ts + storeTags.ts, mergeGames.ts,
// seedGames.ts); db.ts holds the table, keys and the caller's partition.
import type { AppSyncIdentityCognito, AppSyncResolverEvent } from "aws-lambda";
import type { Ctx } from "./db";
import { addAccount, allAccounts, deleteAccount, renameAccount, setSteamId } from "./accounts";
import { addCopy, addGame, allGames, fillUnknownCopy, removeCopy, setPlayStatus, setWishlist } from "./games";
import { importSteam } from "./importSteam";
import { mergeGames } from "./mergeGames";
import { addPlatform, allPlatforms, deletePlatform, renamePlatform } from "./platforms";
import { UserError } from "./rules";
import { addGameTag, addTag, allTags, deleteTag, mergeTags, removeGameTag, renameTag } from "./tags";

// Test seams and the Seed script's entry point, re-exported so callers keep one import path.
export { setDocClient } from "./db";
export { setSteamLibrary } from "./steamClient";
export { seedGames, type SeedResult } from "./seedGames";

const RESOLVERS: Record<string, (ctx: Ctx, args: any) => Promise<unknown>> = {
  games: allGames, addGame, addCopy, fillUnknownCopy, removeCopy, setPlayStatus, setWishlist,
  platforms: allPlatforms, addPlatform, renamePlatform, deletePlatform,
  accounts: allAccounts, addAccount, renameAccount, deleteAccount, setSteamId, importSteam,
  tags: allTags, addTag, renameTag, deleteTag, mergeTags, addGameTag, removeGameTag,
  mergeGames,
};

export async function handler(event: AppSyncResolverEvent<Record<string, unknown>>) {
  const id = event.identity as AppSyncIdentityCognito | null;
  if (!id?.sub) throw new Error("Forbidden");
  const fn = RESOLVERS[event.info.fieldName];
  if (!fn) throw new Error(`no resolver for ${event.info.fieldName}`);
  try {
    return await fn({ userId: id.sub }, event.arguments);
  } catch (e) {
    if (e instanceof UserError) throw new Error(`${e.type}: ${e.message}`);
    console.error(e);
    throw new Error("InternalError");
  }
}
