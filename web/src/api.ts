import type { Game } from "@games/shared";
import { freshTokens } from "./auth";
import { getConfig } from "./config";

const GAME = `id name createdAt updatedAt`;

export const Q = {
  games: `query { games { ${GAME} } }`,
  addGame: `mutation($name: String!) { addGame(name: $name) { ${GAME} } }`,
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

export const listGames = async () => (await gql<{ games: Game[] }>(Q.games)).games;
export const addGame = async (name: string) => (await gql<{ addGame: Game }>(Q.addGame, { name })).addGame;
