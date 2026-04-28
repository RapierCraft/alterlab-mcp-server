import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";

export const searchSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .describe("Search query (max 500 characters)"),
  num_results: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(10)
    .describe("Number of results to return (1-30)"),
  page: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(1)
    .describe(
      "Result page number (1-indexed). Page 2 returns results 11-20, etc.",
    ),
  domain: z
    .string()
    .optional()
    .describe(
      "Restrict results to a specific domain (applied as site: prefix, e.g. 'docs.example.com')",
    ),
  country: z
    .string()
    .length(2)
    .optional()
    .describe(
      "ISO 3166-1 alpha-2 country code for geo-targeted results (e.g., 'US', 'GB', 'DE')",
    ),
  language: z
    .string()
    .min(2)
    .max(5)
    .optional()
    .describe("Language code for results (e.g., 'en', 'fr', 'de')"),
  time_range: z
    .enum(["hour", "day", "week", "month", "year"])
    .optional()
    .describe("Filter results by recency"),
  scrape_results: z
    .boolean()
    .default(false)
    .describe(
      "If true, scrape each result page and include content in response. " +
        "Each page is billed at its scraping tier cost in addition to the base search fee.",
    ),
  formats: z
    .array(z.enum(["text", "json", "json_v2", "html", "markdown"]))
    .optional()
    .describe("Output formats when scrape_results=true"),
  extraction_schema: z
    .record(z.unknown())
    .optional()
    .describe("JSON schema for structured extraction when scrape_results=true"),
});

export const searchDescription =
  "Execute a web search and return SERP results (URLs, titles, snippets). " +
  "Uses AlterLab's own SERP engine with Google/Bing/DuckDuckGo multi-engine failover. " +
  "Costs $0.001 per search query. " +
  "Set scrape_results=true to also scrape each result page and get full content — " +
  "each page is billed at its normal scraping tier cost. " +
  "Use domain to restrict results to a specific site (equivalent to site: operator). " +
  "Use time_range to filter by recency (hour/day/week/month/year).";

export async function handleSearch(
  client: AlterLabClient,
  params: z.infer<typeof searchSchema>,
): Promise<CallToolResult> {
  try {
    const response = await client.search({
      query: params.query,
      num_results: params.num_results,
      page: params.page,
      domain: params.domain,
      country: params.country,
      language: params.language,
      time_range: params.time_range,
      scrape_results: params.scrape_results,
      formats: params.formats,
      extraction_schema: params.extraction_schema,
    });

    const text = formatSearchResponse(response, params.query);
    return { content: [{ type: "text", text }] };
  } catch (error) {
    if (isApiError(error)) {
      return formatErrorResult(error, { url: params.query });
    }
    return formatErrorResult(error as Error, { url: params.query });
  }
}

function formatSearchResponse(response: unknown, query: string): string {
  const resp = response as Record<string, unknown>;
  const searchId = String(resp.search_id ?? "");
  const results = Array.isArray(resp.results) ? resp.results : [];
  const resultsCount = Number(resp.results_count ?? results.length);
  const creditsUsed = Number(resp.credits_used ?? 0);
  const costBreakdown = resp.cost_breakdown as
    | Record<string, unknown>
    | undefined;

  const parts: string[] = [
    `**Search Results for: "${query}"**\n`,
    `Found ${resultsCount} result${resultsCount !== 1 ? "s" : ""} | Search ID: \`${searchId}\`\n`,
  ];

  for (const result of results) {
    const r = result as Record<string, unknown>;
    const position = Number(r.position ?? 0);
    const title = String(r.title ?? "Untitled");
    const url = String(r.url ?? "");
    const snippet = String(r.snippet ?? "");
    const datePublished = r.date_published
      ? ` (${String(r.date_published)})`
      : "";

    parts.push(`**${position}. ${title}**${datePublished}`);
    parts.push(`${url}`);
    parts.push(`${snippet}\n`);

    // Include scraped content if available
    const content = r.content as Record<string, unknown> | undefined;
    if (content) {
      const scrapeText =
        (content.markdown as string | undefined) ||
        (content.text as string | undefined);
      if (scrapeText) {
        const preview = scrapeText.slice(0, 500);
        parts.push(`> ${preview}${scrapeText.length > 500 ? "..." : ""}\n`);
      }
    }
  }

  // Cost footer
  parts.push("---");
  if (costBreakdown) {
    const total = Number(costBreakdown.total_microcents ?? 0);
    parts.push(
      `Cost: $${(total / 1_000_000).toFixed(6)} | Credits: ${creditsUsed}`,
    );
  } else {
    parts.push(`Credits used: ${creditsUsed}`);
  }

  // Featured snippet, knowledge panel, PAA
  const featuredSnippet = resp.featured_snippet as
    | Record<string, unknown>
    | undefined;
  if (featuredSnippet) {
    parts.unshift(
      `**Featured Snippet**: ${String(featuredSnippet.content ?? "")}\n`,
    );
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
