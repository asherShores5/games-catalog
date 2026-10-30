import { PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vitest";
import { FakeDocClient } from "./fakeDynamo";

const put = (Item: Record<string, unknown>, ConditionExpression: string, ExpressionAttributeValues = {}) =>
  new PutCommand({ TableName: "t", Item, ConditionExpression, ExpressionAttributeValues });

describe("fakeDynamo matches DynamoDB", () => {
  it("`<>` against a missing attribute is false", async () => {
    const db = new FakeDocClient();
    db.seed({ PK: "p", SK: "s" });
    await expect(db.send(put({ PK: "p", SK: "s", x: 1 }, "x <> :v", { ":v": 1 }))).rejects.toThrow("condition failed");
  });

  it("a transaction with one failed condition writes nothing", async () => {
    const db = new FakeDocClient();
    db.seed({ PK: "p", SK: "a" });
    const tx = new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: "t", Item: { PK: "p", SK: "a" }, ConditionExpression: "attribute_not_exists(SK)" } },
        { Put: { TableName: "t", Item: { PK: "p", SK: "b" } } },
      ],
    });
    await expect(db.send(tx)).rejects.toMatchObject({
      name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }],
    });
    expect(db.dump().map((r) => r.SK)).toEqual(["a"]);
  });

  it("a ConditionCheck in a transaction gates the writes without writing itself", async () => {
    const db = new FakeDocClient();
    const tx = (check: string) =>
      new TransactWriteCommand({
        TransactItems: [
          { ConditionCheck: { TableName: "t", Key: { PK: "p", SK: "gate" }, ConditionExpression: check } },
          { Put: { TableName: "t", Item: { PK: "p", SK: "b" } } },
        ],
      });
    await expect(db.send(tx("attribute_exists(PK)"))).rejects.toMatchObject({
      CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }],
    });
    expect(db.dump()).toEqual([]);
    await db.send(tx("attribute_not_exists(PK)"));
    expect(db.dump().map((r) => r.SK)).toEqual(["b"]);
  });
});
