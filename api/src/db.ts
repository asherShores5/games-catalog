// The table: one DocumentClient, the caller's partition, record keys and small shared helpers.
// Every record lives under the owner's partition `OWNER#<cognito sub>`.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { UserError } from "./rules";

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

/** True when the transaction was cancelled because the action at `position` failed its condition. */
export const failedAt = (codes: string[] | undefined, position: number) => codes?.[position] === "ConditionalCheckFailed";

/** The caller's record at `SK`, or NotFound "No such <what>". `id` must be a string to look it up. */
export async function getOwned(ctx: Ctx, id: unknown, sk: (id: string) => string, what: string): Promise<Rec> {
  if (typeof id !== "string") throw new UserError("NotFound", `No such ${what}`);
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: ownerPk(ctx), SK: sk(id) } }));
  if (!r.Item) throw new UserError("NotFound", `No such ${what}`);
  return r.Item;
}

/**
 * SET `fields` on the existing record at `SK`, only while each of `unchanged` still holds its value
 * (e.g. the name we read). A failed condition throws ConditionalCheckFailedException as is.
 */
export async function setFields(ctx: Ctx, SK: string, fields: Rec, unchanged: Rec = {}) {
  const names: Record<string, string> = {};
  const values: Rec = {};
  const sets = Object.entries(fields).map(([k, v], i) => {
    names[`#f${i}`] = k;
    values[`:f${i}`] = v;
    return `#f${i} = :f${i}`;
  });
  const checks = Object.entries(unchanged).map(([k, v], i) => {
    names[`#u${i}`] = k;
    values[`:u${i}`] = v;
    return `#u${i} = :u${i}`;
  });
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: ownerPk(ctx), SK },
      UpdateExpression: `SET ${sets.join(", ")}`,
      ConditionExpression: ["attribute_exists(PK)", ...checks].join(" AND "),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

/**
 * Write `records` (each with its SK) the first time this runs for the caller, with a marker
 * record at `markerSk` so it never runs again, even after every seeded record is deleted.
 */
export async function seedOnce(ctx: Ctx, markerSk: string, records: (Rec & { SK: string })[]) {
  const marker = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: ownerPk(ctx), SK: markerSk } }));
  if (marker.Item) return;
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: TABLE, Item: { PK: ownerPk(ctx), SK: markerSk, at: Date.now() }, ConditionExpression: "attribute_not_exists(PK)" } },
          ...records.map((r) => ({ Put: { TableName: TABLE, Item: { ...r, PK: ownerPk(ctx) } } })),
        ],
      }),
    );
  } catch (e) {
    // A concurrent first call seeded already; its write wins.
    if ((e as Error).name !== "TransactionCanceledException") throw e;
  }
}

/** Put a brand-new record (`item` holds its SK); fails if one is already there. */
export function putNew(ctx: Ctx, item: Rec & { SK: string }) {
  return { Put: { TableName: TABLE, Item: { ...item, PK: ownerPk(ctx) }, ConditionExpression: "attribute_not_exists(PK)" } };
}

/**
 * Refuse deleting a Platform or Account while Copies use it. Scans the caller's Games: fine at
 * one person's catalog size. Copy writes condition on the Platform/Account still existing, so a
 * Copy can't land on one deleted after this check.
 */
export async function refuseIfCopiesUse(ctx: Ctx, uses: (copyRec: Rec) => boolean, what: string) {
  const inUse = (await queryPrefix(ctx, "GAME#")).filter((r) => isCopyRec(r) && uses(r)).length;
  if (inUse > 0) {
    throw new UserError("Conflict", `${what} is used by ${inUse} ${inUse === 1 ? "Copy" : "Copies"}; move or remove them first`);
  }
}

/** Delete the caller's record at `SK`. */
export const deleteRecord = (ctx: Ctx, SK: string) => ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: ownerPk(ctx), SK } }));

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

/** The public `{ id, name }` of a named record (Platform, Tag). */
export const idAndName = (rec: Rec) => ({ id: rec.id as string, name: rec.name as string });
