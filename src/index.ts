#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AlterLabClient } from "./client.js";
import { loadConfig, type Config } from "./config.js";
import { scrapeSchema, scrapeDescription, handleScrape } from "./tools/scrape.js";
import { extractSchema, extractDescription, handleExtract } from "./tools/extract.js";
import {
  screenshotSchema,
  screenshotDescription,
  handleScreenshot,
} from "./tools/screenshot.js";
import { estimateSchema, estimateDescription, handleEstimate } from "./tools/estimate.js";
import { balanceSchema, balanceDescription, handleBalance } from "./tools/balance.js";

function createServer(config: Config): McpServer {
  const client = new AlterLabClient(config);

  const server = new McpServer({
    name: "alterlab",
    version: "1.0.0",
  });

  // Register tools
  server.tool("alterlab_scrape", scrapeDescription, scrapeSchema.shape, (params) =>
    handleScrape(client, params as any)
  );

  server.tool("alterlab_extract", extractDescription, extractSchema.shape, (params) =>
    handleExtract(client, params as any)
  );

  server.tool(
    "alterlab_screenshot",
    screenshotDescription,
    screenshotSchema.shape,
    (params) => handleScreenshot(client, params as any)
  );

  server.tool("alterlab_estimate_cost", estimateDescription, estimateSchema.shape, (params) =>
    handleEstimate(client, params as any)
  );

  server.tool("alterlab_check_balance", balanceDescription, balanceSchema.shape, () =>
    handleBalance(client)
  );

  return server;
}

/**
 * Smithery sandbox: allows registry to scan tools without real credentials.
 */
export function createSandboxServer(): McpServer {
  return createServer({
    apiKey: "sandbox-key",
    apiUrl: "https://api.alterlab.io",
  });
}

async function main() {
  const config = loadConfig();
  const server = createServer(config);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
