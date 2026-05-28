---
name: alterlab-mcp
description: |
  Working with the AlterLab MCP Server codebase — a TypeScript Model Context Protocol server for web scraping, structured data extraction (product, article, job, FAQ, recipe, event profiles), screenshots, and authenticated session management. This skill provides the exact architecture, patterns, file-to-file conventions, and copy-pasteable templates needed to add tools, modify Zod schemas, wire API endpoints, format responses, handle errors by status code, manage scraping sessions, or debug "Cannot read properties of undefined" crashes.

  Use this skill whenever the user says anything about: alterlab, mcp server, mcp tool, mcp schema, zod schema, scrape tool, extract tool, screenshot tool, session tool, balance tool, tool registration, server.json, MCP SDK, modelcontextprotocol, authenticated scraping, cookie session, proxy country, render_js, response formatter, format.ts, client.ts, AlterLabClient, error handler, status code handling, tier pricing, or building/extending/fixing an MCP server in this repo.

  Also use this skill when the user asks about: adding a new MCP tool, changing tool parameters, debugging tool handlers, implementing new API endpoints, creating formatters, modifying error messages, adding session features, or understanding how this codebase's server bootstrap / tool registration / HTTP client / response formatting / error handling work.

  Trigger this skill even if the user does not explicitly name "AlterLab" — if they mention working on an MCP server with scrape/extract/session tools or mention file paths like src/tools/, src/index.ts, src/client.ts, src/format.ts, src/errors.ts, src/types.ts, or server.json in this repo, apply this skill immediately.
---

# AlterLab MCP Server — Development Guide

This is a TypeScript MCP (Model Context Protocol) server that exposes web scraping tools to AI assistants like Claude, Cursor, and Windsurf. It communicates with the AlterLab REST API and formats responses for LLM consumption.

## Architecture Overview

```
src/
├── index.ts       # Server bootstrap, tool registration, sandbox mode
├── client.ts      # AlterLabClient — HTTP wrapper with retries & auth
├── types.ts       # All TypeScript interfaces for API requests/responses
├── config.ts      # Env var loading (ALTERLAB_API_KEY, ALTERLAB_API_URL)
├── errors.ts      # Status-code-specific error formatting for MCP tool results
├── format.ts      # Response formatters (scrape, extract, balance, sessions)
└── tools/
    ├── scrape.ts      # alterlab_scrape
    ├── extract.ts     # alterlab_extract
    ├── screenshot.ts  # alterlab_screenshot
    ├── estimate.ts    # alterlab_estimate_cost
    ├── balance.ts     # alterlab_check_balance
    └── sessions.ts    # all session CRUD + validate + refresh
```

## Core Patterns

### 1. Tool Definition Pattern
Every tool follows the same three-export pattern:

```typescript
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";

// 1. Zod schema for parameters
export const myToolSchema = z.object({
  url: z.string().url().describe("URL to scrape"),
  // ... more fields
});

// 2. Description string for MCP tool registration
export const myToolDescription =
  "Short description. " +
  "Use this tool when... More details.";

// 3. Handler function
export async function handleMyTool(
  client: AlterLabClient,
  params: z.infer<typeof myToolSchema>,
): Promise<CallToolResult> {
  try {
    const response = await client.someApiMethod({ /* mapped params */ });
    return {
      content: [{ type: "text", text: formatResponse(response) }],
    };
  } catch (error) {
    if (isApiError(error)) {
      return formatErrorResult(error, { url: params.url });
    }
    return formatErrorResult(error as Error, { url: params.url });
  }
}

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as ApiError).status === "number"
  );
}
```

**Critical**: Always inject `url` into `formatErrorResult` context when the tool operates on a URL. This produces better error messages.

### 2. Registering a New Tool
In `src/index.ts`:

```typescript
import {
  myToolSchema,
  myToolDescription,
  handleMyTool,
} from "./tools/my_tool.js";

// Inside createServer():
server.tool(
  "alterlab_my_tool",
  myToolDescription,
  myToolSchema.shape,
  (params) => handleMyTool(client, params as any),
);
```

Also add the tool entry to `server.json` (see below).

### 3. Adding API Client Methods
In `src/client.ts`, add a typed method to `AlterLabClient`:

```typescript
async newFeature(params: SomeRequestType): Promise<SomeResponseType> {
  return this.request<SomeResponseType>("POST", "/api/v1/feature", params);
}
```

The `request<T>` method handles:
- Injecting `X-API-Key` and `User-Agent` headers
- Retrying 429/503 with exponential backoff (up to `MAX_RETRIES = 2`)
- Parsing JSON errors into `ApiError` objects

**Do NOT retry 504** — credits may have been consumed.

### 4. Schema Type Mapping Rules

When mapping Zod schemas to `UnifiedScrapeRequest.advanced`, use this mapping:

| Zod param | `advanced` field |
|-----------|------------------|
| `render_js` | `advanced.render_js` |
| `use_proxy` | `advanced.use_proxy` |
| `proxy_country` | `advanced.proxy_country` |
| `formats` includes `"markdown"` | `advanced.markdown = true` |
| `wait_for` | `wait_for` (top-level) |
| `timeout` | `timeout` (top-level) |
| `include_raw_html` | `include_raw_html` (top-level) |
| `session_id` | `session_id` (top-level) |
| `cookies` | `cookies` (top-level) |

The `advanced` object is the legacy API field; top-level fields are the newer unified API.

### 5. Response Formatting Rules (format.ts)

All user-facing output goes through `format.ts`. Keep these conventions:

- **Scrape responses**: Prefer `markdown` > `text` > `html` > `json` from `content`. Always append a `---` metadata footer with tier name, cost, response time, and cache status.
- **Extract responses**: Output as `\`\`\`json\n...\n\`\`\``. Use `filtered_content` first, then `content.json`.
- **Estimate responses**: Bullet list with tier name, price, confidence, reasoning.
- **Balance responses**: Simple bullet list with balance, deposited, spent.
- **Session responses**: Use `formatSessionListResponse`, `formatSessionCreateResponse`, etc. Status badges show Active/Expired/Invalid.

Always prepend `# Title` when `response.title` is present.

### 6. Error Handling (errors.ts)

`formatErrorResult` maps HTTP status codes to actionable MCP error results:

| Status | Meaning | Suggested Action |
|--------|---------|------------------|
| 400 | Bad request | Check URL / parameters |
| 401 | Unauthorized | Verify `ALTERLAB_API_KEY` |
| 402 | Insufficient credits | Run `alterlab_check_balance`, add funds |
| 403 | Access denied | Try `render_js: true` + `use_proxy: true` |
| 422 | Validation error | Check parameter constraints |
| 429 | Rate limited | Auto-retry with backoff |
| 502 | Bad gateway | Wait and retry; target site may be temporarily down |
| 504 | Gateway timeout | **Do NOT retry immediately** — credits may be consumed |

All errors return `isError: true` with text content explaining the issue and next steps.

### 7. server.json Maintenance

The `server.json` file is the MCP registry manifest. When adding or changing tools, keep it in sync with `src/index.ts`. Each tool needs:

```json
{
  "name": "alterlab_tool_name",
  "description": "Same description as the TypeScript description string"
}
```

Also update the `version` field to match `package.json`.

### 8. Multi-Tier Scraping Model

The API has 6 tiers with different costs:

| Tier | Name | Cost | Use Case |
|------|------|------|----------|
| 1 | curl | $0.0002 | Static pages, RSS, public APIs |
| 2 | http | $0.0003 | Basic bot detection |
| 3 | stealth | $0.002 | Cloudflare, DataDome |
| 3.5 | lightjs | $0.0025 | Server-rendered JS |
| 4 | browser | $0.004 | Headless Chromium for SPAs |
| 5 | captcha | $0.02 | CAPTCHA solving |

Tier info constants live in `types.ts` (`TIER_NAMES`, `TIER_PRICES`). Update both if backend pricing changes.

### 9. Session Management

Sessions enable authenticated scraping. The flow:
1. `alterlab_create_session` — store cookies for a domain
2. `alterlab_scrape` with `session_id` — cookies injected automatically
3. `alterlab_validate_session` — check if cookies still work
4. `alterlab_refresh_session` — rotate cookies, reset failure counters
5. `alterlab_delete_session` — remove session

Session handlers are all in `src/tools/sessions.ts`. Follow the existing CRUD pattern there.

### 10. Screenshot Implementation Details

Screenshots are a special scrape mode:
- Always sets `mode: "js"` and `screenshot: true`
- Fetches the resulting `screenshot_url` via `fetchScreenshotAsBase64`
- Returns content as `type: "image"` with `mimeType: "image/png"` plus a text metadata line
- Never returns raw screenshot URL — always base64-encode it

### 11. Adding a New Tool — Complete Checklist

When adding a new tool to this MCP server:

1. **Implement** in `src/tools/<name>.ts` following the three-export pattern
2. **Export** schema, description, and handler
3. **Register** in `src/index.ts` inside `createServer()`
4. **Add** types to `src/types.ts` if new API request/response shapes are needed
5. **Add** client method to `src/client.ts` if new API endpoint
6. **Add** formatter to `src/format.ts` if new response formatting logic
7. **Update** `server.json` with the new tool entry and description
8. **Bump** version in `package.json` and `src/index.ts` (and optionally `server.json`)
9. **Build** with `npm run build` to verify compilation
10. **Test** the tool manually or via the MCP inspector

### 12. Code Style

- Use kebab-case for filenames (`my_tool.ts`)
- Use camelCase for variables/functions, PascalCase for types/classes
- Prefer explicit types over `any`; use `z.infer<typeof schema>` for params
- Always type the `error` parameter in catch blocks; use `isApiError` guard
- Description strings should be concise but mention the most important parameters and when to use the tool
- Keep Zod `.describe()` text short — it becomes part of the MCP tool schema seen by the AI

## Common Tasks

### Updating API pricing or tiers
Edit `TIER_NAMES` and `TIER_PRICES` in `src/types.ts`, and update the README table.

### Adding a new output format to scrape
Add the format to the Zod enum in `scrapeSchema`, update `formatScrapeResponse` to handle it in the priority chain, and pass it through in `handleScrape`.

### Changing error messages for a status code
Edit the switch case in `src/errors.ts`. Always provide a "Suggested actions:" list.

### Adding authenticated scraping for a new domain
No code changes needed — users create sessions via `alterlab_create_session`. If you need domain-specific logic, add it in the client request layer, not the tool layer.

### Building and Publishing
```bash
npm run build      # Compiles TypeScript to dist/
npm start          # Runs the compiled server
npm run dev        # Watch mode
```

The `bin` entry in `package.json` points to `dist/index.js`. Published files are `dist/`, `server.json`, `README.md`, `LICENSE`.

## References

- MCP SDK patterns: `references/mcp-sdk-patterns.md`
- AlterLab API docs: https://docs.alterlab.io/api
- MCP Protocol spec: https://modelcontextprotocol.io
