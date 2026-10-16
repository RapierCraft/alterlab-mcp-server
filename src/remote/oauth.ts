/**
 * OAuth 2.1 native-app flow against the AlterLab authorization server:
 * RFC 7591 registration as a public client with a loopback redirect, PKCE
 * (RFC 7636) authorization through the system browser, RFC 8707 resource
 * binding, refresh-token rotation and RFC 7009 revocation.
 *
 * Tokens and the authorization code never reach a log line: every message this
 * module emits is built from fixed text and non-secret identifiers.
 */

import * as http from "http";
import { execFile } from "child_process";
import { timingSafeEqual } from "crypto";
import {
  discoverOAuth,
  parseResourceMetadata,
  normalizeResource,
  type DiscoveredOAuth,
  type FetchLike,
} from "./discovery.js";
import { codeChallengeS256, generateCodeVerifier, generateState } from "./pkce.js";
import { TokenStore, type StoredOAuthEntry } from "./token-store.js";

export const DEFAULT_SCOPE = "scrape";
const REFRESH_SKEW_MS = 60_000;
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const CLIENT_NAME = "AlterLab MCP Server (stdio)";

export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

/** Parse an RFC 6749 error body, tolerating FastAPI's `{"detail": {...}}` wrapper. */
export function parseOAuthError(status: number, text: string): OAuthError {
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  const inner = body && typeof body.detail === "object" && body.detail ? body.detail : body;
  const code = typeof inner?.error === "string" ? inner.error.slice(0, 64) : "server_error";
  const description =
    typeof inner?.error_description === "string" ? inner.error_description.slice(0, 300) : "";
  return new OAuthError(code, `${code}${description ? `: ${description}` : ""} (HTTP ${status})`, status);
}

// ---------------------------------------------------------------------------
// Loopback redirect listener
// ---------------------------------------------------------------------------

export interface LoopbackListener {
  port: number;
  redirectUri: string;
  /** Resolves with the authorization code once the browser lands on the redirect. */
  waitForCode(timeoutMs: number): Promise<string>;
  close(): void;
}

const PAGE = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">` +
  `<h1>${title}</h1><p>${body}</p></body>`;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Listen on 127.0.0.1 only. `preferredPort` (the port a stored client was
 * registered with) is tried first; otherwise the OS picks a random free port.
 */
export async function startLoopback(
  expectedState: string,
  preferredPort?: number,
): Promise<LoopbackListener> {
  let resolveCode!: (code: string) => void;
  let rejectCode!: (err: Error) => void;
  const codePromise = new Promise<string>((res, rej) => {
    resolveCode = res;
    rejectCode = rej;
  });
  codePromise.catch(() => undefined); // surfaced through waitForCode

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method !== "GET" || url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    const state = url.searchParams.get("state") ?? "";
    if (!safeEqual(state, expectedState)) {
      // Not our request (stale tab, probe): do not end the flow.
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(PAGE("Invalid request", "The state parameter did not match. Return to your terminal."));
      return;
    }
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    res.writeHead(error || !code ? 400 : 200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    if (error || !code) {
      res.end(PAGE("Authorization failed", "You can close this tab and retry from your MCP client."));
      rejectCode(
        new OAuthError(
          (error ?? "invalid_request").slice(0, 64),
          `Authorization was not granted: ${(error ?? "no code returned").slice(0, 64)}`,
        ),
      );
    } else {
      res.end(PAGE("AlterLab connected", "You can close this tab and return to your MCP client."));
      resolveCode(code);
    }
  });

  const listen = (port: number) =>
    new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      server.once("error", onError);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", onError);
        resolve();
      });
    });

  try {
    await listen(preferredPort ?? 0);
  } catch (err) {
    if (preferredPort === undefined) throw err;
    await listen(0);
  }
  const port = (server.address() as { port: number }).port;

  return {
    port,
    redirectUri: `http://127.0.0.1:${port}/callback`,
    waitForCode(timeoutMs: number) {
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new OAuthError("timeout", "Timed out waiting for browser authorization")),
          timeoutMs,
        );
        codePromise.then(
          (code) => {
            clearTimeout(timer);
            resolve(code);
          },
          (err) => {
            clearTimeout(timer);
            reject(err);
          },
        );
      });
    },
    close() {
      server.close();
      server.closeAllConnections?.();
    },
  };
}

/** Open `url` in the user's default browser. Never throws; the URL is also printed. */
export function openBrowser(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
  const done = () => undefined;
  if (process.platform === "darwin") execFile("open", [url], done);
  else if (process.platform === "win32") {
    execFile("rundll32", ["url.dll,FileProtocolHandler", url], done);
  } else execFile("xdg-open", [url], done);
}

// ---------------------------------------------------------------------------
// Protocol steps
// ---------------------------------------------------------------------------

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

async function postForm(
  fetchImpl: FetchLike,
  url: string,
  form: Record<string, string>,
): Promise<{ status: number; text: string }> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(form).toString(),
    redirect: "error",
  });
  return { status: res.status, text: await res.text() };
}

function parseTokenSet(text: string): TokenSet {
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    throw new OAuthError("server_error", "Token endpoint returned a non-JSON response");
  }
  if (typeof body?.access_token !== "string" || !body.access_token) {
    throw new OAuthError("server_error", "Token endpoint response has no access_token");
  }
  const expiresIn = Number(body.expires_in);
  return {
    access_token: body.access_token,
    refresh_token: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
    expires_in: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600,
    scope: typeof body.scope === "string" ? body.scope : undefined,
  };
}

/** RFC 7591: register a native public client with one loopback redirect URI. */
export async function registerClient(
  fetchImpl: FetchLike,
  disc: DiscoveredOAuth,
  redirectUri: string,
  scope: string,
  softwareVersion: string,
): Promise<string> {
  const res = await fetchImpl(disc.registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      application_type: "native",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope,
      software_id: "alterlab-mcp-server",
      software_version: softwareVersion,
    }),
    redirect: "error",
  });
  const text = await res.text();
  if (res.status !== 201 && res.status !== 200) throw parseOAuthError(res.status, text);
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    throw new OAuthError("server_error", "Registration endpoint returned a non-JSON response");
  }
  if (typeof body?.client_id !== "string" || !body.client_id) {
    throw new OAuthError("server_error", "Registration response has no client_id");
  }
  return body.client_id;
}

export function buildAuthorizeUrl(
  disc: DiscoveredOAuth,
  p: { clientId: string; redirectUri: string; state: string; scope: string; challenge: string },
): string {
  const url = new URL(disc.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", p.clientId);
  url.searchParams.set("redirect_uri", p.redirectUri);
  url.searchParams.set("state", p.state);
  url.searchParams.set("scope", p.scope);
  url.searchParams.set("code_challenge", p.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  // RFC 8707: the hosted endpoint rejects tokens that are not bound to it.
  url.searchParams.set("resource", disc.resource);
  return url.toString();
}

export async function exchangeCode(
  fetchImpl: FetchLike,
  tokenEndpoint: string,
  p: { clientId: string; code: string; redirectUri: string; verifier: string; resource: string },
): Promise<TokenSet> {
  const { status, text } = await postForm(fetchImpl, tokenEndpoint, {
    grant_type: "authorization_code",
    code: p.code,
    redirect_uri: p.redirectUri,
    client_id: p.clientId,
    code_verifier: p.verifier,
    resource: p.resource,
  });
  if (status !== 200) throw parseOAuthError(status, text);
  return parseTokenSet(text);
}

export async function refreshTokens(
  fetchImpl: FetchLike,
  tokenEndpoint: string,
  p: { clientId: string; refreshToken: string },
): Promise<TokenSet> {
  const { status, text } = await postForm(fetchImpl, tokenEndpoint, {
    grant_type: "refresh_token",
    refresh_token: p.refreshToken,
    client_id: p.clientId,
  });
  if (status !== 200) throw parseOAuthError(status, text);
  return parseTokenSet(text);
}

// ---------------------------------------------------------------------------
// Session: owns the stored state and decides when to refresh or re-authorize
// ---------------------------------------------------------------------------

export interface OAuthSessionOptions {
  mcpUrl: string;
  scope?: string;
  store: TokenStore;
  softwareVersion: string;
  fetchImpl?: FetchLike;
  openUrl?: (url: string) => void;
  log?: (message: string) => void;
  now?: () => number;
  loginTimeoutMs?: number;
}

export class OAuthSession {
  private readonly resource: string;
  private readonly scope: string;
  private readonly fetchImpl: FetchLike;
  private readonly openUrl: (url: string) => void;
  private readonly log: (message: string) => void;
  private readonly now: () => number;
  private readonly loginTimeoutMs: number;
  private inflight: Promise<string> | null = null;

  constructor(private readonly opts: OAuthSessionOptions) {
    this.resource = normalizeResource(opts.mcpUrl);
    this.scope = opts.scope?.trim() || DEFAULT_SCOPE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.openUrl = opts.openUrl ?? openBrowser;
    this.log = opts.log ?? (() => undefined);
    this.now = opts.now ?? Date.now;
    this.loginTimeoutMs = opts.loginTimeoutMs ?? LOGIN_TIMEOUT_MS;
  }

  /** A valid access token: stored, refreshed, or newly authorized. */
  getAccessToken(): Promise<string> {
    const entry = this.opts.store.get(this.resource);
    if (entry?.access_token && (entry.expires_at ?? 0) - this.now() > REFRESH_SKEW_MS) {
      return Promise.resolve(entry.access_token);
    }
    return this.single(() => this.renew(undefined, undefined));
  }

  /**
   * The server rejected `rejected` (401): get a different token. `challenge` is
   * the `WWW-Authenticate` value of that 401, used if a new login is needed.
   */
  onUnauthorized(rejected: string | undefined, challenge: string | null): Promise<string> {
    return this.single(() => this.renew(rejected, challenge));
  }

  private single(fn: () => Promise<string>): Promise<string> {
    if (!this.inflight) {
      this.inflight = fn().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async renew(rejected: string | undefined, challenge: string | null | undefined) {
    let entry = this.opts.store.get(this.resource);
    // Another process (a second MCP client) may already have refreshed.
    if (
      entry?.access_token &&
      entry.access_token !== rejected &&
      (entry.expires_at ?? 0) - this.now() > REFRESH_SKEW_MS
    ) {
      return entry.access_token;
    }
    if (entry?.refresh_token) {
      try {
        return await this.refresh(entry);
      } catch (err) {
        if (!(err instanceof OAuthError) || err.code !== "invalid_grant") {
          if (
            entry.access_token &&
            entry.access_token !== rejected &&
            (entry.expires_at ?? 0) > this.now()
          ) {
            return entry.access_token;
          }
          throw err;
        }
        // Refresh rotation race with another process: its tokens are on disk now.
        entry = this.opts.store.get(this.resource);
        if (
          entry?.access_token &&
          entry.access_token !== rejected &&
          (entry.expires_at ?? 0) - this.now() > REFRESH_SKEW_MS
        ) {
          return entry.access_token;
        }
        this.log("Saved AlterLab authorization is no longer valid; signing in again.");
      }
    }
    return this.login(challenge);
  }

  private async refresh(entry: StoredOAuthEntry): Promise<string> {
    const tokens = await refreshTokens(this.fetchImpl, entry.token_endpoint, {
      clientId: entry.client_id,
      refreshToken: entry.refresh_token!,
    });
    this.save(entry, tokens);
    return tokens.access_token;
  }

  private save(base: StoredOAuthEntry, tokens: TokenSet, extra: Partial<StoredOAuthEntry> = {}) {
    this.opts.store.set(this.resource, {
      ...base,
      ...extra,
      scope: tokens.scope ?? base.scope,
      access_token: tokens.access_token,
      // RFC 6749 §6: keep the old refresh token if the server did not rotate it.
      refresh_token: tokens.refresh_token ?? base.refresh_token,
      expires_at: this.now() + tokens.expires_in * 1000,
    });
  }

  /** An unauthenticated request to learn the RFC 9728 challenge. */
  private async probeChallenge(): Promise<string | null> {
    try {
      const res = await this.fetchImpl(this.opts.mcpUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "ping" }),
        redirect: "error",
      });
      await res.arrayBuffer().catch(() => undefined);
      return res.status === 401 ? res.headers.get("www-authenticate") : null;
    } catch {
      return null;
    }
  }

  /** Full interactive authorization. Single-flight through `single()`. */
  async login(challenge?: string | null): Promise<string> {
    const header = challenge && parseResourceMetadata(challenge) ? challenge : await this.probeChallenge();
    const disc = await discoverOAuth(this.opts.mcpUrl, header, this.fetchImpl);

    const stored = this.opts.store.get(this.resource);
    const reusable = stored && stored.issuer === disc.issuer ? stored : null;
    let preferredPort: number | undefined;
    if (reusable) {
      try {
        preferredPort = Number(new URL(reusable.redirect_uri).port) || undefined;
      } catch {
        preferredPort = undefined;
      }
    }

    const state = generateState();
    const verifier = generateCodeVerifier();
    const loopback = await startLoopback(state, preferredPort);
    try {
      let clientId: string;
      if (reusable && reusable.redirect_uri === loopback.redirectUri) {
        clientId = reusable.client_id;
      } else {
        this.log("Registering with the AlterLab authorization server.");
        clientId = await registerClient(
          this.fetchImpl,
          disc,
          loopback.redirectUri,
          this.scope,
          this.opts.softwareVersion,
        );
      }

      const authorizeUrl = buildAuthorizeUrl(disc, {
        clientId,
        redirectUri: loopback.redirectUri,
        state,
        scope: this.scope,
        challenge: codeChallengeS256(verifier),
      });
      this.log(
        `Opening your browser to authorize AlterLab. If it does not open, visit:\n  ${authorizeUrl}`,
      );
      this.openUrl(authorizeUrl);

      let code: string;
      try {
        code = await loopback.waitForCode(this.loginTimeoutMs);
      } catch (err) {
        // The registration may be what the server refused (it shows the error in
        // the browser, not on the redirect): register afresh next time.
        if (err instanceof OAuthError && err.code === "timeout") this.forgetClient();
        throw err;
      }
      const tokens = await exchangeCode(this.fetchImpl, disc.tokenEndpoint, {
        clientId,
        code,
        redirectUri: loopback.redirectUri,
        verifier,
        resource: disc.resource,
      });
      const base: StoredOAuthEntry = {
        issuer: disc.issuer,
        client_id: clientId,
        redirect_uri: loopback.redirectUri,
        scope: this.scope,
        token_endpoint: disc.tokenEndpoint,
        revocation_endpoint: disc.revocationEndpoint,
      };
      this.save(base, tokens);
      this.log("AlterLab authorization complete.");
      return tokens.access_token;
    } finally {
      loopback.close();
    }
  }

  private forgetClient(): void {
    const entry = this.opts.store.get(this.resource);
    // Keep a working token pair; only an entry with no tokens is just a stale client.
    if (entry && !entry.access_token && !entry.refresh_token) {
      this.opts.store.delete(this.resource);
    }
  }

  /** Interactive login for the `--login` command. */
  loginNow(): Promise<string> {
    return this.single(() => this.login(null));
  }

  /** Revoke the grant at the server (best effort) and delete local state. */
  async logout(): Promise<boolean> {
    const entry = this.opts.store.get(this.resource);
    if (!entry) return false;
    const token = entry.refresh_token ?? entry.access_token;
    if (token && entry.revocation_endpoint) {
      try {
        await postForm(this.fetchImpl, entry.revocation_endpoint, {
          token,
          token_type_hint: entry.refresh_token ? "refresh_token" : "access_token",
          client_id: entry.client_id,
        });
      } catch {
        this.log("Could not reach the server to revoke the grant; removing local tokens only.");
      }
    }
    this.opts.store.delete(this.resource);
    return true;
  }
}
