import { App, Tags } from "aws-cdk-lib";
import { AppStack } from "../lib/stacks";

// No account or zone IDs in this repo. The account comes from the deploying credentials
// (CDK_DEFAULT_ACCOUNT); with none, the stack synths environment-agnostic. Override the region
// with `-c region=...`.
const app = new App();
const region = app.node.tryGetContext("region") ?? process.env.CDK_DEFAULT_REGION ?? "us-west-1";
Tags.of(app).add("app", "games-catalog");

new AppStack(app, "GamesCatalog", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region },
});
