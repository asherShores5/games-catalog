// The GraphQL schema parses (AppSync rejects a bad one only at deploy, after a rollback).
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { Kind, parse } from "graphql";
import { describe, expect, it } from "vitest";

const SDL = readFileSync(path.join(__dirname, "..", "..", "schema", "schema.graphql"), "utf8");

describe("schema/schema.graphql", () => {
  it("parses", () => {
    expect(() => parse(SDL)).not.toThrow();
  });

  it("every Query and Mutation field has a resolver in the stack", () => {
    const stack = readFileSync(path.join(__dirname, "..", "lib", "stacks.ts"), "utf8");
    const fields = parse(SDL).definitions.flatMap((d) =>
      d.kind === Kind.OBJECT_TYPE_DEFINITION && (d.name.value === "Query" || d.name.value === "Mutation")
        ? (d.fields ?? []).map((f) => f.name.value) : []);
    expect(fields.length).toBeGreaterThan(10);
    for (const f of fields) expect(stack, `no resolver for ${f}`).toMatch(new RegExp(`"${f}"`));
  });
});
