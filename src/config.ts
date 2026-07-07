import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface Config {
  apiKey: string;
  apiUrl: string;
}

/** Path to the user-level AlterLab config file. */
export const CONFIG_FILE_PATH = path.join(
  os.homedir(),
  ".alterlab",
  "config.json",
);

/** Base API URL, respecting the ALTERLAB_API_URL override. */
export function getApiUrl(): string {
  return (
    process.env.ALTERLAB_API_URL?.replace(/\/+$/, "") ||
    "https://api.alterlab.io"
  );
}

/**
 * Load config from the user-level config file (~/.alterlab/config.json).
 * Returns null if the file does not exist or does not contain a valid apiKey.
 */
export function loadConfigFromFile(): Config | null {
  try {
    if (!fs.existsSync(CONFIG_FILE_PATH)) {
      return null;
    }
    const raw = fs.readFileSync(CONFIG_FILE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.apiKey === "string" && parsed.apiKey.length > 0) {
      return { apiKey: parsed.apiKey, apiUrl: getApiUrl() };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Save the API key to the user-level config file (~/.alterlab/config.json).
 * Creates the directory if it does not exist.
 * File is written with mode 0o600 (owner read/write only).
 */
export function saveConfigToFile(apiKey: string): void {
  const dir = path.dirname(CONFIG_FILE_PATH);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const content = JSON.stringify({ apiKey, apiUrl: getApiUrl() }, null, 2);
  fs.writeFileSync(CONFIG_FILE_PATH, content, { encoding: "utf-8", mode: 0o600 });
}

/**
 * Load config from environment variable only.
 * Returns null instead of exiting when the key is absent —
 * callers use ensureAuth() for the full fallback chain.
 */
export function loadConfig(): Config | null {
  const apiKey = process.env.ALTERLAB_API_KEY;
  if (!apiKey) {
    return null;
  }
  return { apiKey, apiUrl: getApiUrl() };
}
