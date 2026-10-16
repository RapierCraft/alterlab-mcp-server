// A minimal stand-in for mcp.alterlab.io + the AlterLab authorization server.
// It enforces the same rules the real one does for the pieces the bridge uses:
// 401 + RFC 9728 challenge, exact-match loopback redirect URIs, S256 PKCE,
// RFC 8707 resource binding, refresh rotation and revocation.
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";

const b64 = () => randomBytes(24).toString("base64url");

export class MockHosted {
  constructor({ accessTtl = 3600 } = {}) {
    this.accessTtl = accessTtl;
    this.clients = new Map(); // client_id -> {redirect_uris}
    this.codes = new Map();
    this.access = new Map(); // token -> {exp, grant, resource}
    this.refresh = new Map(); // token -> grant
    this.revoked = new Set();
    this.sessions = new Set();
    this.apiKey = "sk_test_key";
    this.log = []; // {method, path, auth}
    this.registrations = 0;
    this.tokenRequests = [];
    this.nextToolCallDelayMs = 0;
  }

  async start() {
    this.server = http.createServer((req, res) => this.route(req, res));
    await new Promise((r) => this.server.listen(0, "127.0.0.1", r));
    this.base = `http://127.0.0.1:${this.server.address().port}`;
    this.mcpUrl = `${this.base}/mcp`;
    return this;
  }
  stop() {
    this.server.closeAllConnections?.();
    return new Promise((r) => this.server.close(r));
  }

  json(res, status, body, headers = {}) {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  }
  async body(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return Buffer.concat(chunks).toString();
  }

  expireAccessTokens() {
    for (const v of this.access.values()) v.exp = 0;
  }

  issue(grant, resource) {
    const access = `alo_at_${b64()}`;
    const refresh = `alo_rt_${b64()}`;
    this.access.set(access, { exp: Date.now() + this.accessTtl * 1000, grant, resource });
    this.refresh.set(refresh, grant);
    grant.refresh = refresh;
    return { access_token: access, token_type: "bearer", expires_in: this.accessTtl, refresh_token: refresh, scope: grant.scope };
  }

  authed(req) {
    const h = req.headers.authorization ?? "";
    const token = h.replace(/^Bearer /i, "");
    if (token === this.apiKey) return { kind: "api_key" };
    const rec = this.access.get(token);
    if (!rec || rec.exp <= Date.now() || rec.grant.revoked) return null;
    if (rec.resource !== this.mcpUrl) return null;
    return { kind: "oauth", grant: rec.grant };
  }

  async route(req, res) {
    const url = new URL(req.url, this.base);
    this.log.push({ method: req.method, path: url.pathname, auth: req.headers.authorization });
    const p = url.pathname;
    if (p === "/.well-known/oauth-protected-resource") {
      return this.json(res, 200, {
        resource: this.mcpUrl,
        authorization_servers: [this.base],
        scopes_supported: ["account:read", "billing:read", "scrape"],
        bearer_methods_supported: ["header"],
      });
    }
    if (p === "/.well-known/oauth-authorization-server") {
      return this.json(res, 200, {
        issuer: this.base,
        authorization_endpoint: `${this.base}/api/v1/oauth/authorize`,
        token_endpoint: `${this.base}/api/v1/oauth/token`,
        registration_endpoint: `${this.base}/api/v1/oauth/register`,
        revocation_endpoint: `${this.base}/api/v1/oauth/revoke`,
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (p === "/api/v1/oauth/register") return this.register(req, res);
    if (p === "/api/v1/oauth/authorize") return this.authorize(url, res);
    if (p === "/api/v1/oauth/token") return this.token(req, res);
    if (p === "/api/v1/oauth/revoke") return this.revoke(req, res);
    if (p === "/mcp") return this.mcp(req, res);
    res.writeHead(404).end();
  }

  async register(req, res) {
    const meta = JSON.parse(await this.body(req));
    if (meta.application_type !== "native" || meta.token_endpoint_auth_method !== "none") {
      return this.json(res, 400, { error: "invalid_client_metadata" });
    }
    const uri = meta.redirect_uris?.[0];
    if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(uri)) return this.json(res, 400, { error: "invalid_redirect_uri" });
    const client_id = b64();
    this.registrations++;
    this.clients.set(client_id, { redirect_uris: meta.redirect_uris, scope: meta.scope });
    this.json(res, 201, { client_id, ...meta });
  }

  // Stands in for the browser-facing authorize + consent: approves immediately.
  authorize(url, res) {
    const q = url.searchParams;
    const client = this.clients.get(q.get("client_id"));
    if (!client || !client.redirect_uris.includes(q.get("redirect_uri"))) {
      return this.json(res, 400, { error: "invalid_request" });
    }
    if (q.get("code_challenge_method") !== "S256" || q.get("response_type") !== "code") {
      return this.json(res, 400, { error: "invalid_request" });
    }
    const code = b64();
    this.codes.set(code, {
      client_id: q.get("client_id"),
      redirect_uri: q.get("redirect_uri"),
      challenge: q.get("code_challenge"),
      resource: q.get("resource"),
      scope: q.get("scope"),
    });
    const back = new URL(q.get("redirect_uri"));
    back.searchParams.set("code", code);
    back.searchParams.set("state", q.get("state"));
    res.writeHead(302, { Location: back.toString() }).end();
  }

  async token(req, res) {
    const form = new URLSearchParams(await this.body(req));
    this.tokenRequests.push(Object.fromEntries(form));
    const err = (error) => this.json(res, 400, { detail: { error, error_description: "x" } });
    if (form.get("grant_type") === "authorization_code") {
      const rec = this.codes.get(form.get("code"));
      this.codes.delete(form.get("code"));
      if (!rec || rec.client_id !== form.get("client_id") || rec.redirect_uri !== form.get("redirect_uri")) return err("invalid_grant");
      const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
      if (challenge !== rec.challenge) return err("invalid_grant");
      if (form.get("resource") !== rec.resource) return err("invalid_target");
      const grant = { client_id: rec.client_id, scope: rec.scope, resource: rec.resource, revoked: false };
      return this.json(res, 200, this.issue(grant, rec.resource));
    }
    if (form.get("grant_type") === "refresh_token") {
      const rt = form.get("refresh_token");
      const grant = this.refresh.get(rt);
      if (!grant || grant.revoked || grant.client_id !== form.get("client_id") || grant.refresh !== rt) return err("invalid_grant");
      this.refresh.delete(rt);
      return this.json(res, 200, this.issue(grant, grant.resource));
    }
    err("unsupported_grant_type");
  }

  async revoke(req, res) {
    const form = new URLSearchParams(await this.body(req));
    const token = form.get("token");
    const grant = this.refresh.get(token) ?? this.access.get(token)?.grant;
    if (grant) grant.revoked = true;
    this.revoked.add(token);
    res.writeHead(200).end();
  }

  async mcp(req, res) {
    if (req.method === "DELETE") {
      this.sessions.delete(req.headers["mcp-session-id"]);
      return res.writeHead(204).end();
    }
    const who = this.authed(req);
    if (!who) {
      const header = (req.headers.authorization ? 'Bearer error="invalid_token", ' : "Bearer ") +
        `resource_metadata="${this.base}/.well-known/oauth-protected-resource"`;
      return this.json(res, 401, { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }, { "WWW-Authenticate": header });
    }
    const msg = JSON.parse(await this.body(req));
    if (msg.method === "initialize") {
      const sid = b64();
      this.sessions.add(sid);
      return this.json(res, 200, { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mock", version: "0" } } }, { "Mcp-Session-Id": sid });
    }
    if (!this.sessions.has(req.headers["mcp-session-id"])) {
      return this.json(res, 404, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Session not found" } });
    }
    if (msg.id === undefined) return res.writeHead(202).end();
    if (msg.method === "tools/list") {
      return this.json(res, 200, { jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "alterlab_estimate_cost", description: "d", inputSchema: { type: "object" } }] } });
    }
    if (msg.method === "tools/call") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(": keepalive\n\n");
      res.write(`event: message\r\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: "t", progress: 1 } })}\r\n\r\n`);
      // Split an event across writes to exercise incremental parsing.
      const result = JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "ok" }] } });
      res.write(`event: message\ndata: ${result.slice(0, 20)}`);
      setTimeout(() => res.end(`${result.slice(20)}\n\n`), 10);
      return;
    }
    this.json(res, 200, { jsonrpc: "2.0", id: msg.id, result: {} });
  }
}

/** Simulate the browser: follow the authorize redirect to the loopback listener. */
export function browserThatApproves() {
  return (authorizeUrl) => {
    void (async () => {
      const r = await fetch(authorizeUrl, { redirect: "manual" });
      const loc = r.headers.get("location");
      if (loc) await fetch(loc);
    })();
  };
}
