// src/shared/tool-definitions.json is the platform's shared tool source
// (AlterLab shared/mcp_tools, copied here by the ecosystem-sync workflow). The
// local API-key server keeps its own schemas because they are a strict superset
// (see CHANGELOG 1.10.0): this test fails when the shared source moves ahead of
// the local tools, so drift is caught instead of silently diverging.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const shared = JSON.parse(
  fs.readFileSync(path.join(ROOT, "src/shared/tool-definitions.json"), "utf8"),
).tools;

// Shared properties the local server intentionally does not expose, with the reason.
const KNOWN_DIVERGENCE = {
  // Not accepted by the crawl `advanced` object; removed locally in 1.9.0 (#615).
  "alterlab_crawl.block_images": "rejected by the API for crawls",
};

test("every shared tool and property is available in the local server", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "alterlab-mcp-test-"));
  const client = new Client({ name: "drift-test", version: "0" });
  await client.connect(
    new StdioClientTransport({
      command: "node",
      args: [path.join(ROOT, "dist/index.js")],
      env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, ALTERLAB_API_KEY: "sk_test" },
      stderr: "pipe",
    }),
  );
  try {
    const local = new Map((await client.listTools()).tools.map((t) => [t.name, t]));
    for (const tool of shared) {
      const mine = local.get(tool.name);
      assert.ok(mine, `local server is missing shared tool ${tool.name}`);
      const have = new Set(Object.keys(mine.inputSchema.properties ?? {}));
      for (const prop of Object.keys(tool.inputSchema.properties ?? {})) {
        if (have.has(prop)) continue;
        assert.ok(
          `${tool.name}.${prop}` in KNOWN_DIVERGENCE,
          `${tool.name}.${prop} is in the shared source but not exposed locally`,
        );
      }
    }
  } finally {
    await client.close();
  }
});
