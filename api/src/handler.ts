import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { AppSyncIdentityCognito, AppSyncResolverEvent } from "aws-lambda";
import { byName, type Game } from "@games/shared";
import { UserError, validateGameName } from "./rules";

const TABLE = process.env.TABLE_NAME!;

type DocClient = Pick<DynamoDBDocumentClient, "send">;

let ddb: DocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/** Test seam: swap the document client (see src/testing/harness.ts). Production never calls this. */
export function setDocClient(client: DocClient) {
  ddb = client;
}

/** The signed-in caller. Every record key is derived from `userId`, never from arguments. */
interface Ctx {
  userId: string;
}

const ownerPk = (ctx: Ctx) => `OWNER#${ctx.userId}`;

async function queryPrefix(ctx: Ctx, prefix: string) {
  const out: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
        ExpressionAttributeValues: { ":pk": ownerPk(ctx), ":p": prefix },
        ExclusiveStartKey,
      }),
    );
    out.push(...(r.Items ?? []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

function gameOut(rec: Record<string, unknown>): Game {
  const { PK: _pk, SK: _sk, ...game } = rec;
  return game as unknown as Game;
}

// ---- resolvers ---------------------------------------------------------------

async function games(ctx: Ctx) {
  return (await queryPrefix(ctx, "GAME#")).map(gameOut).sort(byName);
}

async function addGame(ctx: Ctx, args: { name: string }) {
  const name = validateGameName(args.name);
  const now = Date.now();
  const game: Game = { id: randomUUID(), name, createdAt: now, updatedAt: now };
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: { PK: ownerPk(ctx), SK: `GAME#${game.id}`, ...game },
      ConditionExpression: "attribute_not_exists(PK)",
    }),
  );
  return game;
}

const RESOLVERS: Record<string, (ctx: Ctx, args: any) => Promise<unknown>> = { games, addGame };

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
