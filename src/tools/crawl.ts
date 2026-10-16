import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";
import { formatBalanceWarning } from "../format.js";
import type { CrawlRequest } from "../types.js";
import {
  FORMATS_DESCRIPTION,
  crawlFormatEnum,
  extractionProfileEnum,
  extractionProviderEnum,
  pickAdvanced,
  tierEnum,
} from "./common.js";

// ============================================================================
// Start Crawl
// ============================================================================

const crawlCostControlsSchema = z
  .object({
    max_credits: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Hard spending cap in credits for the entire crawl"),
    max_tier: tierEnum
      .optional()
      .describe(
        "Maximum tier to use for page scrapes " +
          "(1=curl $0.0002, 2=http $0.0003, 3=stealth $0.002, 3.5=lightjs $0.0025, 4=browser $0.004). " +
          "render_js=true with a max_tier below 4 is rejected (render_js forces tier 4).",
      ),
    force_tier: tierEnum
      .optional()
      .describe(
        "Force all pages to use this exact tier, bypassing per-page escalation",
      ),
  })
  .describe(
    "Cost controls for the entire crawl — cap total spend or pin the scraping tier",
  );

export const crawlSchema = z.object({
  url: z.string().url().max(2083).describe("Start URL for the crawl"),
  max_pages: z
    .number()
    .int()
    .min(1)
    .max(100000)
    .default(50)
    .describe("Maximum number of pages to scrape"),
  max_depth: z
    .number()
    .int()
    .min(0)
    .max(20)
    .default(3)
    .describe(
      "Maximum link-following depth from start URL (0 = start page only)",
    ),
  include_patterns: z
    .array(z.string())
    .max(50)
    .optional()
    .describe(
      "Glob patterns — only scrape URLs whose path matches at least one (e.g., ['/blog/*', '/docs/*'])",
    ),
  exclude_patterns: z
    .array(z.string())
    .max(50)
    .optional()
    .describe(
      "Glob patterns — skip URLs whose path matches any (e.g., ['/tag/*', '/author/*'])",
    ),
  sitemap: z
    .enum(["include", "skip", "only"])
    .default("include")
    .describe(
      "Sitemap mode: include (default), skip (link extraction only), only (sitemap URLs only)",
    ),
  sitemap_path: z
    .string()
    .optional()
    .describe(
      "Explicit path to the sitemap file (e.g., '/sitemap_index.xml'). " +
        "Use when the sitemap is not at the standard /sitemap.xml location.",
    ),
  budget: z
    .record(z.string(), z.number().int())
    .optional()
    .describe(
      "Per-path page budget: glob pattern -> max pages, most specific pattern wins, '*' is the catch-all " +
        '(e.g., {"/products/*": 100, "/blog/*": 50, "*": 5}). max_pages stays the hard cap.',
    ),
  priority: z
    .object({
      keywords: z.array(z.string()).optional().describe("Crawl pages matching these keywords first"),
      boost_patterns: z.array(z.string()).optional().describe("URL glob patterns to crawl earlier"),
      demote_patterns: z.array(z.string()).optional().describe("URL glob patterns to crawl later"),
    })
    .optional()
    .describe("Crawl prioritisation hints (keywords, boost_patterns, demote_patterns)"),
  formats: z
    .array(crawlFormatEnum)
    .optional()
    .describe("Output formats for each scraped page. " + FORMATS_DESCRIPTION),
  extraction: z
    .literal("auto")
    .optional()
    .describe(
      "Set to 'auto' for automatic page-type detection and extraction without a user-defined schema. " +
        "Mutually exclusive with extraction_schema.",
    ),
  extraction_schema: z
    .record(z.unknown())
    .optional()
    .describe("JSON schema for structured extraction on each page"),
  extraction_profile: extractionProfileEnum
    .optional()
    .describe(
      "Pre-defined extraction profile applied to every crawled page. " +
        "'auto' detects the page type automatically.",
    ),
  extraction_template: extractionProfileEnum
    .optional()
    .describe("Alias for extraction_profile (mutually exclusive with it)"),
  extraction_provider: extractionProviderEnum
    .optional()
    .describe("BYOK LLM provider used for extraction on each page"),
  extraction_model: z
    .string()
    .nullish()
    .describe(
      "Per-request LLM model override in provider-specific format (e.g. 'gpt-4o', 'claude-opus-4-5-20251101', 'llama3-70b-8192'). " +
        "Overrides the model saved in your BYOK key settings for this request only.",
    ),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Custom HTTP headers injected into every page request during the crawl " +
        '(e.g., {"Authorization": "Bearer token"}). Maximum 50 headers.',
    ),
  max_concurrency: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe("Maximum concurrent pages to scrape simultaneously"),
  respect_robots: z
    .boolean()
    .default(true)
    .describe("Respect robots.txt rules for the target domain"),
  include_subdomains: z
    .boolean()
    .default(false)
    .describe("Include links to subdomains during discovery"),
  change_tracking: z
    .object({
      enabled: z.boolean().optional(),
      tracking_id: z
        .string()
        .max(200)
        .optional()
        .describe("Stable ID to compare this crawl against earlier crawls with the same ID"),
      mode: z.enum(["content", "structured"]).optional(),
      include_diff: z.boolean().optional().describe("Include a diff of changed pages"),
    })
    .optional()
    .describe("Track page changes between crawls"),
  render_js: z
    .union([z.boolean(), z.literal("auto")])
    .optional()
    .describe(
      "Render JavaScript on crawled pages. true=always (Tier 4, $0.004/page), false=never, auto=smart detection per page",
    ),
  screenshot: z
    .boolean()
    .optional()
    .describe("Capture a screenshot of each crawled page (requires render_js)"),
  use_proxy: z
    .boolean()
    .optional()
    .describe("Route all crawl requests through premium proxy (+$0.0002/page)"),
  wait_for: z
    .string()
    .optional()
    .describe(
      "CSS selector to wait for before extracting each page (e.g., '#main-content'). " +
        "Applied to all pages in the crawl.",
    ),
  timeout: z
    .number()
    .int()
    .min(1)
    .max(300)
    .optional()
    .describe("Per-page request timeout in seconds (1-300)"),
  delay: z
    .number()
    .min(0)
    .max(30)
    .optional()
    .describe("Politeness delay between page requests, in seconds (0-30)"),
  depth_strategy: z
    .enum(["eager", "sequential"])
    .optional()
    .describe("Link-discovery strategy (API default 'sequential')"),
  webhook_url: z
    .string()
    .url()
    .max(2083)
    .optional()
    .describe("Webhook URL to notify on crawl completion"),
  webhook: z
    .object({
      url: z.string().url().max(2083),
      events: z.array(z.string()).optional().describe("Event names to deliver (default: all)"),
      secret: z
        .string()
        .min(8)
        .max(256)
        .optional()
        .describe("Signing secret for webhook payloads (8-256 chars)"),
      headers: z.record(z.string(), z.string()).optional(),
      metadata: z.record(z.unknown()).optional().describe("Opaque metadata echoed in every event"),
    })
    .optional()
    .describe("Detailed webhook config (events, signing secret, headers); use instead of webhook_url"),
  storage: z
    .enum(["redis", "s3", "r2"])
    .optional()
    .describe("Where crawl results are stored (API default 'redis')"),
  cache: z.boolean().optional().describe("Serve pages from the response cache when available"),
  cache_ttl: z
    .number()
    .int()
    .min(60)
    .max(86400)
    .optional()
    .describe("Cache TTL in seconds (60-86400). Requires cache=true"),
  force_refresh: z
    .boolean()
    .optional()
    .describe("Bypass the cache and fetch every page fresh"),
  cost_controls: crawlCostControlsSchema.optional(),
});

export const crawlDescription =
  "Crawl an entire website for RAG, index all pages on a site, or build a knowledge base from a domain. " +
  "Automatically bypasses anti-bot protection on every page — works on Cloudflare-protected sites. " +
  "Discovers URLs via sitemap parsing and link extraction, then scrapes each page asynchronously. " +
  "Each page is billed at the tier that succeeds (tier 1 $0.0002 ... tier 4 $0.004). " +
  "Returns content as clean markdown, text, or structured data. " +
  "Returns a crawl_id immediately — use alterlab_crawl_status to poll results. " +
  "Use include_patterns/exclude_patterns to scope the crawl to specific sections; budget to allocate pages per path. " +
  "Use render_js='auto' for mixed sites to save 30-60% vs always rendering. " +
  "Supports extraction_schema, extraction_profile or extraction='auto' to extract structured data from every page. " +
  "Use cost_controls to cap total credits or pin the scraping tier for all pages. " +
  "Use sitemap_path to specify a non-standard sitemap location. " +
  "Use headers to inject custom HTTP headers (e.g., Authorization) into every page request. " +
  "Use change_tracking to detect page changes between runs; webhook/webhook_url for completion events.";

const CRAWL_ADVANCED_KEYS = [
  "render_js",
  "screenshot",
  "use_proxy",
  "wait_for",
  "timeout",
  "delay",
  "depth_strategy",
] as const;

/** Translate flat crawl tool parameters into the API's CrawlRequest. Exported for tests. */
export function buildCrawlRequest(params: z.infer<typeof crawlSchema>): CrawlRequest {
  const { extraction_model, cost_controls, ...rest } = params;
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined && !(CRAWL_ADVANCED_KEYS as readonly string[]).includes(k)) {
      body[k] = v;
    }
  }
  if (extraction_model) body.extraction_model = extraction_model;
  if (cost_controls) body.cost_controls = cost_controls;
  const advanced = pickAdvanced(
    params as unknown as Record<string, unknown>,
    CRAWL_ADVANCED_KEYS,
  );
  if (Object.keys(advanced).length > 0) body.advanced = advanced;
  return body as unknown as CrawlRequest;
}

export async function handleCrawl(
  client: AlterLabClient,
  params: z.infer<typeof crawlSchema>,
): Promise<CallToolResult> {
  try {
    const response = await client.startCrawl(buildCrawlRequest(params));

    const text =
      `**Crawl Started**\n\n` +
      `- Crawl ID: \`${response.crawl_id}\`\n` +
      `- Status: ${response.status}\n` +
      `- Start URL: ${response.url}\n` +
      `- Max pages: ${params.max_pages}\n` +
      `- Max depth: ${params.max_depth}\n\n` +
      `Use \`alterlab_crawl_status\` with crawl_id \`${response.crawl_id}\` to poll for results.\n` +
      `Crawls run asynchronously — check back after a few minutes for large sites.`;

    const balanceWarningSuffix = formatBalanceWarning(client.getLastBalanceWarning());
    return { content: [{ type: "text", text: text + balanceWarningSuffix }] };
  } catch (error) {
    const balanceWarningSuffix = formatBalanceWarning(client.getLastBalanceWarning());
    const result = isApiError(error)
      ? formatErrorResult(error, { url: params.url })
      : formatErrorResult(error as Error, { url: params.url });
    if (balanceWarningSuffix && result.content[0]?.type === "text") {
      (result.content[0] as { type: "text"; text: string }).text += balanceWarningSuffix;
    }
    return result;
  }
}

// ============================================================================
// Crawl Status (poll)
// ============================================================================

export const crawlStatusSchema = z.object({
  crawl_id: z.string().describe("Crawl ID returned by alterlab_crawl"),
});

export const crawlStatusDescription =
  "Poll the status and results of an ongoing or completed crawl. " +
  "Call this after alterlab_crawl to check progress and retrieve scraped pages. " +
  "Status values: queued, running, completed, failed, cancelled. " +
  "When completed, results contains the scraped page content.";

export async function handleCrawlStatus(
  client: AlterLabClient,
  params: z.infer<typeof crawlStatusSchema>,
): Promise<CallToolResult> {
  try {
    const response = await client.getCrawlStatus(params.crawl_id);
    const text = formatCrawlStatusResponse(response);
    return { content: [{ type: "text", text }] };
  } catch (error) {
    if (isApiError(error)) {
      return formatErrorResult(error, { url: params.crawl_id });
    }
    return formatErrorResult(error as Error, { url: params.crawl_id });
  }
}

// ============================================================================
// Cancel Crawl
// ============================================================================

export const crawlCancelSchema = z.object({
  crawl_id: z.string().describe("Crawl ID to cancel"),
});

export const crawlCancelDescription =
  "Cancel an ongoing crawl and refund unused pre-debited credits. " +
  "Already-scraped pages are kept and available via alterlab_crawl_status. " +
  "Cancelled crawls cannot be resumed.";

export async function handleCrawlCancel(
  client: AlterLabClient,
  params: z.infer<typeof crawlCancelSchema>,
): Promise<CallToolResult> {
  try {
    const response = await client.cancelCrawl(params.crawl_id);
    const text =
      `**Crawl Cancelled**\n\n` +
      `- Crawl ID: \`${params.crawl_id}\`\n` +
      `- Pages scraped before cancel: ${response.pages_scraped ?? "unknown"}\n` +
      `- Credits refunded: ${response.credits_refunded ?? 0}\n\n` +
      `Any pages scraped before cancellation are still available via \`alterlab_crawl_status\`.`;

    return { content: [{ type: "text", text }] };
  } catch (error) {
    if (isApiError(error)) {
      return formatErrorResult(error, { url: params.crawl_id });
    }
    return formatErrorResult(error as Error, { url: params.crawl_id });
  }
}

// ============================================================================
// Helpers
// ============================================================================

function formatCrawlStatusResponse(response: unknown): string {
  const r = response as Record<string, unknown>;
  const status = String(r.status ?? "unknown");
  const crawlId = String(r.crawl_id ?? "");
  const url = String(r.url ?? "");
  const pagesScraped = Number(r.pages_scraped ?? 0);
  const pagesTotal = r.pages_total ? Number(r.pages_total) : null;
  const creditsUsed = r.credits_used ? Number(r.credits_used) : null;
  const results = Array.isArray(r.results) ? r.results : [];

  const parts: string[] = [
    `**Crawl Status: ${status.toUpperCase()}**\n`,
    `- Crawl ID: \`${crawlId}\``,
    `- URL: ${url}`,
    `- Pages scraped: ${pagesScraped}${pagesTotal ? ` / ${pagesTotal}` : ""}`,
  ];

  if (creditsUsed !== null) {
    parts.push(`- Credits used: ${creditsUsed}`);
  }

  if (status === "running" || status === "queued") {
    parts.push(
      "\nCrawl is still in progress. Poll again with `alterlab_crawl_status` to check for updates.",
    );
  } else if (status === "completed") {
    parts.push(`\n**Results** (${results.length} pages):\n`);
    const preview = results.slice(0, 10);
    for (const page of preview) {
      const p = page as Record<string, unknown>;
      const pageUrl = String(p.url ?? "");
      const pageStatus = String(p.status ?? "");
      const title = p.title ? ` — ${String(p.title)}` : "";
      parts.push(`- [${pageStatus}] ${pageUrl}${title}`);
    }
    if (results.length > 10) {
      parts.push(`... and ${results.length - 10} more pages`);
    }
  } else if (status === "failed") {
    const error = r.error ? String(r.error) : "Unknown error";
    parts.push(`\n**Error**: ${error}`);
  }

  return parts.join("\n");
}

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as ApiError).status === "number"
  );
}
