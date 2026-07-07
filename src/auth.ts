/**
 * OAuth 2.0 Device Authorization Grant (RFC 8628) client-side flow.
 *
 * Authentication priority chain:
 *   1. ALTERLAB_API_KEY environment variable
 *   2. ~/.alterlab/config.json
 *   3. Interactive auth (TTY only):
 *      a. Device flow (POST /auth/device → open browser → poll /auth/token)
 *      b. Fallback: manual API key paste
 *
 * All user-facing output goes to stderr — stdout is reserved for MCP protocol.
 */

import * as https from "https";
import * as http from "http";
import * as readline from "readline";
import { execFile } from "child_process";
import {
  type Config,
  getApiUrl,
  loadConfig,
  loadConfigFromFile,
  saveConfigToFile,
} from "./config.js";

// ---------------------------------------------------------------------------
// Types for device flow API responses
// ---------------------------------------------------------------------------

interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_url: string;
  verification_url_complete?: string;
  interval: number; // seconds between polls
  expires_in: number; // seconds until codes expire
}

interface TokenSuccessResponse {
  api_key: string;
  account_id?: string;
  created_at?: string;
}

interface TokenPendingResponse {
  error: "authorization_pending" | "slow_down";
}

interface TokenErrorResponse {
  error: "expired_token" | "access_denied" | string;
}

type TokenResponse =
  | TokenSuccessResponse
  | TokenPendingResponse
  | TokenErrorResponse;

// ---------------------------------------------------------------------------
// HTTP helper — wraps Node's built-in https/http for simple JSON requests
// ---------------------------------------------------------------------------

function postJson(
  url: string,
  body: Record<string, string>,
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);
    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "User-Agent": "alterlab-mcp-server",
        Accept: "application/json",
      },
    };

    const transport = parsed.protocol === "https:" ? https : http;
    const req = transport.request(options, (res) => {
      let raw = "";
      res.on("data", (chunk: Buffer) => {
        raw += chunk.toString();
      });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode ?? 0, data: raw });
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(15_000, () => {
      req.destroy(new Error("Request timed out"));
    });
    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Browser launcher
// ---------------------------------------------------------------------------

function openBrowser(url: string): void {
  // Validate URL before passing to shell — accept only http(s) schemes to
  // prevent shell injection if the device server returns a malicious URL.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    process.stderr.write(`  (Could not parse browser URL — copy and open manually)\n`);
    return;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    process.stderr.write(`  (Unexpected URL scheme '${parsed.protocol}' — skipping auto-open)\n`);
    return;
  }

  // Use execFile (not exec) to avoid shell interpretation of the URL.
  // The URL is passed as a standalone argument — no shell quoting needed.
  const platform = process.platform;
  let bin: string;
  if (platform === "win32") {
    bin = "cmd";
  } else if (platform === "darwin") {
    bin = "open";
  } else {
    bin = "xdg-open";
  }

  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  execFile(bin, args, () => {
    // Ignore errors — if the browser doesn't open, the user can copy the URL
  });
}

// ---------------------------------------------------------------------------
// Device flow
// ---------------------------------------------------------------------------

async function runDeviceFlow(apiUrl: string): Promise<string | null> {
  process.stderr.write(
    "\n  Attempting device authorization flow...\n",
  );

  // Step 1: Request device & user codes
  let deviceResp: { status: number; data: unknown };
  try {
    deviceResp = await postJson(`${apiUrl}/auth/device`, {
      client_id: "alterlab-mcp-server",
      scope: "api_key:create",
    });
  } catch (err) {
    process.stderr.write(
      `  Device flow unavailable (network error: ${String(err)})\n`,
    );
    return null;
  }

  if (deviceResp.status === 404) {
    // Backend endpoints not yet live — caller will fall back to manual paste
    process.stderr.write(
      "  Device flow not yet available on this server — falling back to manual entry.\n",
    );
    return null;
  }

  if (deviceResp.status !== 200) {
    process.stderr.write(
      `  Device flow returned unexpected status ${deviceResp.status} — falling back to manual entry.\n`,
    );
    return null;
  }

  const device = deviceResp.data as DeviceAuthResponse;
  if (!device.device_code || !device.user_code || !device.verification_url) {
    process.stderr.write(
      "  Device flow response missing required fields — falling back to manual entry.\n",
    );
    return null;
  }

  // Step 2: Show the user what to do
  const verifyUrl = device.verification_url_complete ?? device.verification_url;
  process.stderr.write(
    [
      "",
      "  ── AlterLab Authentication ─────────────────────────────",
      `  Open this link to authenticate:`,
      `  ${verifyUrl}`,
      "",
      `  Your device code: ${device.user_code}`,
      "  ──────────────────────────────────────────────────────────",
      "",
    ].join("\n"),
  );

  // Step 3: Open browser automatically
  openBrowser(verifyUrl);

  // Step 4: Poll /auth/token until success, expiry, or error
  const pollInterval = Math.max((device.interval ?? 5) * 1_000, 5_000);
  const expiresAt = Date.now() + (device.expires_in ?? 900) * 1_000;

  process.stderr.write("  Waiting for authentication");

  while (Date.now() < expiresAt) {
    await new Promise((r) => setTimeout(r, pollInterval));
    process.stderr.write(".");

    let tokenResp: { status: number; data: unknown };
    try {
      tokenResp = await postJson(`${apiUrl}/auth/token`, {
        client_id: "alterlab-mcp-server",
        device_code: device.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      });
    } catch {
      // Network hiccup — keep polling
      continue;
    }

    const tokenData = tokenResp.data as TokenResponse;

    if (tokenResp.status === 200 && "api_key" in tokenData) {
      process.stderr.write(" ✓\n\n");
      return (tokenData as TokenSuccessResponse).api_key;
    }

    if ("error" in tokenData) {
      const err = (tokenData as TokenPendingResponse | TokenErrorResponse).error;
      if (err === "authorization_pending") {
        continue;
      }
      if (err === "slow_down") {
        await new Promise((r) => setTimeout(r, pollInterval));
        continue;
      }
      // expired_token, access_denied, or unknown error
      process.stderr.write(
        `\n  Authentication failed: ${err}\n`,
      );
      return null;
    }
  }

  process.stderr.write("\n  Authentication timed out.\n");
  return null;
}

// ---------------------------------------------------------------------------
// Manual paste fallback
// ---------------------------------------------------------------------------

function promptForApiKey(): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr, // write prompt to stderr
      terminal: false,
    });

    process.stderr.write(
      [
        "",
        "  ── AlterLab API Key Setup ─────────────────────────────",
        "  Get your API key at: https://alterlab.io/dashboard/api-keys",
        "",
        "  Paste your API key: ",
      ].join("\n"),
    );

    rl.once("line", (line) => {
      rl.close();
      resolve(line.trim());
    });
  });
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

/**
 * Ensure a valid AlterLab API key is available and return a Config object.
 *
 * Resolution order:
 *   1. ALTERLAB_API_KEY environment variable
 *   2. ~/.alterlab/config.json
 *   3. Interactive auth (only when running in a TTY):
 *      a. OAuth 2.0 Device Authorization Grant flow
 *      b. Manual API key paste (fallback)
 *
 * When not running in a TTY (e.g., as an MCP server subprocess), emits a
 * helpful error on stderr and exits with code 1 if no key is found.
 */
export async function ensureAuth(): Promise<Config> {
  // 1. Environment variable (highest priority — existing behavior)
  const envConfig = loadConfig();
  if (envConfig) {
    return envConfig;
  }

  // 2. Config file
  const fileConfig = loadConfigFromFile();
  if (fileConfig) {
    return fileConfig;
  }

  const apiUrl = getApiUrl();

  // 3. Interactive auth — only possible in a TTY
  if (!process.stdin.isTTY) {
    process.stderr.write(
      [
        "",
        "  Error: No API key found for AlterLab MCP Server.",
        "",
        "  Add your API key to your MCP client config:",
        '    "env": { "ALTERLAB_API_KEY": "sk_live_..." }',
        "",
        "  Or run the server interactively once to authenticate:",
        "    npx -y alterlab-mcp-server",
        "",
        "  Get your API key at: https://alterlab.io/dashboard/api-keys",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  // Running interactively — show welcome banner
  process.stderr.write(
    [
      "",
      "  ╔══════════════════════════════════════════════════════╗",
      "  ║  AlterLab MCP Server — First Run Setup              ║",
      "  ╚══════════════════════════════════════════════════════╝",
      "",
      "  No API key found. Let's get you authenticated.",
      "",
    ].join("\n"),
  );

  // 3a. Try device flow
  const deviceApiKey = await runDeviceFlow(apiUrl);

  let apiKey: string | null = deviceApiKey;

  // 3b. Fallback to manual paste if device flow failed or unavailable
  if (!apiKey) {
    apiKey = await promptForApiKey();
  }

  if (!apiKey) {
    process.stderr.write(
      "\n  Error: No API key provided. Exiting.\n\n",
    );
    process.exit(1);
  }

  // Persist for future runs
  try {
    saveConfigToFile(apiKey);
    process.stderr.write(
      `  ✓ API key saved to ~/.alterlab/config.json\n\n`,
    );
  } catch (err) {
    process.stderr.write(
      `  Warning: Could not save config file: ${String(err)}\n`,
    );
  }

  return { apiKey, apiUrl };
}
