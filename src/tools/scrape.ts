import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";
import { formatScrapeResponse } from "../format.js";

export const scrapeSchema = z.object({
  url: z.string().url().describe("URL to scrape"),
  method: z
    .enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
    .default("GET")
    .describe(
      "HTTP method for the request. Default GET (standard page scraping). " +
        "Use POST for GraphQL endpoints, form submissions, REST API calls. " +
        "Use PUT/PATCH for REST API updates. " +
        "When using POST/PUT/PATCH, provide body with the request payload.",
    ),
  body: z
    .string()
    .optional()
    .describe(
      "Request body for POST/PUT/PATCH requests. " +
        "For GraphQL: JSON string with 'query' and optional 'variables' fields " +
        '(e.g., \'{"query": "{ user { id name } }"}\').' +
        "For REST APIs: JSON-encoded payload string. " +
        "For form submissions: URL-encoded key=value pairs (e.g., 'name=Alice&email=alice@example.com'). " +
        "Omit for GET/HEAD/DELETE requests.",
    ),
  mode: z
    .enum(["auto", "html", "js", "pdf", "ocr"])
    .default("auto")
    .describe(
      "Scraping mode: auto (recommended), html, js (headless browser), pdf, or ocr",
    ),
  formats: z
    .array(z.enum(["text", "json", "json_v2", "html", "markdown", "rag", "content"]))
    .default(["markdown"])
    .describe(
      "Output formats. 'markdown' is best for LLM consumption. " +
        "'json_v2' returns a structured section tree (headings + content blocks). " +
        "'rag' returns chunked text optimized for retrieval-augmented generation. " +
        "'content' returns body_markdown + content_hash + images + links for AI/KB pipelines.",
    ),
  extraction_schema: z
    .record(z.unknown())
    .optional()
    .describe(
      "JSON schema for structured extraction. " +
        "The API extracts fields matching this schema from the scraped page using LLM. " +
        "Result is returned in extraction_result. " +
        'Example: { "title": "string", "price": "number", "in_stock": "boolean" }',
    ),
  render_js: z
    .union([z.boolean(), z.literal("auto")])
    .default(false)
    .describe(
      "Render JavaScript using headless browser (forces Tier 4 minimum — no separate add-on charge). " +
        "Required for JS-heavy sites. Set to 'auto' for smart detection (probes each page, " +
        "only renders JS-heavy pages with browser — saves 30-60% on mixed sites).",
    ),
  use_proxy: z
    .boolean()
    .default(false)
    .describe(
      "Route through premium proxy (+$0.0002). Helps bypass geo-restrictions and anti-bot",
    ),
  proxy_country: z
    .string()
    .optional()
    .describe(
      "ISO country code for geo-targeting (e.g., 'US', 'DE'). Requires use_proxy=true",
    ),
  wait_for: z
    .string()
    .optional()
    .describe(
      "CSS selector to wait for before extracting content (e.g., '#main-content')",
    ),
  timeout: z
    .number()
    .min(1)
    .max(300)
    .default(90)
    .describe("Request timeout in seconds (1-300)"),
  max_response_bytes: z
    .number()
    .int()
    .min(0)
    .max(52_428_800)
    .default(5_242_880)
    .optional()
    .describe(
      "Soft cap on raw response body size in bytes. " +
        "When the downloaded HTML exceeds this value it is truncated before extraction. " +
        "Default: 5 MB (5242880). Set to 0 for no limit. Maximum: 50 MB (52428800). " +
        "Useful for very large pages where you only need the beginning of the content.",
    ),
  include_raw_html: z
    .boolean()
    .default(false)
    .describe("Include raw HTML in the response alongside formatted content"),
  session_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      "UUID of a stored session for authenticated scraping. " +
        "Use alterlab_list_sessions to find available sessions. " +
        "The session's cookies will be injected into the request.",
    ),
  cookies: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Inline cookies as key-value pairs for authenticated scraping " +
        '(e.g., {"session_token": "abc123"}). ' +
        "Use this for one-off requests; use session_id for reusable sessions.",
    ),
  scroll_to_load: z
    .boolean()
    .default(false)
    .describe(
      "Scroll page to trigger lazy-loaded content (requires render_js). " +
        "Performs explicit viewport-height scrolls to load dynamic content. Adds ~2-3s latency.",
    ),
  scroll_count: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(3)
    .optional()
    .describe(
      "Number of scroll iterations when scroll_to_load is enabled (1-10, default 3)",
    ),
  remove_cookie_banners: z
    .boolean()
    .default(true)
    .describe(
      "Remove cookie consent banners from HTML before content extraction (free, enabled by default)",
    ),
  location: z
    .object({
      country: z
        .string()
        .length(2)
        .optional()
        .describe(
          "ISO 3166-1 alpha-2 country code for geo-targeting (e.g., 'US', 'DE', 'JP'). " +
            "Routes request through a proxy in the specified country.",
        ),
      language: z
        .string()
        .min(2)
        .max(5)
        .optional()
        .describe(
          "ISO 639-1 language code (e.g., 'en', 'de', 'ja'). " +
            "Sets the Accept-Language header and browser locale.",
        ),
    })
    .optional()
    .describe(
      "Geo-targeting parameters for localized content scraping. " +
        "Controls proxy country routing, Accept-Language header, and browser locale.",
    ),
});

export const scrapeDescription =
  "Scrape a URL and return its content as markdown, text, HTML, JSON, or structured sections. " +
  "Automatically handles anti-bot protection with tier escalation. " +
  "Returns markdown by default — optimized for LLM context. " +
  "Supports GET (default) and POST/PUT/PATCH/DELETE/HEAD via the method parameter. " +
  "Use method='POST' with body for GraphQL APIs, REST endpoints, and form submissions. " +
  "For GraphQL: set body='{\"query\": \"{ ... }\"}' and method='POST'. " +
  "Use render_js=true for JavaScript-heavy sites (React, Angular, SPAs). " +
  "Use render_js='auto' for mixed sites to detect JS needs per-page (saves 30-60%). " +
  "Use use_proxy=true for geo-restricted or heavily protected sites. " +
  "Use formats=['json_v2'] for a structured section tree (headings + content blocks). " +
  "Use formats=['rag'] for chunked text optimized for RAG pipelines. " +
  "Use formats=['content'] for AI/KB pipelines — returns body_markdown, content_hash, images, links. " +
  "Use extraction_schema to extract structured fields from the page using LLM (returned in extraction_result). " +
  "Supports authenticated scraping via session_id (stored session) or inline cookies. " +
  "Use scroll_to_load=true for infinite-scroll pages that lazy-load content. " +
  "Use location.country to scrape geo-targeted content.";

export async function handleScrape(
  client: AlterLabClient,
  params: z.infer<typeof scrapeSchema>,
): Promise<CallToolResult> {
  try {
    const response = await client.scrape({
      url: params.url,
      method: params.method,
      body: params.body,
      mode: params.mode,
      formats: params.formats,
      sync: true,
      timeout: params.timeout,
      max_response_bytes: params.max_response_bytes,
      include_raw_html: params.include_raw_html,
      wait_for: params.wait_for,
      session_id: params.session_id,
      cookies: params.cookies,
      location: params.location,
      extraction_schema: params.extraction_schema,
      advanced: {
        render_js: params.render_js,
        use_proxy: params.use_proxy,
        proxy_country: params.proxy_country,
        markdown: params.formats.includes("markdown"),
        scroll_to_load: params.scroll_to_load,
        scroll_count: params.scroll_count,
        remove_cookie_banners: params.remove_cookie_banners,
      },
    });

    return {
      content: [{ type: "text", text: formatScrapeResponse(response) }],
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
