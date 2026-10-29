import { CfnOutput, Duration, Stack, type StackProps, aws_iam as iam } from "aws-cdk-lib";
import type { Construct } from "constructs";

export const GITHUB_REPO = "asherShores5/games-catalog";
/** asherShores5's immutable GitHub owner ID (public). GitHub's OIDC `sub` can embed owner@id/repo@id. */
const GITHUB_OWNER_ID = "71547146";
export const DEPLOY_BRANCH = "prod";
export const DEPLOY_ROLE_NAME = "games-catalog-github-deploy";

interface CiStackProps extends StackProps {
  /** Numeric repo ID (`gh api repos/asherShores5/games-catalog --jq .id`); adds the ID-form subject. */
  githubRepoId?: string;
}

/**
 * GitHub Actions -> AWS via OIDC (no stored keys). Only workflows on the prod branch of this repo
 * can assume the role, and the role can only assume the CDK bootstrap roles.
 *
 * The account's GitHub OIDC provider already exists (Honey Do's CiStack created it, and an account
 * can have only one per URL), so this imports it rather than creating a second.
 */
export class CiStack extends Stack {
  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, props);
    const { githubRepoId } = props;
    if (githubRepoId !== undefined && !/^\d+$/.test(githubRepoId)) {
      throw new Error(`githubRepoId must be the numeric GitHub repo ID, got "${githubRepoId}"`);
    }

    const provider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      "GitHub",
      `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`,
    );
    const [owner, repo] = GITHUB_REPO.split("/");
    const repos = [GITHUB_REPO, ...(githubRepoId ? [`${owner}@${GITHUB_OWNER_ID}/${repo}@${githubRepoId}`] : [])];

    const role = new iam.Role(this, "DeployRole", {
      roleName: DEPLOY_ROLE_NAME,
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": repos.map((r) => `repo:${r}:ref:refs/heads/${DEPLOY_BRANCH}`),
        },
      }),
    });
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*`],
      }),
    );
    new CfnOutput(this, "DeployRoleArn", { value: role.roleArn });
  }
}
