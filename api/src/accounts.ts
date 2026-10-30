// Accounts: one login on a Store, with a nickname.
//
// `SK = ACCOUNT#<id>`. Copies point at an Account by id, so renaming it never touches a Copy.
// The Store is fixed at creation (Imports and a Steam ID depend on it); only the nickname renames.
// Store-specific fields go on this same record; accountOut picks the public fields, so a private
// field doesn't leak by accident. A Steam Account's `steamId` is one: only `hasSteamId` goes out.
import { randomUUID } from "node:crypto";
import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { accountLabel, byAccountLabel, type Account, type Store } from "@games/shared";
import { TABLE, accountSk, ddb, deleteRecord, getOwned, ownerPk, putNew, queryPrefix, refuseIfCopiesUse, setFields, type Ctx, type Rec } from "./db";
import { validateAccountNickname, validateSteamId, validateStore } from "./rules";

export function accountOut(rec: Rec): Account {
  return { id: rec.id as string, store: rec.store as Store, nickname: rec.nickname as string, hasSteamId: typeof rec.steamId === "string" };
}

/** The owner's Accounts in label order ("Steam: main"). */
export async function allAccounts(ctx: Ctx): Promise<Account[]> {
  return (await queryPrefix(ctx, "ACCOUNT#")).map(accountOut).sort(byAccountLabel);
}

/** The stored Account record, private fields included. Never return it to a client as is. */
export async function getAccountRec(ctx: Ctx, id: unknown): Promise<Rec> {
  return getOwned(ctx, id, accountSk, "Account");
}

export async function getAccount(ctx: Ctx, id: unknown): Promise<Account> {
  return accountOut(await getAccountRec(ctx, id));
}

export async function addAccount(ctx: Ctx, args: { store: string; nickname: string }) {
  const store = validateStore(args.store);
  const nickname = validateAccountNickname(args.nickname, store, await allAccounts(ctx));
  const account: Account = { id: randomUUID(), store, nickname, hasSteamId: false };
  await ddb.send(new PutCommand(putNew(ctx, { SK: accountSk(account.id), id: account.id, store, nickname }).Put));
  return account;
}

export async function renameAccount(ctx: Ctx, args: { id: string; nickname: string }) {
  const account = await getAccount(ctx, args.id);
  const nickname = validateAccountNickname(args.nickname, account.store, await allAccounts(ctx), account.id);
  await setFields(ctx, accountSk(account.id), { nickname });
  return { ...account, nickname };
}

export async function setSteamId(ctx: Ctx, args: { accountId: string; steamId?: string | null }) {
  const account = await getAccount(ctx, args.accountId);
  const steamId = validateSteamId(account.store, args.steamId);
  if (steamId === undefined) {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: ownerPk(ctx), SK: accountSk(account.id) },
        UpdateExpression: "REMOVE steamId",
        ConditionExpression: "attribute_exists(PK)",
      }),
    );
  } else {
    await setFields(ctx, accountSk(account.id), { steamId });
  }
  return { ...account, hasSteamId: steamId !== undefined };
}

export async function deleteAccount(ctx: Ctx, args: { id: string }) {
  const account = await getAccount(ctx, args.id);
  await refuseIfCopiesUse(ctx, (copy) => copy.accountId === account.id, `Account "${accountLabel(account)}"`);
  await deleteRecord(ctx, accountSk(account.id));
  return account.id;
}
