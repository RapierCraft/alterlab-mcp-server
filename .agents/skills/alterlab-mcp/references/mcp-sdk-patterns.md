# MCP SDK Patterns Used in alterlab-mcp-server

This document catalogs recurring MCP SDK patterns found throughout the codebase as quick-reference for implementers.

## `server.tool()` Registration

The `McpServer` (from `@modelcontextprotocol/sdk/server/mcp.js`) exposes `.tool(name, description, schema, handler)`.

```typescript
server.tool(
  "alterlab_scrape",           // tool name (kebab-case recommended)
  scrapeDescription,           // string description
  scrapeSchema.shape,          // Zod schema stripped to an object shape
  (params) => handleScrape(client, params as any),
);
```

Notes:
- `schema.shape` is required; passing the full Zod object causes runtime issues.
- The handler receives params as `Record<string, unknown>` (hence the `as any`).
- Handler must return `Promise<CallToolResult>`.

## `CallToolResult` Structure

```typescript
{
  content: [
    { type: "text", text: "Hello world" },
    { type: "image", data: base64String, mimeType: "image/png" },
  ],
  isError?: boolean,   // true if this is an error response
}
```

- `type: "text"` is for all textual output (including markdown, JSON, error messages).
- `type: "image"` is for base64-encoded images.
- `isError: true` tells the host this result is an error; still uses text content.

## Zod Schemas for Parameters

Use `.describe()` for every field; the description shows up in tool prompts.

```typescript
export const scrapeSchema = z.object({
  url: z.string().url().describe("URL to scrape"),
  render_js: z.boolean().default(false).describe("Render JS (forces Tier 4)"),
  // ...
});
```

- `.default()` fills missing params automatically.
- `.optional()` for truly optional fields.
- `.url()` adds format validation.

## Error Result Helpers

The codebase uses a shared `formatErrorResult(error, context)` in `errors.ts` that returns a `CallToolResult` with `isError: true`.

Always wrap tool handlers like this:

```typescript
try {
  const response = await client.apiCall(params);
  return { content: [{ type: "text", text: formatResponse(response) }] };
} catch (error) {
  if (isApiError(error)) {
    return formatErrorResult(error, { url: params.url });
  }
  return formatErrorResult(error as Error, { url: params.url });
}
```

## Stdio Transport

```typescript
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const transport = new StdioServerTransport();
await server.connect(transport);
```

The server reads JSON-RPC messages from `stdin` and writes to `stdout`. Keep `console.log` out of the main path or risk corrupting the JSON-RPC stream.

## Sandbox Server (`server.json` / Registry)

The `createSandboxServer()` export in `src/index.ts` creates a server with a dummy key so registries (like Smithery) can introspect tool schemas without hitting the real API. Keep it lightweight and avoid env-dependent setup.

## Version Sync Checklist

When releasing, bump all these:
- `package.json` `"version"`
- `src/index.ts` `version: "1.x.x"`
- `server.json` `"version"`
- `client.ts` `VERSION` constant (legacy, ideally removed)
