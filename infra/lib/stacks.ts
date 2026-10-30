import * as path from "node:path";
import {
  CfnOutput, Duration, RemovalPolicy, Stack, type StackProps,
  aws_appsync as appsync,
  aws_cognito as cognito,
  aws_dynamodb as dynamodb,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
  aws_logs as logs,
  aws_budgets as budgets,
  aws_iam as iam,
} from "aws-cdk-lib";
import type { Construct } from "constructs";

/** Served by WebStack (lib/hosting.ts). */
export const APP_DOMAIN = "games.ashershores.com";
const ROOT = path.join(__dirname, "..", "..");
/**
 * The Steam Web API key (SSM SecureString under the AWS-managed aws/ssm key). Created by hand,
 * never by CDK, so the key value is in no template or repo (docs/first-deploy.md). Only its name
 * is here.
 */
export const STEAM_KEY_PARAM_NAME = "/games-catalog/steam-web-api-key";
const BUDGET_EMAIL = "asher.shores5@gmail.com";

/** Data, auth and API. Hosting: CertStack/WebStack (lib/hosting.ts). Deploy CI: CiStack (lib/ci.ts). */
export class AppStack extends Stack {
  /** Read by WebStack for the web app's config.json. */
  readonly userPool: cognito.UserPool;
  readonly client: cognito.UserPoolClient;
  readonly api: appsync.GraphqlApi;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // ---- data: one table, every record keyed under its owner (PK = OWNER#<sub>) ----
    const table = new dynamodb.TableV2(this, "Table", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // ---- auth: one admin-created user, no self sign-up ----
    // ESSENTIALS is what allows the USER_AUTH (choice-based) flow the web app uses, so passkeys
    // can be added later (as in Honey Do) without changing the sign-in code path.
    const userPool = new cognito.UserPool(this, "Users", {
      userPoolName: "games-catalog",
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      signInPolicy: { allowedFirstAuthFactors: { password: true } },
      selfSignUpEnabled: false,
      signInAliases: { username: true },
      signInCaseSensitive: false,
      passwordPolicy: { minLength: 16, requireLowercase: true, requireUppercase: true, requireDigits: true, requireSymbols: false },
      accountRecovery: cognito.AccountRecovery.NONE,
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const client = userPool.addClient("Web", {
      authFlows: { user: true },
      generateSecret: false,
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      // Each refresh returns a new refresh token (web/src/auth.ts uses GetTokensFromRefreshToken),
      // so the 30 days roll forward while the app is in use.
      refreshTokenRotationGracePeriod: Duration.seconds(10),
    });

    // ---- API ----
    const fn = new nodejs.NodejsFunction(this, "ApiFn", {
      entry: path.join(ROOT, "api", "src", "handler.ts"),
      projectRoot: ROOT,
      depsLockFilePath: path.join(ROOT, "package-lock.json"),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      // A Steam Import writes one transaction per game; AppSync waits at most 30 s for a resolver.
      timeout: Duration.seconds(25),
      environment: { TABLE_NAME: table.tableName, STEAM_KEY_PARAM_NAME },
      bundling: { minify: true, sourceMap: true, format: nodejs.OutputFormat.ESM, target: "node22" },
      logGroup: new logs.LogGroup(this, "ApiLogs", { retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY }),
    });
    table.grantReadWriteData(fn);
    // Read access to the one Steam key parameter. SSM decrypts aws/ssm SecureStrings for any
    // principal allowed GetParameter, so no kms:Decrypt statement is needed.
    fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ["ssm:GetParameter"],
      resources: [this.formatArn({ service: "ssm", resource: "parameter", resourceName: STEAM_KEY_PARAM_NAME.slice(1) })],
    }));

    const api = new appsync.GraphqlApi(this, "Api", {
      name: "games-catalog",
      definition: appsync.Definition.fromFile(path.join(ROOT, "schema", "schema.graphql")),
      authorizationConfig: {
        defaultAuthorization: { authorizationType: appsync.AuthorizationType.USER_POOL, userPoolConfig: { userPool } },
      },
      // No verbose content: an erroring field would otherwise log its arguments (e.g. a Steam ID).
      logConfig: { fieldLogLevel: appsync.FieldLogLevel.ERROR, excludeVerboseContent: true, retention: logs.RetentionDays.TWO_WEEKS },
    });
    this.userPool = userPool;
    this.client = client;
    this.api = api;

    const ds = api.addLambdaDataSource("ApiDs", fn);
    for (const field of ["games", "platforms", "accounts"]) ds.createResolver(`Q${field}`, { typeName: "Query", fieldName: field });
    for (const field of ["addGame", "addCopy", "fillUnknownCopy", "removeCopy", "setPlayStatus", "setWishlist", "addPlatform", "renamePlatform", "deletePlatform", "addAccount", "renameAccount", "deleteAccount", "setSteamId", "importSteam"]) ds.createResolver(`M${field}`, { typeName: "Mutation", fieldName: field });
    // Tags (ticket 06).
    ds.createResolver("Qtags", { typeName: "Query", fieldName: "tags" });
    for (const field of ["addTag", "renameTag", "deleteTag", "mergeTags", "addGameTag", "removeGameTag"]) ds.createResolver(`M${field}`, { typeName: "Mutation", fieldName: field });
    // Merge Games (ticket 09).
    ds.createResolver("MmergeGames", { typeName: "Mutation", fieldName: "mergeGames" });

    // The web app's /config.json takes these values (see web/public/config.example.json).
    // ---- cost guardrail: everything here is tagged app=games-catalog (bin/app.ts) ----
    new budgets.CfnBudget(this, "Budget", {
      budget: {
        budgetName: "games-catalog-monthly",
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: 1, unit: "USD" },
        costFilters: { TagKeyValue: ["user:app$games-catalog"] },
      },
      notificationsWithSubscribers: [
        {
          notification: { notificationType: "ACTUAL", comparisonOperator: "GREATER_THAN", threshold: 80 },
          subscribers: [{ subscriptionType: "EMAIL", address: BUDGET_EMAIL }],
        },
        {
          notification: { notificationType: "FORECASTED", comparisonOperator: "GREATER_THAN", threshold: 100 },
          subscribers: [{ subscriptionType: "EMAIL", address: BUDGET_EMAIL }],
        },
      ],
    });

    new CfnOutput(this, "Region", { value: this.region });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "ClientId", { value: client.userPoolClientId });
    new CfnOutput(this, "GraphqlUrl", { value: api.graphqlUrl });
    new CfnOutput(this, "TableName", { value: table.tableName });
  }
}
