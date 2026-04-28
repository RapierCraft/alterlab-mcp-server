import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";

export const mapSchema = z.object({
  url: z.string().url().describe("Starting URL for site discovery"),
  max_pages: z
    .number()
    .int()
    .min(1)
    .max(50000)
    .default(500)
    .describe("Maximum URLs to discover"),
  max_depth: z
    .number()
    .int()
    .min(0)
    .max(10)
    .default(3)
    .describe("Link-following depth (0 = start page + sitemap only)"),
  include_patterns: z
    .array(z.string())
    .optional()
    .describe(
      "Glob patterns — only include URLs whose path matches at least one (e.g., ['/docs/*'])",
    ),
  exclude_patterns: z
    .array(z.string())
    .optional()
    .describe(
      "Glob patterns — exclude URLs whose path matches any (e.g., ['/tag/*', '/page/*'])",
    ),
  search: z
    .string()
    .max(500)
    .optional()
    .describe(
      "Query to filter and rank discovered URLs by relevance (returns relevance_score per URL)",
    ),
  sitemap: z
    .enum(["skip", "include", "only"])
    .default("include")
    .describe(
      "Sitemap handling: include (parse sitemaps + follow links), skip (links only), only (sitemap URLs only)",
    ),
  include_metadata: z
    .boolean()
    .default(false)
    .describe(
      "Fetch title and meta description for each URL via lightweight GET (adds latency)",
    ),
  include_subdomains: z
    .boolean()
    .default(false)
    .describe("Include URLs from subdomains of the target domain"),
  respect_robots: z
    .boolean()
    .default(true)
    .describe("Respect robots.txt directives"),
});

export const mapDescription =
  "Discover all URLs on a website via sitemap parsing and link extraction. " +
  "No JS rendering, no content scraping — pure lightweight URL discovery. " +
  "Costs $0.001 per call regardless of how many URLs are found. " +
  "Returns a flat list of URLs with source (sitemap/link) and depth. " +
  "Use include_patterns/exclude_patterns to scope discovery to specific sections. " +
  "Use search to rank URLs by relevance to a query. " +
  "Use include_metadata=true to also fetch page titles and descriptions.";

export async function handleMap(
  client: AlterLabClient,
  params: z.infer<typeof mapSchema>,
): Promise<CallToolResult> {
  try {
    const response = await client.map({
      url: params.url,
      max_pages: params.max_pages,
      max_depth: params.max_depth,
      include_patterns: params.include_patterns,
      exclude_patterns: params.exclude_patterns,
      search: params.search,
      sitemap: params.sitemap,
      include_metadata: params.include_metadata,
      include_subdomains: params.include_subdomains,
      respect_robots: params.respect_robots,
    });

    const text = formatMapResponse(response, params.url);
    return { content: [{ type: "text", text }] };
  } catch (error) {
    if (isApiError(error)) {
      return formatErrorResult(error, { url: params.url });
    }
    return formatErrorResult(error as Error, { url: params.url });
  }
}

function formatMapResponse(response: unknown, startUrl: string): string {
  const r = response as Record<string, unknown>;
  const mapId = String(r.map_id ?? "");
  const totalUrls = Number(r.total_urls ?? 0);
  const sitemapFound = Boolean(r.sitemap_found);
  const creditsUsed = Number(r.credits_used ?? 0);
  const urls = Array.isArray(r.urls) ? r.urls : [];

  const parts: string[] = [
    `**Site Map: ${startUrl}**\n`,
    `- Map ID: \`${mapId}\``,
    `- URLs discovered: ${totalUrls}`,
    `- Sitemap found: ${sitemapFound ? "Yes" : "No"}`,
    `- Credits used: ${creditsUsed}`,
    "",
  ];

  // robots.txt info
  const robotsTxt = r.robots_txt as Record<string, unknown> | undefined;
  if (robotsTxt && robotsTxt.exists) {
    const disallowed = Array.isArray(robotsTxt.disallowed_paths)
      ? robotsTxt.disallowed_paths
      : [];
    if (disallowed.length > 0) {
      parts.push(
        `**robots.txt**: ${disallowed.length} disallowed path${disallowed.length !== 1 ? "s" : ""}`,
      );
    }
  }

  // Show up to 50 URLs
  const preview = urls.slice(0, 50);
  if (preview.length > 0) {
    parts.push(
      `\n**Discovered URLs** (showing ${preview.length} of ${totalUrls}):\n`,
    );
    for (const entry of preview) {
      const e = entry as Record<string, unknown>;
      const url = String(e.url ?? "");
      const source = String(e.source ?? "");
      const depth = Number(e.depth ?? 0);
      const title = e.title ? ` — ${String(e.title)}` : "";
      const score =
        e.relevance_score !== null && e.relevance_score !== undefined
          ? ` [relevance: ${Number(e.relevance_score).toFixed(2)}]`
          : "";
      parts.push(`- [${source}, depth ${depth}] ${url}${title}${score}`);
    }
    if (totalUrls > 50) {
      parts.push(`\n... and ${totalUrls - 50} more URLs`);
    }
  } else {
    parts.push("No URLs discovered.");
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
