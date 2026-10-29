import { App, Tags } from "aws-cdk-lib";
import { buildApp } from "../lib/app";
import { readHostingConfig } from "../lib/config";
import { APP_DOMAIN } from "../lib/stacks";

// No account or zone IDs in this repo: they come from CDK context or env (see lib/config.ts and
// docs/first-deploy.md). With no zone set, only the app stack synths. Region: `-c region=...`.
const app = new App();
const region = app.node.tryGetContext("region") ?? process.env.CDK_DEFAULT_REGION ?? "us-west-1";
Tags.of(app).add("app", "games-catalog");

buildApp(app, {
  region,
  hosting: readHostingConfig((k) => app.node.tryGetContext(k), process.env, APP_DOMAIN),
  // GitHub Actions sets GITHUB_REPOSITORY_ID; locally pass `-c githubRepoId=...` (docs/first-deploy.md).
  githubRepoId: (app.node.tryGetContext("githubRepoId") ?? process.env.GITHUB_REPOSITORY_ID) || undefined,
});
