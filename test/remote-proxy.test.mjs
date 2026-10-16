// Remote mode: the stdio <-> Streamable HTTP bridge, selection of remote vs
// local mode, and the real process driven by an MCP client over stdio.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { RemoteProxy, StaticBearer, readSse } from "../dist/remote/proxy.js";
import { OAuthSession } from "../dist/remote/oauth.js";
import { OAuthCredentials, resolveRemoteSettings, DEFAULT_MCP_URL } from "../dist/remote/index.js";
import { TokenStore } from "../dist/remote/token-store.js";
import { MockHosted, browserThatApproves } from "./helpers/mock-hosted.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "alterlab-mcp-test-"));

/** An in-memory stdio transport: `client.say()` plays the MCP client. */
function fakeTransport() {
  const sent = [];
  const waiters = [];
  const t = {
    sent,
    async start() {},
    async close() {},
    async send(m) {
      sent.push(m);
      waiters.splice(0).forEach((w) => w());
    },
    say(m) {
      return t.onmessage(m);
    },
    async until(pred, ms = 3000) {
      const end = Date.now() + ms;
      while (!sent.some(pred)) {
        if (Date.now() > end) throw new Error("timed out; saw " + JSON.stringify(sent));
        await new Promise((r) => { waiters.push(r); setTimeout(r, 20); });
      }
      return sent.find(pred);
    },
  };
  return t;
}

const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } };

async function bridge(mock, credentials) {
  const t = fakeTransport();
  const proxy = new RemoteProxy(t, { url: mock.mcpUrl, credentials, userAgent: "test" });
  await proxy.start();
  return { t, proxy };
}

test("selection: remote mode only with --remote or ALTERLAB_MCP_URL", () => {
  assert.equal(resolveRemoteSettings([], {}), null);
  assert.equal(resolveRemoteSettings(["--setup"], { ALTERLAB_API_KEY: "sk_x" }), null);
  assert.equal(resolveRemoteSettings(["--remote"], {}).url, DEFAULT_MCP_URL);
  assert.equal(resolveRemoteSettings(["--remote", "https://h/mcp"], {}).url, "https://h/mcp");
  assert.equal(resolveRemoteSettings(["--remote=https://h/mcp"], {}).url, "https://h/mcp");
  assert.equal(resolveRemoteSettings([], { ALTERLAB_MCP_URL: "https://e/mcp" }).url, "https://e/mcp");
  assert.equal(resolveRemoteSettings(["--remote", "--login"], {}).url, DEFAULT_MCP_URL);
});

test("sse: parses CRLF, comments, multi-line data and events split across chunks", async () => {
  const enc = new TextEncoder();
  const chunks = [": ka\r\n\r\nevent: message\r\nda", 'ta: {"a":\n', "data: 1}\r\n\r\ndata: tail"];
  const stream = new ReadableStream({
    start(c) {
      chunks.forEach((x) => c.enqueue(enc.encode(x)));
      c.close();
    },
  });
  const got = [];
  await readSse(stream, (d) => got.push(d));
  assert.deepEqual(got, ['{"a":\n1}', "tail"]);
});

test("proxy (API key): session header, protocol header, 202, tools/list, SSE tools/call", async () => {
  const mock = await new MockHosted().start();
  try {
    const { t } = await bridge(mock, new StaticBearer(mock.apiKey));
    await t.say(INIT);
    const init = await t.until((m) => m.id === 1);
    assert.equal(init.result.protocolVersion, "2025-06-18");
    await t.say({ jsonrpc: "2.0", method: "notifications/initialized" });
    await t.say({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const list = await t.until((m) => m.id === 2);
    assert.equal(list.result.tools[0].name, "alterlab_estimate_cost");
    await t.say({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "alterlab_estimate_cost", arguments: {}, _meta: { progressToken: "t" } } });
    const call = await t.until((m) => m.id === 3);
    assert.equal(call.result.content[0].text, "ok");
    const order = t.sent.map((m) => m.method ?? `id${m.id}`);
    assert.deepEqual(order, ["id1", "id2", "notifications/progress", "id3"], "progress streams before the result");
    const posts = mock.log.filter((l) => l.path === "/mcp");
    assert.ok(posts.every((l) => l.auth === `Bearer ${mock.apiKey}`));
  } finally {
    await mock.stop();
  }
});

test("proxy (API key): a rejected key becomes a JSON-RPC error, not a hang", async () => {
  const mock = await new MockHosted().start();
  try {
    const { t } = await bridge(mock, new StaticBearer("sk_wrong"));
    await t.say(INIT);
    const err = await t.until((m) => m.id === 1);
    assert.match(err.error.message, /API key/);
  } finally {
    await mock.stop();
  }
});

test("proxy (OAuth): 401 -> sign in -> retried request succeeds; then 401 on expiry refreshes", async () => {
  const mock = await new MockHosted().start();
  const dir = tmp();
  try {
    const session = new OAuthSession({ mcpUrl: mock.mcpUrl, store: new TokenStore(dir), softwareVersion: "t", openUrl: browserThatApproves(), loginTimeoutMs: 5000 });
    const { t } = await bridge(mock, new OAuthCredentials(session));
    await t.say(INIT);
    await t.until((m) => m.id === 1);
    assert.equal(mock.registrations, 1);
    // First connection signed in without a probe-less guess: the unauthenticated probe saw the 401 challenge.
    assert.ok(mock.log.some((l) => l.path === "/mcp" && !l.auth), "unauthenticated probe hit /mcp");

    mock.expireAccessTokens(); // the server now answers 401 invalid_token
    await t.say({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const list = await t.until((m) => m.id === 2);
    assert.ok(list.result.tools);
    assert.equal(mock.tokenRequests.at(-1).grant_type, "refresh_token");
    assert.equal(mock.registrations, 1, "refresh did not re-register");
  } finally {
    await mock.stop();
  }
});

test("proxy: session dropped by the server (404) is re-initialized transparently", async () => {
  const mock = await new MockHosted().start();
  try {
    const { t } = await bridge(mock, new StaticBearer(mock.apiKey));
    await t.say(INIT);
    await t.until((m) => m.id === 1);
    await t.say({ jsonrpc: "2.0", method: "notifications/initialized" });
    mock.sessions.clear();
    await t.say({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const list = await t.until((m) => m.id === 2);
    assert.ok(list.result?.tools, JSON.stringify(list));
    assert.equal(t.sent.filter((m) => m.error).length, 0);
    assert.equal(mock.sessions.size, 1);
  } finally {
    await mock.stop();
  }
});

test("proxy: close() ends the remote session", async () => {
  const mock = await new MockHosted().start();
  try {
    const { t, proxy } = await bridge(mock, new StaticBearer(mock.apiKey));
    await t.say(INIT);
    await t.until((m) => m.id === 1);
    assert.equal(mock.sessions.size, 1);
    await proxy.close();
    assert.equal(mock.sessions.size, 0);
  } finally {
    await mock.stop();
  }
});

// ---- The real process, driven by an MCP client over stdio ------------------

function isolatedEnv(extra) {
  const home = tmp();
  const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, ...extra };
  return { home, env };
}

test("process (remote, API key): stdio client sees the hosted tools", async () => {
  const mock = await new MockHosted().start();
  const { env } = isolatedEnv({ ALTERLAB_MCP_URL: mock.mcpUrl, ALTERLAB_API_KEY: mock.apiKey });
  const client = new Client({ name: "stdio-test", version: "0" });
  try {
    await client.connect(new StdioClientTransport({ command: "node", args: [path.join(ROOT, "dist/index.js")], env, stderr: "pipe" }));
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((x) => x.name), ["alterlab_estimate_cost"]);
    const res = await client.callTool({ name: "alterlab_estimate_cost", arguments: {} });
    assert.equal(res.content[0].text, "ok");
  } finally {
    await client.close();
    await mock.stop();
  }
});

test("process (remote, OAuth): no key -> browser sign-in -> tools; second run reuses tokens",
  { skip: process.platform !== "linux" }, async () => {
  const mock = await new MockHosted().start();
  // A stand-in browser: `xdg-open URL` follows the authorize redirect to the loopback listener.
  const bin = tmp();
  fs.writeFileSync(path.join(bin, "xdg-open"), '#!/bin/sh\ncurl -sL --max-time 10 "$1" >/dev/null 2>&1 &\n', { mode: 0o755 });
  const { home, env } = isolatedEnv({ ALTERLAB_MCP_URL: mock.mcpUrl });
  env.PATH = `${bin}:${process.env.PATH}`;
  const run = async () => {
    const client = new Client({ name: "stdio-test", version: "0" });
    await client.connect(new StdioClientTransport({ command: "node", args: [path.join(ROOT, "dist/index.js")], env, stderr: "pipe" }));
    try {
      const tools = await client.listTools();
      assert.equal(tools.tools[0].name, "alterlab_estimate_cost");
    } finally {
      await client.close();
    }
  };
  try {
    await run();
    assert.equal(mock.registrations, 1);
    const file = path.join(home, ".alterlab", "oauth.json");
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
    await run();
    assert.equal(mock.registrations, 1, "second run did not register again");
    assert.equal(mock.tokenRequests.length, 1, "second run reused the stored token");
  } finally {
    await mock.stop();
  }
});

test("process (local, API key): unchanged — no remote flags means the local tool set",
  async () => {
  const { env } = isolatedEnv({ ALTERLAB_API_KEY: "sk_local", ALTERLAB_API_URL: "http://127.0.0.1:9" });
  const client = new Client({ name: "stdio-test", version: "0" });
  try {
    await client.connect(new StdioClientTransport({ command: "node", args: [path.join(ROOT, "dist/index.js")], env, stderr: "pipe" }));
    const names = (await client.listTools()).tools.map((x) => x.name);
    for (const n of ["alterlab_scrape", "alterlab_check_balance", "alterlab_list_sessions", "alterlab_get_job"]) {
      assert.ok(names.includes(n), `${n} present`);
    }
    assert.ok(names.length >= 25);
  } finally {
    await client.close();
  }
});
