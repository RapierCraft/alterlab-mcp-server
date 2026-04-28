import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";

// ============================================================================
// Start Crawl
// ============================================================================

export const crawlSchema = z.object({
  url: z.string().url().describe("Start URL for the crawl"),
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
    .optional()
    .describe(
      "Glob patterns — only scrape URLs whose path matches at least one (e.g., ['/blog/*', '/docs/*'])",
    ),
  exclude_patterns: z
    .array(z.string())
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
  formats: z
    .array(z.enum(["text", "json", "json_v2", "html", "markdown"]))
    .optional()
    .describe("Output formats for each scraped page"),
  extraction_schema: z
    .record(z.unknown())
    .optional()
    .describe("JSON schema for structured extraction on each page"),
  render_js: z
    .union([z.boolean(), z.literal("auto")])
    .default(false)
    .describe(
      "Render JavaScript on crawled pages. true=always (Tier 4), false=never, auto=smart detection per page",
    ),
  use_proxy: z
    .boolean()
    .default(false)
    .describe("Route all crawl requests through premium proxy"),
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
  webhook_url: z
    .string()
    .url()
    .optional()
    .describe("Webhook URL to notify on crawl completion"),
});

export const crawlDescription =
  "Start an asynchronous crawl of an entire website. " +
  "Discovers URLs via sitemap parsing and link extraction, then scrapes each page. " +
  "Returns a crawl_id immediately — use alterlab_crawl_status to poll results. " +
  "Use include_patterns/exclude_patterns to scope the crawl to specific sections. " +
  "Use render_js='auto' for mixed sites to save 30-60% vs always rendering. " +
  "Supports extraction_schema to extract structured data from every page.";

export async function handleCrawl(
  client: AlterLabClient,
  params: z.infer<typeof crawlSchema>,
): Promise<CallToolResult> {
  try {
    const response = await client.startCrawl({
      url: params.url,
      max_pages: params.max_pages,
      max_depth: params.max_depth,
      include_patterns: params.include_patterns,
      exclude_patterns: params.exclude_patterns,
      sitemap: params.sitemap,
      formats: params.formats,
      extraction_schema: params.extraction_schema,
      max_concurrency: params.max_concurrency,
      respect_robots: params.respect_robots,
      include_subdomains: params.include_subdomains,
      webhook_url: params.webhook_url,
      advanced: {
        render_js: params.render_js,
        use_proxy: params.use_proxy,
      },
    });

    const text =
      `**Crawl Started**\n\n` +
      `- Crawl ID: \`${response.crawl_id}\`\n` +
      `- Status: ${response.status}\n` +
      `- Start URL: ${response.url}\n` +
      `- Max pages: ${params.max_pages}\n` +
      `- Max depth: ${params.max_depth}\n\n` +
      `Use \`alterlab_crawl_status\` with crawl_id \`${response.crawl_id}\` to poll for results.\n` +
      `Crawls run asynchronously — check back after a few minutes for large sites.`;

    return { content: [{ type: "text", text }] };
  } catch (error) {
    if (isApiError(error)) {
      return formatErrorResult(error, { url: params.url });
    }
    return formatErrorResult(error as Error, { url: params.url });
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
