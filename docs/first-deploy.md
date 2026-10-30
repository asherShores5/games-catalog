# First deploy

A one-time, by-hand setup. After it, a push to `prod` deploys through GitHub Actions.
Run everything from the repo root with admin credentials for the personal AWS account
(the same account as Honey Do). Nothing below goes in a tracked file: the account ID and zone ID
are passed as env vars or set in GitHub settings.

What gets created: four stacks, all in us-west-1 except the certificate.

- `GamesCatalog`: table, Cognito user pool, API Lambda, AppSync API (Cognito sign-in required)
- `GamesCatalogCert` (us-east-1): the certificate for games.ashershores.com
- `GamesCatalogWeb`: private S3 bucket, CloudFront (the only reader, via OAC), A/AAAA records
- `GamesCatalogCi`: the `games-catalog-github-deploy` role GitHub Actions assumes

## 1. Look up the values

```sh
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export HOSTED_ZONE_NAME=ashershores.com
export HOSTED_ZONE_ID=$(aws route53 list-hosted-zones-by-name --dns-name "$HOSTED_ZONE_NAME" \
  --query 'HostedZones[0].Id' --output text | sed 's#/hostedzone/##')
REPO_ID=$(gh api repos/asherShores5/games-catalog --jq .id)   # the repo must exist on GitHub
echo "$CDK_DEFAULT_ACCOUNT $HOSTED_ZONE_ID $REPO_ID"
```

## 2. CDK bootstrap (both regions)

Probably already done for Honey Do; running it again is harmless.

```sh
(cd infra && npx cdk bootstrap "aws://$CDK_DEFAULT_ACCOUNT/us-west-1" "aws://$CDK_DEFAULT_ACCOUNT/us-east-1")
```

## 3. GitHub OIDC provider

An account has one provider per URL, and Honey Do's `AubiHoneyCi` stack already created it, so
Games Catalog reuses it. Check it's there:

```sh
aws iam list-open-id-connect-providers   # expect .../oidc-provider/token.actions.githubusercontent.com
```

Only if it's missing:

```sh
aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com --client-id-list sts.amazonaws.com
```

Note: deleting the Honey Do CI stack would delete this provider and break Games Catalog deploys.

## 4. Deploy once from your machine

This creates the deploy role, so CI can't do it the first time. Review the IAM and security-group
changes CDK shows before saying yes.

```sh
npm ci
npm run build:web
(cd infra && npx cdk deploy --all -c requireHosting=true -c githubRepoId="$REPO_ID")
```

Note the outputs: `UserPoolId`, `ClientId`, `GraphqlUrl` (GamesCatalog), `BucketName`
(GamesCatalogWeb) and `DeployRoleArn` (GamesCatalogCi).

## 5. Check nothing is open before adding a user

```sh
# The API refuses anonymous calls (expect "UnauthorizedException" / 401):
curl -s -X POST "<GraphqlUrl>" -H 'content-type: application/json' -d '{"query":"{ games { id } }"}'
# Self sign-up is off (expect NotAuthorizedException "SignUp is not permitted"):
aws cognito-idp sign-up --client-id "<ClientId>" --username probe --password 'Probe-Password-1234'
# The bucket is not public (expect 403 straight from S3; only CloudFront can read it):
curl -sI "https://<BucketName>.s3.us-west-1.amazonaws.com/index.html" | head -1
```

If any of these succeeds, stop and fix it before going on.

## 6. Create the Cognito user

```sh
POOL=<UserPoolId>
aws cognito-idp admin-create-user --user-pool-id "$POOL" --username asher --message-action SUPPRESS
read -rs -p "Password (16+ chars, upper, lower, digit): " PW; echo
aws cognito-idp admin-set-user-password --user-pool-id "$POOL" --username asher --password "$PW" --permanent
unset PW
```

Open https://games.ashershores.com on the phone, sign in, then Share > Add to Home Screen.
It stays signed in as long as it's opened at least once every 30 days.

## 7. GitHub settings for CI

Names only here; set the values in the repo's Settings > Secrets and variables > Actions, or:

```sh
gh secret set AWS_ACCOUNT_ID --body "$CDK_DEFAULT_ACCOUNT"     # a secret so it's masked in public logs
gh variable set HOSTED_ZONE_ID --body "$HOSTED_ZONE_ID"
gh variable set HOSTED_ZONE_NAME --body "$HOSTED_ZONE_NAME"
# optional: gh variable set AWS_REGION --body us-west-1
```

CI gets the repo ID from GitHub itself, so the role's trust policy stays the same on later deploys.

## 8. Deploy from CI

Push `main` first (tests only), then fast-forward `prod` to it. The `prod` push runs the tests
and then `npm run deploy` as the deploy role. The role trusts only this repo's `prod` branch and
can only assume the CDK bootstrap roles.

## 9. Steam Web API key (for "Import from Steam", optional)

Only Import from Steam needs this; everything else works without it. The API Lambda reads the
key from one SSM SecureString parameter, `/games-catalog/steam-web-api-key`, in the app's region
(us-west-1). CDK never creates it, so the key is in no template, log or file here. Until it
exists, an Import fails with "The Steam Web API key isn't set up yet". SSM rather than Secrets
Manager because a standard parameter is free and a secret is $0.40 a month.

Get the key:

1. Sign in at https://steamcommunity.com/dev/apikey with the Steam account that owns the games.
   Steam only issues keys to accounts that have spent at least $5 and have Steam Guard on.
2. Domain Name: `games.ashershores.com` (Steam just records it; nothing checks it).
3. Agree to the terms and Register. Copy the 32-character key it shows. Treat it like a
   password; Revoke on the same page if it ever leaks, then register a new one.

Store it. `read -s` keeps it out of the shell history and the screen; a temp file keeps it out of
the process list:

```sh
read -rs "STEAM_KEY?Steam Web API key: "; echo          # zsh; in bash: read -rs -p "...: " STEAM_KEY
KEYFILE=$(mktemp) && chmod 600 "$KEYFILE" && printf '%s' "$STEAM_KEY" > "$KEYFILE"
aws ssm put-parameter --profile personal --region us-west-1 --type SecureString \
  --name /games-catalog/steam-web-api-key --value "file://$KEYFILE"
rm -f "$KEYFILE"; unset STEAM_KEY
```

To replace the key later, run the same with `--overwrite`. A warm Lambda keeps the old key until
it restarts (minutes to hours); redeploying forces it.

Then in the app: Accounts > a Steam Account > Set Steam ID (the 17-digit number from your Steam
profile URL or Account details, starting 7656119), and in Steam's privacy settings set Game
details to Public. The Steam ID is stored on the Account record only; the app never shows it back.

## Context and env keys (reference)

Context key (`-c key=value`) or env var; context wins. Read by `infra/lib/config.ts` and `infra/bin/app.ts`.

```
account         CDK_DEFAULT_ACCOUNT    the CDK CLI sets the env var from your credentials
hostedZoneId    HOSTED_ZONE_ID         existing public zone
zoneName        HOSTED_ZONE_NAME       games.ashershores.com must be inside it
githubRepoId    GITHUB_REPOSITORY_ID   numeric; set automatically in GitHub Actions
region          CDK_DEFAULT_REGION     defaults to us-west-1
requireHosting  -                      true makes a missing zone an error (npm run deploy sets it)
```

With no zone set, `npm run synth` builds only the `GamesCatalog` stack.
