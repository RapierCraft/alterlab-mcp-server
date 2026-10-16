/**
 * Remote mode entry point: `--remote [url]` or `ALTERLAB_MCP_URL`.
 *
 * Credential order: ALTERLAB_API_KEY, then the API key saved by `--setup`
 * (~/.alterlab/config.json), then OAuth (stored tokens, refresh, or a browser
 * sign-in). An API key is sent as the bearer token, which the hosted endpoint
 * accepts alongside OAuth access tokens.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, loadConfigFromFile } from "../config.js";
import { OAuthSession } from "./oauth.js";
import { RemoteProxy, StaticBearer, type CredentialProvider } from "./proxy.js";
import { TokenStore } from "./token-store.js";

export const DEFAULT_MCP_URL = "https://mcp.alterlab.io/mcp";

export interface RemoteSettings {
  url: string;
}

/** The remote URL if remote mode is requested, else null (local API-key mode). */
export function resolveRemoteSettings(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): RemoteSettings | null {
  const flag = args.indexOf("--remote");
  const eq = args.find((a) => a.startsWith("--remote="));
  const fromEnv = env.ALTERLAB_MCP_URL?.trim();
  if (flag === -1 && !eq && !fromEnv) return null;
  let url = fromEnv || DEFAULT_MCP_URL;
  const next = flag === -1 ? undefined : args[flag + 1];
  if (next && !next.startsWith("-")) url = next;
  if (eq) url = eq.slice("--remote=".length) || url;
  return { url };
}

export function apiKeyFromEnvironment(): string | null {
  return loadConfig()?.apiKey ?? loadConfigFromFile()?.apiKey ?? null;
}

export class OAuthCredentials implements CredentialProvider {
  constructor(private readonly session: OAuthSession) {}
  async getAuthorization() {
    return `Bearer ${await this.session.getAccessToken()}`;
  }
  async onUnauthorized(rejected: string, challenge: string | null) {
    const token = rejected.replace(/^Bearer\s+/i, "");
    return `Bearer ${await this.session.onUnauthorized(token, challenge)}`;
  }
}

const log = (message: string) => process.stderr.write(`[alterlab] ${message}\n`);

export function createOAuthSession(url: string, version: string): OAuthSession {
  return new OAuthSession({
    mcpUrl: url,
    scope: process.env.ALTERLAB_OAUTH_SCOPE,
    store: new TokenStore(),
    softwareVersion: version,
    log,
  });
}

/** Run the stdio bridge until the client disconnects. */
export async function runRemote(
  settings: RemoteSettings,
  version: string,
  apiKey: string | null,
): Promise<void> {
  let credentials: CredentialProvider;
  if (apiKey) {
    credentials = new StaticBearer(apiKey);
  } else {
    const session = createOAuthSession(settings.url, version);
    credentials = new OAuthCredentials(session);
    // Start signing in now so the browser opens at launch instead of making the
    // client's first request wait on it.
    session.getAccessToken().catch((err) => log(`Sign-in failed: ${(err as Error).message}`));
  }

  const proxy = new RemoteProxy(new StdioServerTransport(), {
    url: settings.url,
    credentials,
    userAgent: `alterlab-mcp-server/${version}`,
    log,
  });
  await proxy.start();
  log(`Remote mode: proxying MCP to ${settings.url}`);

  const shutdown = () => {
    void proxy.close().finally(() => process.exit(0));
  };
  process.stdin.on("end", shutdown);
  process.stdin.on("close", shutdown);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/** `--login`: authorize now and exit. `--logout`: revoke and delete stored tokens. */
export async function runRemoteAuthCommand(
  command: "login" | "logout",
  settings: RemoteSettings,
  version: string,
): Promise<void> {
  const session = createOAuthSession(settings.url, version);
  if (command === "login") {
    await session.loginNow();
    log("Signed in. You can now add this server to your MCP client.");
  } else {
    const removed = await session.logout();
    log(removed ? "Signed out and revoked the AlterLab grant." : "No saved authorization found.");
  }
}
