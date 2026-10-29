import * as path from "node:path";
import {
  CfnOutput, Duration, RemovalPolicy, Stack, type StackProps,
  aws_appsync as appsync,
  aws_cognito as cognito,
  aws_dynamodb as dynamodb,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
  aws_logs as logs,
} from "aws-cdk-lib";
import type { Construct } from "constructs";

/** Served here once ticket 11 adds hosting (cert, CloudFront, DNS). */
export const APP_DOMAIN = "games.ashershores.com";
const ROOT = path.join(__dirname, "..", "..");

/** Data, auth and API. Hosting and deploy CI come in ticket 11. */
export class AppStack extends Stack {
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
    });

    // ---- API ----
    const fn = new nodejs.NodejsFunction(this, "ApiFn", {
      entry: path.join(ROOT, "api", "src", "handler.ts"),
      projectRoot: ROOT,
      depsLockFilePath: path.join(ROOT, "package-lock.json"),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: { TABLE_NAME: table.tableName },
      bundling: { minify: true, sourceMap: true, format: nodejs.OutputFormat.ESM, target: "node22" },
      logGroup: new logs.LogGroup(this, "ApiLogs", { retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY }),
    });
    table.grantReadWriteData(fn);

    const api = new appsync.GraphqlApi(this, "Api", {
      name: "games-catalog",
      definition: appsync.Definition.fromFile(path.join(ROOT, "schema", "schema.graphql")),
      authorizationConfig: {
        defaultAuthorization: { authorizationType: appsync.AuthorizationType.USER_POOL, userPoolConfig: { userPool } },
      },
      logConfig: { fieldLogLevel: appsync.FieldLogLevel.ERROR, retention: logs.RetentionDays.TWO_WEEKS },
    });
    const ds = api.addLambdaDataSource("ApiDs", fn);
    for (const field of ["games"]) ds.createResolver(`Q${field}`, { typeName: "Query", fieldName: field });
    for (const field of ["addGame"]) ds.createResolver(`M${field}`, { typeName: "Mutation", fieldName: field });

    // The web app's /config.json takes these values (see web/public/config.example.json).
    new CfnOutput(this, "Region", { value: this.region });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "ClientId", { value: client.userPoolClientId });
    new CfnOutput(this, "GraphqlUrl", { value: api.graphqlUrl });
    new CfnOutput(this, "TableName", { value: table.tableName });
  }
}
