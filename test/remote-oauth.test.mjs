// Remote mode: PKCE, discovery, loopback flow, token storage, refresh.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";

import { codeChallengeS256, generateCodeVerifier, generateState } from "../dist/remote/pkce.js";
import {
  parseResourceMetadata,
  authorizationServerMetadataUrl,
  discoverOAuth,
  DiscoveryError,
} from "../dist/remote/discovery.js";
import { TokenStore } from "../dist/remote/token-store.js";
import { OAuthSession, OAuthError, startLoopback, parseOAuthError } from "../dist/remote/oauth.js";
import { MockHosted, browserThatApproves } from "./helpers/mock-hosted.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "alterlab-mcp-test-"));
const mode = (p) => fs.statSync(p).mode & 0o777;
const posix = process.platform !== "win32";

function session(mock, dir, extra = {}) {
  return new OAuthSession({
    mcpUrl: mock.mcpUrl,
    store: new TokenStore(dir),
    softwareVersion: "test",
    openUrl: browserThatApproves(),
    loginTimeoutMs: 5000,
    ...extra,
  });
}

// ---- PKCE ------------------------------------------------------------------

test("PKCE: RFC 7636 appendix B vector and generated shapes", () => {
  assert.equal(
    codeChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
  const v = generateCodeVerifier();
  assert.match(v, /^[A-Za-z0-9_-]{43}$/);
  assert.match(codeChallengeS256(v), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(codeChallengeS256(v), createHash("sha256").update(v).digest("base64url"));
  assert.notEqual(generateCodeVerifier(), generateCodeVerifier());
  assert.notEqual(generateState(), generateState());
});

// ---- Discovery -------------------------------------------------------------

test("discovery: parses resource_metadata from the Bearer challenge", () => {
  assert.equal(
    parseResourceMetadata('Bearer resource_metadata="https://mcp.alterlab.io/.well-known/oauth-protected-resource"'),
    "https://mcp.alterlab.io/.well-known/oauth-protected-resource",
  );
  assert.equal(
    parseResourceMetadata('Bearer error="invalid_token", resource_metadata="https://x/y"'),
    "https://x/y",
  );
  assert.equal(parseResourceMetadata('Bearer realm="x"'), null);
  assert.equal(parseResourceMetadata(null), null);
});

test("discovery: RFC 8414 well-known URL inserts the issuer path", () => {
  assert.equal(
    authorizationServerMetadataUrl("https://api.alterlab.io"),
    "https://api.alterlab.io/.well-known/oauth-authorization-server",
  );
  assert.equal(
    authorizationServerMetadataUrl("https://h.example/tenant1"),
    "https://h.example/.well-known/oauth-authorization-server/tenant1",
  );
});

test("discovery: 401 challenge -> protected resource -> authorization server", async () => {
  const mock = await new MockHosted().start();
  try {
    const probe = await fetch(mock.mcpUrl, { method: "POST", body: "{}" });
    assert.equal(probe.status, 401);
    const disc = await discoverOAuth(mock.mcpUrl, probe.headers.get("www-authenticate"));
    assert.equal(disc.resource, mock.mcpUrl);
    assert.equal(disc.issuer, mock.base);
    assert.equal(disc.registrationEndpoint, `${mock.base}/api/v1/oauth/register`);
    assert.equal(disc.revocationEndpoint, `${mock.base}/api/v1/oauth/revoke`);
    assert.deepEqual(disc.scopesSupported, ["account:read", "billing:read", "scrape"]);
    // Without a challenge, the standard well-known location is used.
    assert.equal((await discoverOAuth(mock.mcpUrl, null)).issuer, mock.base);
  } finally {
    await mock.stop();
  }
});

test("discovery: refuses a protected-resource document for another resource", async () => {
  const mock = await new MockHosted().start();
  try {
    await assert.rejects(
      discoverOAuth(`${mock.base}/other`, null),
      (e) => e instanceof DiscoveryError && /not .*\/other/.test(e.message),
    );
  } finally {
    await mock.stop();
  }
});

test("discovery: refuses non-https remote URLs", async () => {
  await assert.rejects(discoverOAuth("http://mcp.example.com/mcp", null), DiscoveryError);
});

// ---- Loopback listener -----------------------------------------------------

test("loopback: binds 127.0.0.1 on a random port and returns the code", async () => {
  const l = await startLoopback("st4te");
  try {
    assert.ok(l.port > 0);
    assert.equal(l.redirectUri, `http://127.0.0.1:${l.port}/callback`);
    const wait = l.waitForCode(2000);
    const r = await fetch(`${l.redirectUri}?code=abc&state=st4te`);
    assert.equal(r.status, 200);
    assert.equal(await wait, "abc");
  } finally {
    l.close();
  }
});

test("loopback: ignores a wrong state, rejects on error=access_denied", async () => {
  const l = await startLoopback("good");
  try {
    const wait = l.waitForCode(2000);
    const settled = assert.rejects(wait, (e) => e instanceof OAuthError && e.code === "access_denied");
    const bad = await fetch(`${l.redirectUri}?code=evil&state=bad`);
    assert.equal(bad.status, 400);
    const other = await fetch(`http://127.0.0.1:${l.port}/elsewhere`);
    assert.equal(other.status, 404);
    await fetch(`${l.redirectUri}?error=access_denied&state=good`);
    await settled;
  } finally {
    l.close();
  }
});

test("loopback: times out, and prefers a given free port", async () => {
  const first = await startLoopback("s");
  const port = first.port;
  first.close();
  await new Promise((r) => setTimeout(r, 20));
  const again = await startLoopback("s", port);
  try {
    assert.equal(again.port, port);
    await assert.rejects(again.waitForCode(30), (e) => e.code === "timeout");
  } finally {
    again.close();
  }
});

test("loopback: falls back to a random port when the preferred one is taken", async () => {
  const blocker = http.createServer().listen(0, "127.0.0.1");
  await new Promise((r) => blocker.once("listening", r));
  const taken = blocker.address().port;
  const l = await startLoopback("s", taken);
  try {
    assert.notEqual(l.port, taken);
  } finally {
    l.close();
    blocker.close();
  }
});

// ---- Token store -----------------------------------------------------------

test("token store: file is 0600, directory 0700, round-trips and deletes", { skip: !posix }, () => {
  const parent = tmp();
  const dir = path.join(parent, "cfg");
  const store = new TokenStore(dir);
  store.set("r", { issuer: "i", client_id: "c", redirect_uri: "u", scope: "scrape", token_endpoint: "t", access_token: "a", refresh_token: "rt", expires_at: 1 });
  assert.equal(mode(dir), 0o700);
  assert.equal(mode(store.file), 0o600);
  assert.equal(store.get("r").access_token, "a");
  assert.deepEqual(fs.readdirSync(dir), ["oauth.json"], "no temp files left behind");
  store.delete("r");
  assert.equal(store.get("r"), null);
});

test("token store: tightens a pre-existing world-readable directory and file", { skip: !posix }, () => {
  const dir = tmp();
  fs.chmodSync(dir, 0o755);
  const store = new TokenStore(dir);
  store.set("r", { issuer: "i", client_id: "c", redirect_uri: "u", scope: "s", token_endpoint: "t" });
  assert.equal(mode(dir), 0o700);
  fs.chmodSync(store.file, 0o644);
  store.get("r");
  assert.equal(mode(store.file), 0o600);
});

// ---- Full flow, refresh, revoke -------------------------------------------

test("login: register, PKCE authorize through the browser, exchange, persist 0600", async () => {
  const mock = await new MockHosted().start();
  const dir = tmp();
  const logs = [];
  try {
    const s = session(mock, dir, { log: (m) => logs.push(m) });
    const token = await s.getAccessToken();
    assert.match(token, /^alo_at_/);
    assert.equal(mock.registrations, 1);
    const ex = mock.tokenRequests[0];
    assert.equal(ex.grant_type, "authorization_code");
    assert.equal(ex.resource, mock.mcpUrl, "token is bound to the MCP resource");
    assert.equal(ex.client_id.length > 10, true);
    assert.equal(ex.client_secret, undefined, "public client sends no secret");

    const stored = new TokenStore(dir).get(mock.mcpUrl);
    assert.equal(stored.access_token, token);
    assert.match(stored.refresh_token, /^alo_rt_/);
    assert.match(stored.redirect_uri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    if (posix) assert.equal(mode(new TokenStore(dir).file), 0o600);

    const logged = logs.join("\n");
    assert.ok(!logged.includes(token), "access token must not be logged");
    assert.ok(!logged.includes(stored.refresh_token), "refresh token must not be logged");
    assert.ok(!logged.includes(ex.code), "authorization code must not be logged");
    assert.ok(!logged.includes(ex.code_verifier), "PKCE verifier must not be logged");
  } finally {
    await mock.stop();
  }
});

test("persistence: a second run reuses stored tokens with no browser and no network auth", async () => {
  const mock = await new MockHosted().start();
  const dir = tmp();
  try {
    const first = await session(mock, dir).getAccessToken();
    let opened = 0;
    const s2 = session(mock, dir, { openUrl: () => opened++ });
    assert.equal(await s2.getAccessToken(), first);
    assert.equal(opened, 0);
    assert.equal(mock.tokenRequests.length, 1);
  } finally {
    await mock.stop();
  }
});

test("refresh: expiry triggers a silent refresh and rotates the stored refresh token", async () => {
  const mock = await new MockHosted({ accessTtl: 3600 }).start();
  const dir = tmp();
  try {
    let now = Date.now();
    let opened = 0;
    const approve = browserThatApproves();
    const s = session(mock, dir, { now: () => now, openUrl: (u) => (opened++, approve(u)) });
    const first = await s.getAccessToken();
    assert.equal(opened, 1);
    const rt1 = new TokenStore(dir).get(mock.mcpUrl).refresh_token;
    now += 3600_000 - 30_000; // inside the 60 s skew
    const second = await s.getAccessToken();
    assert.notEqual(second, first);
    const stored = new TokenStore(dir).get(mock.mcpUrl);
    assert.notEqual(stored.refresh_token, rt1, "refresh token rotated");
    assert.equal(mock.tokenRequests.at(-1).grant_type, "refresh_token");
    assert.equal(mock.registrations, 1);
    assert.equal(opened, 1, "refresh needs no browser");
  } finally {
    await mock.stop();
  }
});

test("refresh: concurrent callers share one refresh request", async () => {
  const mock = await new MockHosted().start();
  const dir = tmp();
  try {
    const s = session(mock, dir);
    const t = await s.getAccessToken();
    mock.expireAccessTokens();
    const results = await Promise.all([1, 2, 3].map(() => s.onUnauthorized(t, null)));
    assert.equal(new Set(results).size, 1);
    assert.equal(mock.tokenRequests.filter((r) => r.grant_type === "refresh_token").length, 1);
  } finally {
    await mock.stop();
  }
});

test("refresh: a revoked grant falls back to a fresh authorization", async () => {
  const mock = await new MockHosted().start();
  const dir = tmp();
  try {
    const s = session(mock, dir);
    const t = await s.getAccessToken();
    for (const g of mock.refresh.values()) g.revoked = true;
    mock.expireAccessTokens();
    const t2 = await s.onUnauthorized(t, 'Bearer error="invalid_token", resource_metadata="' + mock.base + '/.well-known/oauth-protected-resource"');
    assert.notEqual(t2, t);
    assert.match(t2, /^alo_at_/);
  } finally {
    await mock.stop();
  }
});

test("refresh: adopts tokens another process already refreshed", async () => {
  const mock = await new MockHosted().start();
  const dir = tmp();
  try {
    const a = session(mock, dir);
    const b = session(mock, dir);
    const t = await a.getAccessToken();
    mock.expireAccessTokens();
    const fromB = await b.onUnauthorized(t, null); // B refreshes and rotates
    const fromA = await a.onUnauthorized(t, null); // A sees B's tokens on disk
    assert.equal(fromA, fromB);
    assert.equal(mock.tokenRequests.filter((r) => r.grant_type === "refresh_token").length, 1);
  } finally {
    await mock.stop();
  }
});

test("registration is reused across logins when the loopback port is still free", async () => {
  const mock = await new MockHosted().start();
  const dir = tmp();
  try {
    await session(mock, dir).getAccessToken();
    const store = new TokenStore(dir);
    const entry = store.get(mock.mcpUrl);
    // Force a new login but keep the stored client.
    store.set(mock.mcpUrl, { ...entry, access_token: undefined, refresh_token: undefined, expires_at: undefined });
    await session(mock, dir).getAccessToken();
    assert.equal(mock.registrations, 1);
  } finally {
    await mock.stop();
  }
});

test("logout: revokes the grant at the server and deletes local tokens", async () => {
  const mock = await new MockHosted().start();
  const dir = tmp();
  try {
    const s = session(mock, dir);
    await s.getAccessToken();
    const rt = new TokenStore(dir).get(mock.mcpUrl).refresh_token;
    assert.equal(await s.logout(), true);
    assert.ok(mock.revoked.has(rt));
    assert.equal(new TokenStore(dir).get(mock.mcpUrl), null);
    assert.equal(await s.logout(), false);
  } finally {
    await mock.stop();
  }
});

test("login: a user who declines surfaces access_denied; nothing is stored", async () => {
  const mock = await new MockHosted().start();
  const dir = tmp();
  try {
    const decline = (url) => {
      void (async () => {
        const r = await fetch(url, { redirect: "manual" });
        const back = new URL(r.headers.get("location"));
        back.searchParams.delete("code");
        back.searchParams.set("error", "access_denied");
        await fetch(back);
      })();
    };
    await assert.rejects(session(mock, dir, { openUrl: decline }).getAccessToken(), (e) => e.code === "access_denied");
    assert.equal(new TokenStore(dir).get(mock.mcpUrl), null);
  } finally {
    await mock.stop();
  }
});

test("parseOAuthError: RFC 6749 body and FastAPI detail wrapper", () => {
  assert.equal(parseOAuthError(400, '{"error":"invalid_grant"}').code, "invalid_grant");
  assert.equal(parseOAuthError(400, '{"detail":{"error":"invalid_target","error_description":"x"}}').code, "invalid_target");
  assert.equal(parseOAuthError(502, "<html>").code, "server_error");
});
