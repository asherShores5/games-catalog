import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { DEPLOY_BRANCH, DEPLOY_ENVIRONMENT, DEPLOY_ROLE_NAME } from "../lib/ci";

const workflow = readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", "ci.yml"), "utf8");

describe("CI workflow", () => {
  it("deploys only on pushes to the prod branch, as the role CiStack creates", () => {
    expect(workflow).toContain(`if: github.event_name == 'push' && github.ref == 'refs/heads/${DEPLOY_BRANCH}'`);
    expect(workflow).toContain(`role/${DEPLOY_ROLE_NAME}`);
  });

  it("runs the deploy job in the approval-gated environment the role trusts", () => {
    expect(workflow).toContain(`    environment: ${DEPLOY_ENVIRONMENT}\n`);
  });
});
