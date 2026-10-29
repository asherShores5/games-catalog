export interface Config {
  region: string;
  userPoolId: string;
  clientId: string;
  graphqlUrl: string;
}

let config: Config | undefined;

/**
 * Runtime config, so the build has no environment baked in. Locally it's web/public/config.json
 * (gitignored; copy config.example.json and fill in the stack outputs). Once hosted, CDK writes it.
 */
export async function loadConfig(): Promise<Config> {
  if (config) return config;
  const r = await fetch("/config.json", { cache: "no-cache" });
  if (!r.ok) throw new Error(`config.json: HTTP ${r.status}`);
  config = (await r.json()) as Config;
  return config;
}

export function getConfig(): Config {
  if (!config) throw new Error("config not loaded");
  return config;
}
