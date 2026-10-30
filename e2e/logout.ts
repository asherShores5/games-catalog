// Signs the QA session out: revokes its refresh token with Cognito, then deletes the saved file,
// so no live 30-day credential sits on this machine between QA runs.
//   npm run logout
import { existsSync, readFileSync, rmSync } from "node:fs";
import { STATE_FILE } from "./session";

if (!existsSync(STATE_FILE)) {
  console.log("No saved session.");
  process.exit(0);
}
const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
const item = (name: string) => state.origins?.flatMap((o: any) => o.localStorage).find((i: any) => i.name === name)?.value;
const tokens = item("games.tokens") && JSON.parse(item("games.tokens"));
const config = item("games.config") && JSON.parse(item("games.config"));
if (tokens?.refreshToken && config?.clientId) {
  const r = await fetch(`https://cognito-idp.${config.region}.amazonaws.com/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": "AWSCognitoIdentityProviderService.RevokeToken" },
    body: JSON.stringify({ Token: tokens.refreshToken, ClientId: config.clientId }),
  });
  console.log(r.ok ? "Refresh token revoked." : `Cognito said ${r.status}; deleting the file anyway.`);
}
rmSync(STATE_FILE);
console.log(`Deleted ${STATE_FILE}.`);
