import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";
import { formatScrapeResponse } from "../format.js";

const tierEnum = z.enum(["1", "2", "3", "3.5", "4"]);

const costControlsSchema = z
  .object({
    force_tier: tierEnum
      .optional()
      .describe(
        "Pin execution to this exact tier, bypassing escalation " +
          "(1=curl $0.0002, 2=http $0.0003, 3=stealth $0.002, 3.5=lightjs $0.0025, 4=browser $0.004). " +
          "Use to guarantee a specific engine is used regardless of site difficulty.",
      ),
    max_tier: tierEnum
      .optional()
      .describe(
        "Cap automatic escalation at this tier. Scrape will not escalate beyond it even if lower tiers fail. " +
          "Cannot exceed force_tier when both are set.",
      ),
    max_credits: z
      .number()
      .positive()
      .optional()
      .describe("Hard spending cap for this request in credits. Request fails if cost would exceed this."),
    prefer_cost: z
      .boolean()
      .optional()
      .describe("Optimize for cost — try cheaper tiers first, accept lower success probability"),
    prefer_speed: z
      .boolean()
      .optional()
      .describe("Optimize for speed — skip to the most reliable tier for this domain"),
    fail_fast: z
      .boolean()
      .optional()
      .describe("Return error instead of escalating to more expensive tiers on failure"),
    time_budget: z
      .number()
      .min(5)
      .max(300)
      .optional()
      .describe(
        "Total wall-clock budget in seconds for the entire tier escalation sequence (5–300s). " +
          "Escalation stops when remaining budget is insufficient for the next tier attempt.",
      ),
  })
  .optional()
  .describe(
    "Fine-grained cost and tier controls. Use to cap spending, pin a tier, or trade off cost vs speed.",
  );

export const scrapeSchema = z.object({
  url: z.string().url().describe("URL to scrape"),
  method: z
    .enum(["GET", "POST"])
    .default("GET")
    .describe(
      "HTTP method. Default GET (standard page scraping). " +
        "Use POST for GraphQL endpoints, form submissions, and REST API calls. " +
        "When using POST, provide body with the request payload. POST costs 1.5x base tier price.",
    ),
  body: z
    .string()
    .optional()
    .describe(
      "Request body for POST requests. " +
        "For GraphQL: JSON string with 'query' and optional 'variables' fields " +
        '(e.g., \'{"query": "{ user { id name } }"}\').' +
        "For REST APIs: JSON-encoded payload string. " +
        "For form submissions: URL-encoded key=value pairs (e.g., 'name=Alice&email=alice@example.com'). " +
        "Omit for GET requests.",
    ),
  content_type: z
    .enum([
      "application/json",
      "application/x-www-form-urlencoded",
      "text/plain",
      "application/graphql",
    ])
    .optional()
    .describe(
      "Content-Type header for the request body. " +
        "Defaults to 'application/json' when body is provided. " +
        "Use 'application/graphql' for raw GraphQL queries. " +
        "Use 'application/x-www-form-urlencoded' for HTML form submissions. " +
        "Requires body to be set.",
    ),
  mode: z
    .enum(["auto", "html", "js", "pdf", "ocr"])
    .default("auto")
    .describe(
      "Scraping mode: auto (recommended), html, js (headless browser), pdf, or ocr",
    ),
  formats: z
    .array(z.enum(["text", "json", "json_v2", "html", "markdown", "rag"]))
    .default(["markdown"])
    .describe(
      "Output formats. 'markdown' is best for LLM consumption. " +
        "'json_v2' returns a structured section tree (headings + content blocks). " +
        "'rag' returns chunked text optimized for retrieval-augmented generation.",
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
  extraction_prompt: z
    .string()
    .max(2000)
    .optional()
    .describe(
      "Natural language instruction for LLM extraction (max 2000 chars). " +
        "Example: 'Extract the product name, price, availability, and all customer review scores.' " +
        "Result is returned in the extraction_result field.",
    ),
  extraction_profile: z
    .enum(["auto", "product", "article", "job_posting", "faq", "recipe", "event"])
    .optional()
    .describe(
      "Pre-defined extraction profile used as schema template. " +
        "'auto' detects the page type automatically. " +
        "Applies optimized field extraction for the selected content type.",
    ),
  evidence: z
    .boolean()
    .optional()
    .describe(
      "Include provenance/evidence snippets alongside extracted fields. " +
        "Each extracted value will include the source text passage it was derived from.",
    ),
  filter_content: z
    .boolean()
    .optional()
    .describe(
      "Apply quality filtering to extracted content. When false (default), returns all parsed content " +
        "without quality thresholds (lossless mode). When true, filters low-quality boilerplate.",
    ),
  promote_schema_org: z
    .boolean()
    .optional()
    .describe(
      "Use Schema.org structured data as primary content source when available (default true). " +
        "Set false to force extraction from raw HTML instead of embedded JSON-LD.",
    ),
  cache: z
    .boolean()
    .optional()
    .describe(
      "Enable caching for this request. When true, repeat requests with identical parameters may " +
        "return cached results. Only use for idempotent requests (GET pages, read-only POSTs).",
    ),
  cache_ttl: z
    .number()
    .min(60)
    .max(86400)
    .optional()
    .describe(
      "Cache TTL in seconds (60–86400). Defaults to 3600 (60 min) when cache=true. " +
        "Requires cache=true.",
    ),
  force_refresh: z
    .boolean()
    .optional()
    .describe(
      "Force a fresh fetch even when a cached result is available. " +
        "Use to bypass cache for a single request without disabling caching globally.",
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
  cost_controls: costControlsSchema,
});

export const scrapeDescription =
  "Scrape a URL and return its content as markdown, text, HTML, JSON, or structured sections. " +
  "Automatically handles anti-bot protection with tier escalation. " +
  "Returns markdown by default — optimized for LLM context. " +
  "Supports GET (default) and POST via the method parameter. " +
  "Use method='POST' with body for GraphQL APIs, REST endpoints, and form submissions. " +
  "For GraphQL: set body='{\"query\": \"{ ... }\"}' and method='POST'. " +
  "Use render_js=true for JavaScript-heavy sites (React, Angular, SPAs). " +
  "Use render_js='auto' for mixed sites to detect JS needs per-page (saves 30-60%). " +
  "Use use_proxy=true for geo-restricted or heavily protected sites. " +
  "Use formats=['json_v2'] for a structured section tree (headings + content blocks). " +
  "Use formats=['rag'] for chunked text optimized for RAG pipelines. " +
  "Use extraction_schema to extract structured fields from the page using LLM (returned in extraction_result). " +
  "Use extraction_prompt for natural-language extraction instructions. " +
  "Use extraction_profile to apply pre-defined extraction templates (product, article, etc.). " +
  "Use cost_controls to cap spending, pin a tier, or trade off cost vs speed. " +
  "Use cache=true to enable caching for idempotent requests. " +
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
      content_type: params.content_type,
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
      extraction_prompt: params.extraction_prompt,
      extraction_profile: params.extraction_profile,
      evidence: params.evidence,
      filter_content: params.filter_content,
      promote_schema_org: params.promote_schema_org,
      cache: params.cache,
      cache_ttl: params.cache_ttl,
      force_refresh: params.force_refresh,
      cost_controls: params.cost_controls,
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
