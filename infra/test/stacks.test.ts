import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp, type BuiltApp } from "../lib/app";
import { CiStack } from "../lib/ci";

const HOSTING = { account: "111111111111", hostedZoneId: "Z0000000PLACEHOLDER", zoneName: "ashershores.com" };

// One synth for the whole file: bundling the API Lambda with esbuild is the slow part.
let built: BuiltApp;
let app: Template, web: Template, cert: Template, ci: Template;
beforeAll(() => {
  const webDist = mkdtempSync(path.join(tmpdir(), "games-web-"));
  writeFileSync(path.join(webDist, "index.html"), "<!doctype html>");
  built = buildApp(new App(), { region: "us-west-1", hosting: HOSTING, webDist });
  app = Template.fromStack(built.app);
  web = Template.fromStack(built.web!);
  cert = Template.fromStack(built.cert!);
  ci = Template.fromStack(built.ci!);
}, 120_000);

describe("auth", () => {
  it("only an admin can create users (no self sign-up)", () => {
    app.hasResourceProperties("AWS::Cognito::UserPool", {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
  });

  it("the web client rotates refresh tokens, so a phone that opens the app within 30 days stays signed in", () => {
    app.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      GenerateSecret: false,
      RefreshTokenValidity: 43200, // minutes = 30 days
      RefreshTokenRotation: { Feature: "ENABLED", RetryGracePeriodSeconds: Match.anyValue() },
    });
  });

  it("the API requires a Cognito user-pool token, with no other auth mode", () => {
    app.hasResourceProperties("AWS::AppSync::GraphQLApi", {
      AuthenticationType: "AMAZON_COGNITO_USER_POOLS",
      AdditionalAuthenticationProviders: Match.absent(),
    });
    app.resourceCountIs("AWS::AppSync::ApiKey", 0);
  });
});

describe("Steam Web API key", () => {
  const statements = () =>
    Object.values(app.findResources("AWS::IAM::Policy")).flatMap((p) => p.Properties.PolicyDocument.Statement as any[]);
  const actions = (s: any) => [s.Action].flat() as string[];

  it("the API Lambda can read only the one Steam key secret, by name", () => {
    const sm = statements().filter((s) => actions(s).some((a) => a.startsWith("secretsmanager:")));
    expect(sm).toHaveLength(1);
    expect(actions(sm[0]).sort()).toEqual(["secretsmanager:DescribeSecret", "secretsmanager:GetSecretValue"]);
    expect(JSON.stringify(sm[0].Resource)).toContain(":secret:games-catalog/steam-web-api-key-??????");
    expect(JSON.stringify(sm[0].Resource)).not.toContain('"*"');
  });

  it("gets the secret's name, never a value, and CDK creates no secret", () => {
    app.resourceCountIs("AWS::SecretsManager::Secret", 0);
    app.hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: Match.objectLike({ STEAM_KEY_SECRET_NAME: "games-catalog/steam-web-api-key" }) },
    });
  });

  it("AppSync error logs leave out arguments (a Steam ID is one)", () => {
    app.hasResourceProperties("AWS::AppSync::GraphQLApi", {
      LogConfig: Match.objectLike({ FieldLogLevel: "ERROR", ExcludeVerboseContent: true }),
    });
  });

  it("the Steam mutations have resolvers", () => {
    const fields = Object.values(app.findResources("AWS::AppSync::Resolver")).map((r) => r.Properties.FieldName);
    expect(fields).toEqual(expect.arrayContaining(["setSteamId", "importSteam"]));
  });

  it("the Merge Games mutation has a resolver", () => {
    const fields = Object.values(app.findResources("AWS::AppSync::Resolver")).map((r) => r.Properties.FieldName);
    expect(fields).toContain("mergeGames");
  });
});

describe("web hosting", () => {
  it("the bucket blocks all public access and only CloudFront (via OAC) may read it", () => {
    web.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
    });
    web.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
    web.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        Aliases: ["games.ashershores.com"],
        Origins: [Match.objectLike({ OriginAccessControlId: Match.anyValue(), S3OriginConfig: { OriginAccessIdentity: "" } })],
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: "redirect-to-https" }),
      }),
    });
  });

  it("no bucket policy statement allows an unconditioned or anonymous principal", () => {
    const policies = Object.values(web.findResources("AWS::S3::BucketPolicy"));
    expect(policies.length).toBeGreaterThan(0);
    for (const p of policies) {
      for (const s of p.Properties.PolicyDocument.Statement) {
        if (s.Effect !== "Allow") continue;
        expect(s.Principal).not.toBe("*");
        expect(JSON.stringify(s.Principal)).not.toContain('"AWS":"*"');
        if (s.Principal?.Service === "cloudfront.amazonaws.com") expect(s.Condition?.StringEquals?.["AWS:SourceArn"]).toBeDefined();
      }
    }
  });

  it("points the domain at CloudFront in the configured zone (A and AAAA)", () => {
    for (const Type of ["A", "AAAA"]) {
      web.hasResourceProperties("AWS::Route53::RecordSet", {
        HostedZoneId: HOSTING.hostedZoneId,
        Name: "games.ashershores.com.",
        Type,
        AliasTarget: Match.objectLike({ HostedZoneId: Match.anyValue() }),
      });
    }
  });

  it("issues the certificate in us-east-1, DNS-validated in the configured zone", () => {
    expect(built.cert!.region).toBe("us-east-1");
    cert.hasResourceProperties("AWS::CertificateManager::Certificate", {
      DomainName: "games.ashershores.com",
      ValidationMethod: "DNS",
      DomainValidationOptions: [{ DomainName: "games.ashershores.com", HostedZoneId: HOSTING.hostedZoneId }],
    });
  });
});

describe("deploy CI (GitHub OIDC)", () => {
  const trust = () => {
    const roles = Object.values(ci.findResources("AWS::IAM::Role"));
    expect(roles).toHaveLength(1);
    const [stmt] = roles[0].Properties.AssumeRolePolicyDocument.Statement;
    return stmt;
  };

  it("reuses the account's existing GitHub OIDC provider instead of creating a second one", () => {
    ci.resourceCountIs("Custom::AWSCDKOpenIdConnectProvider", 0);
    ci.resourceCountIs("AWS::IAM::OIDCProvider", 0);
    expect(JSON.stringify(trust().Principal)).toContain("oidc-provider/token.actions.githubusercontent.com");
  });

  it("only the prod branch of asherShores5/games-catalog can assume the deploy role", () => {
    const s = trust();
    expect(s.Action).toBe("sts:AssumeRoleWithWebIdentity");
    expect(s.Condition).toEqual({
      StringEquals: {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": ["repo:asherShores5/games-catalog:ref:refs/heads/prod"],
      },
    });
  });

  it("adds the immutable-ID subject form when the repo ID is given, still prod only", () => {
    const stack = new CiStack(new App(), "Ci", { env: { account: HOSTING.account, region: "us-west-1" }, githubRepoId: "987654321" });
    const [s] = Object.values(Template.fromStack(stack).findResources("AWS::IAM::Role"))[0].Properties.AssumeRolePolicyDocument.Statement;
    expect(s.Condition.StringEquals["token.actions.githubusercontent.com:sub"]).toEqual([
      "repo:asherShores5/games-catalog:ref:refs/heads/prod",
      "repo:asherShores5@71547146/games-catalog@987654321:ref:refs/heads/prod",
    ]);
  });

  it("rejects a repo ID that isn't a plain number (no wildcards into the trust policy)", () => {
    expect(() => new CiStack(new App(), "Ci", { env: { account: HOSTING.account, region: "us-west-1" }, githubRepoId: "*" })).toThrow(/githubRepoId/);
  });

  it("the role can only assume the CDK bootstrap roles", () => {
    ci.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: [{ Action: "sts:AssumeRole", Effect: "Allow", Resource: "arn:aws:iam::111111111111:role/cdk-hnb659fds-*" }],
        Version: "2012-10-17",
      },
    });
  });
});

describe("without hosting config", () => {
  it("builds only the app stack", () => {
    const b = buildApp(new App(), { region: "us-west-1" });
    expect([b.web, b.cert, b.ci]).toEqual([undefined, undefined, undefined]);
  });
});
