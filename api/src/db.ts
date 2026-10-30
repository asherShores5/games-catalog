// The table: one DocumentClient, the caller's partition, record keys and small shared helpers.
// Every record lives under the owner's partition `OWNER#<cognito sub>`.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

export const TABLE = process.env.TABLE_NAME!;

type DocClient = Pick<DynamoDBDocumentClient, "send">;

/** The document client every module sends through (a live binding, so setDocClient reaches them all). */
export let ddb: DocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/** Test seam: swap the document client (see src/testing/harness.ts). Production never calls this. */
export function setDocClient(client: DocClient) {
  ddb = client;
}

/** The signed-in caller. Every record key is derived from `userId`, never from arguments. */
export interface Ctx {
  userId: string;
}

export const ownerPk = (ctx: Ctx) => `OWNER#${ctx.userId}`;

export async function queryPrefix(ctx: Ctx, prefix: string) {
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

export type Rec = Record<string, unknown>;

export function cancellationCodes(e: unknown): string[] | undefined {
  if ((e as Error).name !== "TransactionCanceledException") return undefined;
  return ((e as { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? []).map((r) => r.Code ?? "None");
}

// ---- Record keys ------------------------------------------------------------
//
// A Game is `GAME#<id>` and each of its Copies `GAME#<id>#COPY#<copyId>`, so one begins_with("GAME#")
// query loads every Game with its Copies.

export const gameSk = (id: string) => `GAME#${id}`;
export const copyPrefix = (gameId: string) => `GAME#${gameId}#COPY#`;
export const isCopyRec = (rec: Rec) => String(rec.SK).includes("#COPY#");
export const platformSk = (id: string) => `PLATFORM#${id}`;
export const accountSk = (id: string) => `ACCOUNT#${id}`;
export const tagSk = (id: string) => `TAG#${id}`;
/** DynamoDB's TransactWrite item limit. */
export const TRANSACT_MAX = 100;
