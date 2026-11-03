import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

test("every listed tool has a title and complete annotations", async () => {
  const client = new Client({ name: "test", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
    env: { ...process.env, ALTERLAB_API_KEY: "sk_test_annotations" },
  });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.ok(tools.length >= 25, `expected all tools, got ${tools.length}`);
  for (const t of tools) {
    assert.ok(t.title && t.title.trim(), `${t.name} missing title`);
    assert.ok(t.annotations, `${t.name} missing annotations`);
    for (const k of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
      assert.equal(typeof t.annotations[k], "boolean", `${t.name} missing ${k}`);
    }
  }
  const by = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
  assert.equal(by.alterlab_delete_session.destructiveHint, true);
  assert.equal(by.alterlab_list_sessions.readOnlyHint, true);
  assert.equal(by.alterlab_enable_beta_feature.readOnlyHint, false);
  await client.close();
});
