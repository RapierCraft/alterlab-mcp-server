/**
 * Per-user OAuth state: the registered client and the current tokens, keyed by
 * the MCP resource they belong to. The directory is 0700 and the file 0600
 * (POSIX; Windows ignores modes and relies on the profile's ACLs). The file is
 * replaced atomically so a concurrent reader never sees a half-written token.
 *
 * Nothing here logs; callers must never print an entry.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomBytes } from "crypto";

export interface StoredOAuthEntry {
  issuer: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  token_endpoint: string;
  revocation_endpoint?: string;
  access_token?: string;
  refresh_token?: string;
  /** Epoch milliseconds. */
  expires_at?: number;
}

interface StoreFile {
  version: 1;
  entries: Record<string, StoredOAuthEntry>;
}

export const TOKEN_FILE_NAME = "oauth.json";

/** `ALTERLAB_CONFIG_DIR`, else `~/.alterlab` (the directory the API key config already uses). */
export function defaultConfigDir(): string {
  return process.env.ALTERLAB_CONFIG_DIR || path.join(os.homedir(), ".alterlab");
}

export class TokenStore {
  readonly file: string;

  constructor(readonly dir: string = defaultConfigDir()) {
    this.file = path.join(dir, TOKEN_FILE_NAME);
  }

  private ensureDir(): void {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      // mkdir's mode is masked by umask and ignored for an existing directory.
      try {
        if ((fs.statSync(this.dir).mode & 0o077) !== 0) fs.chmodSync(this.dir, 0o700);
      } catch {
        /* best effort */
      }
    }
  }

  private readFile(): StoreFile {
    try {
      const raw = fs.readFileSync(this.file, "utf-8");
      const parsed = JSON.parse(raw) as Partial<StoreFile>;
      if (parsed && parsed.version === 1 && parsed.entries && typeof parsed.entries === "object") {
        return { version: 1, entries: parsed.entries };
      }
    } catch {
      /* missing or unreadable: start empty */
    }
    return { version: 1, entries: {} };
  }

  private writeFile(data: StoreFile): void {
    this.ensureDir();
    const tmp = path.join(this.dir, `.${TOKEN_FILE_NAME}.${randomBytes(6).toString("hex")}.tmp`);
    const fd = fs.openSync(tmp, "wx", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(data, null, 2));
      if (process.platform !== "win32") fs.fchmodSync(fd, 0o600);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.file);
  }

  get(resource: string): StoredOAuthEntry | null {
    if (process.platform !== "win32") {
      try {
        if ((fs.statSync(this.file).mode & 0o077) !== 0) fs.chmodSync(this.file, 0o600);
      } catch {
        /* no file yet */
      }
    }
    return this.readFile().entries[resource] ?? null;
  }

  set(resource: string, entry: StoredOAuthEntry): void {
    const data = this.readFile();
    data.entries[resource] = entry;
    this.writeFile(data);
  }

  delete(resource: string): void {
    const data = this.readFile();
    if (!(resource in data.entries)) return;
    delete data.entries[resource];
    this.writeFile(data);
  }
}
