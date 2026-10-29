import type { Account, Format, Game, Platform, PlayStatus, SteamImportSummary, Store, Tag } from "@games/shared";
import { freshTokens } from "./auth";
import { getConfig } from "./config";

const COPY = `id platformId format accountId edition createdAt`;
const GAME = `id name copies { ${COPY} } owned wishlist playStatus tags { tagId source } steamAppId createdAt updatedAt`;
const TAG = `id name`;
const PLATFORM = `id name`;
const ACCOUNT = `id store nickname hasSteamId`;

export const Q = {
  games: `query { games { ${GAME} } }`,
  addGame: `mutation($name: String!) { addGame(name: $name) { ${GAME} } }`,
  addCopy: `mutation($gameId: ID!, $platformId: ID!, $format: Format!, $accountId: ID, $edition: String) {
    addCopy(gameId: $gameId, platformId: $platformId, format: $format, accountId: $accountId, edition: $edition) { ${GAME} } }`,
  fillUnknownCopy: `mutation($gameId: ID!, $copyId: ID!, $platformId: ID!, $format: Format!, $accountId: ID, $edition: String) {
    fillUnknownCopy(gameId: $gameId, copyId: $copyId, platformId: $platformId, format: $format, accountId: $accountId, edition: $edition) { ${GAME} } }`,
  removeCopy: `mutation($gameId: ID!, $copyId: ID!) { removeCopy(gameId: $gameId, copyId: $copyId) { ${GAME} } }`,
  setPlayStatus: `mutation($gameId: ID!, $playStatus: PlayStatus) { setPlayStatus(gameId: $gameId, playStatus: $playStatus) { ${GAME} } }`,
  setWishlist: `mutation($gameId: ID!, $wishlist: Boolean!) { setWishlist(gameId: $gameId, wishlist: $wishlist) { ${GAME} } }`,
  platforms: `query { platforms { ${PLATFORM} } }`,
  addPlatform: `mutation($name: String!) { addPlatform(name: $name) { ${PLATFORM} } }`,
  renamePlatform: `mutation($id: ID!, $name: String!) { renamePlatform(id: $id, name: $name) { ${PLATFORM} } }`,
  deletePlatform: `mutation($id: ID!) { deletePlatform(id: $id) }`,
  accounts: `query { accounts { ${ACCOUNT} } }`,
  addAccount: `mutation($store: Store!, $nickname: String!) { addAccount(store: $store, nickname: $nickname) { ${ACCOUNT} } }`,
  renameAccount: `mutation($id: ID!, $nickname: String!) { renameAccount(id: $id, nickname: $nickname) { ${ACCOUNT} } }`,
  deleteAccount: `mutation($id: ID!) { deleteAccount(id: $id) }`,
  setSteamId: `mutation($accountId: ID!, $steamId: String) { setSteamId(accountId: $accountId, steamId: $steamId) { ${ACCOUNT} } }`,
  importSteam: `mutation($accountId: ID!) { importSteam(accountId: $accountId) { added alreadyPresent addedNames failed tagged tagsPending } }`,
  tags: `query { tags { ${TAG} } }`,
  addTag: `mutation($name: String!) { addTag(name: $name) { ${TAG} } }`,
  renameTag: `mutation($id: ID!, $name: String!) { renameTag(id: $id, name: $name) { ${TAG} } }`,
  deleteTag: `mutation($id: ID!) { deleteTag(id: $id) }`,
  mergeTags: `mutation($fromId: ID!, $intoId: ID!) { mergeTags(fromId: $fromId, intoId: $intoId) { ${TAG} } }`,
  addGameTag: `mutation($gameId: ID!, $tagId: ID!) { addGameTag(gameId: $gameId, tagId: $tagId) { ${GAME} } }`,
  removeGameTag: `mutation($gameId: ID!, $tagId: ID!) { removeGameTag(gameId: $gameId, tagId: $tagId) { ${GAME} } }`,
};

export async function gql<T = any>(query: string, variables: object = {}): Promise<T> {
  const { idToken } = await freshTokens();
  const r = await fetch(getConfig().graphqlUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: idToken },
    body: JSON.stringify({ query, variables }),
  });
  const json = await r.json().catch(() => ({}));
  if (json.errors?.length) throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  if (!r.ok) throw new Error(`server ${r.status}`);
  return json.data as T;
}

// GraphQL returns null for a missing Edition, Account, or an Unknown Copy's Platform and Format;
// the shared type uses undefined.
const fixGame = (g: Game): Game => ({
  ...g,
  steamAppId: g.steamAppId ?? undefined,
  copies: g.copies.map((c) => ({
    ...c,
    platformId: c.platformId ?? undefined,
    format: c.format ?? undefined,
    accountId: c.accountId ?? undefined,
    edition: c.edition ?? undefined,
  })),
});

export const listGames = async () => (await gql<{ games: Game[] }>(Q.games)).games.map(fixGame);
export const addGame = async (name: string) => fixGame((await gql<{ addGame: Game }>(Q.addGame, { name })).addGame);
export const addCopy = async (v: { gameId: string; platformId: string; format: Format; accountId?: string; edition?: string }) =>
  fixGame((await gql<{ addCopy: Game }>(Q.addCopy, v)).addCopy);
export const fillUnknownCopy = async (v: { gameId: string; copyId: string; platformId: string; format: Format; accountId?: string }) =>
  fixGame((await gql<{ fillUnknownCopy: Game }>(Q.fillUnknownCopy, v)).fillUnknownCopy);
export const removeCopy = async (gameId: string, copyId: string) =>
  fixGame((await gql<{ removeCopy: Game }>(Q.removeCopy, { gameId, copyId })).removeCopy);
export const setPlayStatus = async (gameId: string, playStatus: PlayStatus | null) =>
  fixGame((await gql<{ setPlayStatus: Game }>(Q.setPlayStatus, { gameId, playStatus })).setPlayStatus);
export const setWishlist = async (gameId: string, wishlist: boolean) =>
  fixGame((await gql<{ setWishlist: Game }>(Q.setWishlist, { gameId, wishlist })).setWishlist);

export const listPlatforms = async () => (await gql<{ platforms: Platform[] }>(Q.platforms)).platforms;
export const addPlatform = async (name: string) => (await gql<{ addPlatform: Platform }>(Q.addPlatform, { name })).addPlatform;
export const renamePlatform = async (id: string, name: string) =>
  (await gql<{ renamePlatform: Platform }>(Q.renamePlatform, { id, name })).renamePlatform;
export const deletePlatform = async (id: string) => (await gql<{ deletePlatform: string }>(Q.deletePlatform, { id })).deletePlatform;

export const listAccounts = async () => (await gql<{ accounts: Account[] }>(Q.accounts)).accounts;
export const addAccount = async (store: Store, nickname: string) =>
  (await gql<{ addAccount: Account }>(Q.addAccount, { store, nickname })).addAccount;
export const renameAccount = async (id: string, nickname: string) =>
  (await gql<{ renameAccount: Account }>(Q.renameAccount, { id, nickname })).renameAccount;
export const deleteAccount = async (id: string) => (await gql<{ deleteAccount: string }>(Q.deleteAccount, { id })).deleteAccount;
/** Set or (with null) clear a Steam Account's Steam ID. The API never sends it back. */
export const setSteamId = async (accountId: string, steamId: string | null) =>
  (await gql<{ setSteamId: Account }>(Q.setSteamId, { accountId, steamId })).setSteamId;
export const importSteam = async (accountId: string) =>
  (await gql<{ importSteam: SteamImportSummary }>(Q.importSteam, { accountId })).importSteam;

// Tags (ticket 06). Deleting or merging a Tag rewrites Games, so callers reload the Game list after.
export const listTags = async () => (await gql<{ tags: Tag[] }>(Q.tags)).tags;
export const addTag = async (name: string) => (await gql<{ addTag: Tag }>(Q.addTag, { name })).addTag;
export const renameTag = async (id: string, name: string) => (await gql<{ renameTag: Tag }>(Q.renameTag, { id, name })).renameTag;
export const deleteTag = async (id: string) => (await gql<{ deleteTag: string }>(Q.deleteTag, { id })).deleteTag;
export const mergeTags = async (fromId: string, intoId: string) =>
  (await gql<{ mergeTags: Tag }>(Q.mergeTags, { fromId, intoId })).mergeTags;
export const addGameTag = async (gameId: string, tagId: string) =>
  fixGame((await gql<{ addGameTag: Game }>(Q.addGameTag, { gameId, tagId })).addGameTag);
export const removeGameTag = async (gameId: string, tagId: string) =>
  fixGame((await gql<{ removeGameTag: Game }>(Q.removeGameTag, { gameId, tagId })).removeGameTag);
