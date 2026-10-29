import type { Format, Game, Platform, PlayStatus } from "@games/shared";
import { freshTokens } from "./auth";
import { getConfig } from "./config";

const COPY = `id platformId format edition createdAt`;
const GAME = `id name copies { ${COPY} } owned wishlist playStatus createdAt updatedAt`;
const PLATFORM = `id name`;

export const Q = {
  games: `query { games { ${GAME} } }`,
  addGame: `mutation($name: String!) { addGame(name: $name) { ${GAME} } }`,
  addCopy: `mutation($gameId: ID!, $platformId: ID!, $format: Format!, $edition: String) {
    addCopy(gameId: $gameId, platformId: $platformId, format: $format, edition: $edition) { ${GAME} } }`,
  removeCopy: `mutation($gameId: ID!, $copyId: ID!) { removeCopy(gameId: $gameId, copyId: $copyId) { ${GAME} } }`,
  setPlayStatus: `mutation($gameId: ID!, $playStatus: PlayStatus) { setPlayStatus(gameId: $gameId, playStatus: $playStatus) { ${GAME} } }`,
  setWishlist: `mutation($gameId: ID!, $wishlist: Boolean!) { setWishlist(gameId: $gameId, wishlist: $wishlist) { ${GAME} } }`,
  platforms: `query { platforms { ${PLATFORM} } }`,
  addPlatform: `mutation($name: String!) { addPlatform(name: $name) { ${PLATFORM} } }`,
  renamePlatform: `mutation($id: ID!, $name: String!) { renamePlatform(id: $id, name: $name) { ${PLATFORM} } }`,
  deletePlatform: `mutation($id: ID!) { deletePlatform(id: $id) }`,
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

// GraphQL returns null for a missing Edition; the shared type uses undefined.
const fixGame = (g: Game): Game => ({ ...g, copies: g.copies.map((c) => ({ ...c, edition: c.edition ?? undefined })) });

export const listGames = async () => (await gql<{ games: Game[] }>(Q.games)).games.map(fixGame);
export const addGame = async (name: string) => fixGame((await gql<{ addGame: Game }>(Q.addGame, { name })).addGame);
export const addCopy = async (v: { gameId: string; platformId: string; format: Format; edition?: string }) =>
  fixGame((await gql<{ addCopy: Game }>(Q.addCopy, v)).addCopy);
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
