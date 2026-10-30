// Accounts: one login on a Store, with a nickname.
//
// `SK = ACCOUNT#<id>`. Copies point at an Account by id, so renaming it never touches a Copy.
// The Store is fixed at creation (Imports and a Steam ID depend on it); only the nickname renames.
// Store-specific fields go on this same record; accountOut picks the public fields, so a private
// field doesn't leak by accident. A Steam Account's `steamId` is one: only `hasSteamId` goes out.
import { randomUUID } from "node:crypto";
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { accountLabel, byAccountLabel, type Account, type Store } from "@games/shared";
import { TABLE, accountSk, ddb, isCopyRec, ownerPk, queryPrefix, type Ctx, type Rec } from "./db";
import { UserError, validateAccountNickname, validateSteamId, validateStore } from "./rules";

export function accountOut(rec: Rec): Account {
  return { id: rec.id as string, store: rec.store as Store, nickname: rec.nickname as string, hasSteamId: typeof rec.steamId === "string" };
}

async function allAccounts(ctx: Ctx) {
  return (await queryPrefix(ctx, "ACCOUNT#")).map(accountOut).sort(byAccountLabel);
}

export async function accounts(ctx: Ctx) {
  return allAccounts(ctx);
}

/** The stored Account record, private fields included. Never return it to a client as is. */
export async function getAccountRec(ctx: Ctx, id: unknown): Promise<Rec> {
  if (typeof id !== "string") throw new UserError("NotFound", "No such Account");
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: ownerPk(ctx), SK: accountSk(id) } }));
  if (!r.Item) throw new UserError("NotFound", "No such Account");
  return r.Item;
}

export async function getAccount(ctx: Ctx, id: unknown): Promise<Account> {
  return accountOut(await getAccountRec(ctx, id));
}

export async function addAccount(ctx: Ctx, args: { store: string; nickname: string }) {
  const store = validateStore(args.store);
  const nickname = validateAccountNickname(args.nickname, store, await allAccounts(ctx));
  const account: Account = { id: randomUUID(), store, nickname, hasSteamId: false };
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: { PK: ownerPk(ctx), SK: accountSk(account.id), id: account.id, store, nickname },
      ConditionExpression: "attribute_not_exists(PK)",
    }),
  );
  return account;
}

export async function renameAccount(ctx: Ctx, args: { id: string; nickname: string }) {
  const account = await getAccount(ctx, args.id);
  const nickname = validateAccountNickname(args.nickname, account.store, await allAccounts(ctx), account.id);
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: ownerPk(ctx), SK: accountSk(account.id) },
      UpdateExpression: "SET nickname = :n",
      ConditionExpression: "attribute_exists(PK)",
      ExpressionAttributeValues: { ":n": nickname },
    }),
  );
  return { ...account, nickname };
}

export async function setSteamId(ctx: Ctx, args: { accountId: string; steamId?: string | null }) {
  const account = await getAccount(ctx, args.accountId);
  const steamId = validateSteamId(account.store, args.steamId);
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: ownerPk(ctx), SK: accountSk(account.id) },
      ...(steamId === undefined
        ? { UpdateExpression: "REMOVE steamId", ConditionExpression: "attribute_exists(PK)" }
        : { UpdateExpression: "SET steamId = :s", ConditionExpression: "attribute_exists(PK)", ExpressionAttributeValues: { ":s": steamId } }),
    }),
  );
  return { ...account, hasSteamId: steamId !== undefined };
}

export async function deleteAccount(ctx: Ctx, args: { id: string }) {
  const account = await getAccount(ctx, args.id);
  // Same scan as deletePlatform; addCopy conditions on the Account still existing.
  const inUse = (await queryPrefix(ctx, "GAME#")).filter((r) => isCopyRec(r) && r.accountId === account.id).length;
  if (inUse > 0) {
    throw new UserError(
      "Conflict",
      `Account "${accountLabel(account)}" is used by ${inUse} ${inUse === 1 ? "Copy" : "Copies"}; move or remove them first`,
    );
  }
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: ownerPk(ctx), SK: accountSk(account.id) } }));
  return account.id;
}
