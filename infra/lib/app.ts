import { existsSync } from "node:fs";
import * as path from "node:path";
import type { App } from "aws-cdk-lib";
import { CiStack } from "./ci";
import type { HostingConfig } from "./config";
import { CertStack, WebStack } from "./hosting";
import { APP_DOMAIN, AppStack } from "./stacks";

export interface AppOptions {
  region: string;
  /** Without it, only the app stack is built (account from CDK_DEFAULT_ACCOUNT, or env-agnostic). */
  hosting?: HostingConfig;
  githubRepoId?: string;
  /** The built web app; defaults to web/dist. */
  webDist?: string;
}

export interface BuiltApp {
  app: AppStack;
  cert?: CertStack;
  web?: WebStack;
  ci?: CiStack;
}

export function buildApp(scope: App, opts: AppOptions): BuiltApp {
  const { region, hosting } = opts;
  if (!hosting) {
    return { app: new AppStack(scope, "GamesCatalog", { env: { account: process.env.CDK_DEFAULT_ACCOUNT, region } }) };
  }

  const { account } = hosting;
  const webDist = opts.webDist ?? path.join(__dirname, "..", "..", "web", "dist");
  if (!existsSync(path.join(webDist, "index.html"))) {
    throw new Error(`No web build at ${webDist}; run \`npm run build -w web\` first`);
  }
  const zone = { hosting, domain: APP_DOMAIN };

  const app = new AppStack(scope, "GamesCatalog", { env: { account, region } });
  const cert = new CertStack(scope, "GamesCatalogCert", { env: { account, region: "us-east-1" }, crossRegionReferences: true, ...zone });
  const web = new WebStack(scope, "GamesCatalogWeb", {
    env: { account, region },
    crossRegionReferences: true,
    ...zone,
    certificate: cert.certificate,
    userPool: app.userPool,
    client: app.client,
    api: app.api,
    webDist,
  });
  const ci = new CiStack(scope, "GamesCatalogCi", { env: { account, region }, githubRepoId: opts.githubRepoId });
  return { app, cert, web, ci };
}
