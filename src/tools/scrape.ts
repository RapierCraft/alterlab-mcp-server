import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";
import { formatScrapeResponse, formatEstimateInline, formatBalanceWarning } from "../format.js";
import type { UnifiedScrapeRequest } from "../types.js";
import {
  ADVANCED_KEYS,
  FORMATS_DESCRIPTION,
  advancedShape,
  allFormatEnum,
  compact,
  contentTypeEnum,
  costControlsSchema,
  extractionProfileEnum,
  extractionProviderEnum,
  locationSchema,
  modeEnum,
  pickAdvanced,
} from "./common.js";

export const scrapeSchema = z.object({
  url: z.string().url().max(2083).describe("URL to scrape"),
  method: z
    .enum(["GET", "POST"])
    .default("GET")
    .describe(
      "HTTP method for the request. Default GET (standard page scraping). " +
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
  content_type: contentTypeEnum
    .optional()
    .describe(
      "Content-Type header for the request body. " +
        "Defaults to 'application/json' when body is provided. " +
        "Use 'application/graphql' for raw GraphQL queries. " +
        "Use 'application/x-www-form-urlencoded' for HTML form submissions. " +
        "Requires body to be set.",
    ),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Custom HTTP headers to send to the target URL. " +
        "Hop-by-hop headers (Connection, Transfer-Encoding, Host, etc.) are not allowed.",
    ),
  mode: modeEnum
    .default("auto")
    .describe(
      "Scraping mode: auto (recommended), html, js (headless browser), pdf, or ocr",
    ),
  formats: z
    .array(allFormatEnum)
    .default(["markdown"])
    .describe("Output formats. " + FORMATS_DESCRIPTION),
  extraction_schema: z
    .record(z.unknown())
    .optional()
    .describe(
      "JSON schema for structured extraction. " +
        "The API extracts fields matching this schema from the scraped page using LLM (+$0.001). " +
        "Result is returned in extraction_result. " +
        'Example: { "title": "string", "price": "number", "in_stock": "boolean" }',
    ),
  extraction_model: z
    .string()
    .max(256)
    .nullish()
    .describe(
      "Per-request LLM model override in provider-specific format (e.g. 'gpt-4o', 'claude-opus-4-5-20251101', 'llama3-70b-8192'). " +
        "Overrides the model saved in your BYOK key settings for this request only.",
    ),
  extraction_provider: extractionProviderEnum
    .optional()
    .describe(
      "LLM provider to use for extraction. Selects the matching BYOK key registered at " +
        "/dashboard/settings/llm-keys. When omitted, the most recently used registered key " +
        "is used automatically. Requires extraction_schema or extraction_prompt.",
    ),
  extraction_prompt: z
    .string()
    .max(2000)
    .optional()
    .describe(
      "Natural language extraction instruction. Describes what fields to extract from the page. " +
        "Mutually exclusive with extraction_schema. " +
        'Example: "Extract the product name, price, and availability".',
    ),
  extraction_profile: extractionProfileEnum
    .optional()
    .describe(
      "Pre-built extraction schema template. " +
        "auto: detect best template (API default). product: e-commerce product details. " +
        "article: news/blog article fields. job_posting: job listing fields. " +
        "faq: FAQ entries. recipe: recipe ingredients and instructions. " +
        "event: event details. ecommerce_homepage: homepage product listings. " +
        "directory_listing: directory/listing page entries. " +
        "Mutually exclusive with extraction_template.",
    ),
  extraction_template: extractionProfileEnum
    .optional()
    .describe(
      "Shorthand alias for extraction_profile — selects the same pre-built template. " +
        "Mutually exclusive with extraction_profile.",
    ),
  template: z
    .string()
    .optional()
    .describe(
      "DEPRECATED alias for extraction_template, kept for backward compatibility. " +
        "Sent to the API as extraction_template; prefer extraction_template.",
    ),
  evidence: z
    .boolean()
    .optional()
    .describe(
      "Include provenance/evidence snippets alongside extracted fields. " +
        "Each extracted value will include the source text passage it was derived from. " +
        "Requires extraction_schema or extraction_prompt.",
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
      "Use Schema.org JSON-LD/Microdata as the primary structured-data source when present (API default true). " +
        "Promotes machine-readable metadata embedded in the page over LLM extraction. " +
        "Most effective on e-commerce, recipe, and news article pages.",
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
    .int()
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
      "Bypass the cache and always fetch a fresh copy of the page. " +
        "Use when you need real-time content and a cached result would be stale.",
    ),
  include_raw_html: z
    .boolean()
    .default(false)
    .describe("Include raw HTML in the response alongside formatted content"),
  max_response_bytes: z
    .number()
    .int()
    .min(0)
    .max(52_428_800)
    .optional()
    .describe(
      "Soft cap on raw response body size in bytes. " +
        "When the downloaded HTML exceeds this value it is truncated before extraction. " +
        "Default: 5 MB (5242880). Set to 0 for no limit. Maximum: 50 MB (52428800). " +
        "Useful for very large pages where you only need the beginning of the content.",
    ),
  timeout: z
    .number()
    .int()
    .min(1)
    .max(300)
    .default(90)
    .describe("Request timeout in seconds (1-300)"),
  wait_for: z
    .string()
    .optional()
    .describe(
      "CSS selector to wait for before extracting content (e.g., '#main-content')",
    ),
  wait_until: z
    .string()
    .optional()
    .describe(
      "Page load event to wait for before extracting (networkidle, domcontentloaded or load; API default networkidle)",
    ),
  screenshot: z
    .boolean()
    .optional()
    .describe(
      "Capture a full-page screenshot (+$0.0002, requires render_js). The URL is returned as screenshot_url. " +
        "Use alterlab_screenshot to get the image inline.",
    ),
  enable_scroll: z
    .boolean()
    .nullish()
    .describe(
      "Force scrolling for lazy-load images. true: always scroll (+5-10s), false: never scroll, " +
        "omit: auto (scroll unless social media site).",
    ),
  pdf_format: z
    .string()
    .optional()
    .describe("Output format for mode='pdf' extraction (API default 'markdown')"),
  ocr_language: z
    .string()
    .optional()
    .describe("Tesseract language code for OCR (API default 'eng')"),
  sync_policy: z
    .enum(["auto", "wait_until_deadline"])
    .optional()
    .describe(
      "Synchronous wait policy. 'auto' (default) may return an early 202 with a job_id for predicted T3/T4 jobs; " +
        "'wait_until_deadline' keeps the connection open until the terminal result or the safe sync deadline (~85s).",
    ),
  embeddings: z
    .object({
      enabled: z.boolean().optional(),
      model: z
        .enum(["text-embedding-3-small", "text-embedding-3-large"])
        .optional(),
      chunk_size: z.number().int().min(64).max(8191).optional(),
      chunk_overlap: z.number().int().min(0).max(2048).optional(),
    })
    .optional()
    .describe(
      "Chunk the scraped text and embed it with OpenAI models (+$0.001 per page). " +
        "Set enabled=true; model, chunk_size (64-8191) and chunk_overlap (0-2048) are optional.",
    ),
  ...advancedShape,
  location: locationSchema.optional(),
  prefer_cost: z
    .boolean()
    .optional()
    .describe(
      "Optimize for lowest cost — try cheaper tiers first before escalating. " +
        "Shorthand for cost_controls.prefer_cost. Mutually exclusive intent with prefer_speed.",
    ),
  prefer_speed: z
    .boolean()
    .optional()
    .describe(
      "Optimize for speed — skip to a reliable tier immediately instead of escalating from Tier 1. " +
        "Shorthand for cost_controls.prefer_speed. Mutually exclusive intent with prefer_cost.",
    ),
  fail_fast: z
    .boolean()
    .optional()
    .describe(
      "Fail immediately if the page requires an expensive tier (browser/captcha) instead of auto-escalating. " +
        "Shorthand for cost_controls.fail_fast. Returns an error with the required tier instead of upgrading.",
    ),
  cost_controls: costControlsSchema.optional(),
  estimate_first: z
    .boolean()
    .default(false)
    .describe(
      "Run a cost estimate before scraping and include it in the response. " +
        "Adds one lightweight API call (~50ms) with no credit charge. " +
        "The estimated tier, cost, and confidence are prepended to the scrape result. " +
        "Useful for unfamiliar or potentially expensive sites — see cost before committing.",
    ),

  // ── Auto-generated from OpenAPI spec ──
  actions:
    z.union([z.array(z.unknown()), z.unknown()]).optional().describe("Browser automation actions to execute after page load (max 20). Requires render_js=true. Actions execute sequentially; failed actions are skipped (don't abort the sequence). Results returned in action_results."),
  block_images:
    z.union([z.boolean(), z.unknown()]).optional().describe("Skip image downloads during browser rendering to reduce proxy bandwidth. When true, the browser aborts image requests — <img> src URLs remain in the DOM so HTML and text extraction are unaffected, but image bytes are not downloaded. When false, all images are downloaded (higher bandwidth, needed for visual accuracy). When null (default), the per-domain playbook setting is used. Most domains default to blocking images (true) to save bandwidth. E-commerce domains like amazon.com default to false because their anti-bot systems monitor resource loading patterns — browsers that never request images are more likely to be flagged as bots. Note: screenshot and generate_pdf always override this to false regardless of the value passed — images are required for accurate visual output."),
  cookies:
    z.union([z.record(z.unknown()), z.unknown()]).optional().describe("Inline cookies for one-off authenticated scraping (not stored). Mutually exclusive with session_id."),
  flatten_shadow_dom:
    z.boolean().default(false).describe("Flatten Shadow DOM roots into regular DOM for extraction (free, requires render_js). Web Components with shadow roots become visible in the serialized HTML."),
  generate_pdf:
    z.boolean().default(false).describe("Generate PDF of rendered page (+$0.0004, requires render_js)"),
  include_iframes:
    z.boolean().default(false).describe("Inline iframe content into the main document (free, requires render_js). Same-origin iframes are read directly; cross-origin iframes are marked but not fetched."),
  markdown:
    z.boolean().default(false).describe("Extract content as Markdown (free)"),
  ocr:
    z.boolean().default(false).describe("Extract text from images using OCR (+$0.001)"),
  proxy_country:
    z.union([z.string(), z.unknown()]).optional().describe("Preferred proxy country code (e.g., 'US', 'DE') for geo-targeting"),
  proxy_integration_id:
    z.union([z.string(), z.unknown()]).optional().describe("Specific proxy integration ID to use (requires use_own_proxy=true)"),
  remove_cookie_banners:
    z.boolean().default(true).describe("Remove cookie consent banners from HTML before content extraction (free, enabled by default)"),
  render_js:
    z.union([z.boolean(), z.string()]).default(false).describe("Render JavaScript using headless browser (forces Tier 4 minimum). Set to \"auto\" for smart detection: probes each page and only renders JS-heavy pages with browser, using fast HTTP for static pages. Saves 30-60% on mixed sites."),
  scroll_count:
    z.number().default(3).describe("Number of scroll iterations when scroll_to_load is enabled (1-10, default 3)."),
  scroll_to_load:
    z.boolean().default(false).describe("Scroll page to trigger lazy-loaded content (requires render_js). Performs explicit viewport-height scrolls to load dynamic content. Adds ~2-3s latency."),
  section_filter:
    z.union([z.unknown()]).optional().describe("Filter options for json_v2 section tree output. Only applies when 'json_v2' is in the formats list. Controls which sections and content blocks are included in the response."),
  session_headers:
    z.union([z.record(z.unknown()), z.unknown()]).optional().describe("Inline auth headers (e.g. Authorization: Bearer). Merged with session headers if session_id is also resolving headers."),
  session_id:
    z.union([z.string(), z.unknown()]).optional().describe("Reference to a stored SessionIntegration. Injects stored cookies/headers for authenticated scraping."),
  skip_tls_verification:
    z.union([z.boolean(), z.unknown()]).optional().describe("TLS certificate verification for the target. Omit it (recommended): certificates are verified, and if the site's own certificate is invalid (expired, self-signed, wrong hostname, incomplete chain) the page is still fetched without verification. Set true to skip verification from the start. Set false to always require a valid certificate; sites with an invalid certificate then fail."),
  sticky_session:
    z.union([z.string(), z.unknown()]).optional().describe("Customer-facing sticky-session handle. Two separate /scrape calls that pass the same sticky_session value reuse the cookies captured on the first call (see captured_cookies in the response) for the handle's TTL, and target the SAME exit IP on a best-effort basis. Note the exit IP is only guaranteed to hold for the upstream residential-session window (~10 minutes) — for longer TTLs the shared cookie jar persists but the exit IP may rotate. Enables stateful multi-request flows — e.g. request 1 loads a page, request 2 fetches the captcha/image that appeared using request 1's cookie jar (and, within ~10 min, the same IP). Requires a paid plan (growth tier or above). Alphanumeric, '-' and '_' only, max 128 chars."),
  sticky_session_ttl:
    z.union([z.number(), z.unknown()]).optional().describe("Sticky-session lifetime in seconds (300–7200, default 1800). This governs how long the captured cookie jar bound to sticky_session is retained; after it the handle resolves to a fresh jar. The exit-IP pin is separate and shorter — it holds only for the upstream residential-session window (~10 minutes), so a TTL above that keeps the cookie jar alive while the exit IP may rotate. Ignored unless sticky_session is set."),
  use_own_proxy:
    z.boolean().default(false).describe("Use your own integrated proxy instead of system proxy ($0.0008/request)"),
  use_proxy:
    z.boolean().optional().describe("Route request through premium proxy (+$0.0002). Omit this field to allow platform-driven reactive proxy routing; explicit false keeps direct routing."),
  use_system_proxy:
    z.boolean().default(false).describe("Override your default proxy integration and use AlterLab's system proxy instead"),
  wait_condition:
    z.string().default("networkidle").describe("Wait condition for JS rendering (domcontentloaded|networkidle|load)"),
});

export const scrapeDescription =
  "Get data from any website, bypass Cloudflare and anti-bot protection, scrape JavaScript-rendered pages, " +
  "or fetch content from dynamic single-page apps. " +
  "Turn any URL into clean, LLM-ready markdown — or get text, HTML, JSON, and structured sections. " +
  "Automatically bypasses anti-bot protection (Cloudflare, Akamai, DataDome, PerimeterX, hCaptcha) " +
  "with intelligent tier escalation — no manual configuration needed. " +
  "Cost-efficient: tier 1 (curl) is $0.0002/page, tier 2 (http) $0.0003, tier 3 (stealth) $0.002, " +
  "tier 3.5 (lightjs) $0.0025, tier 4 (browser) $0.004; you only pay for the tier that succeeds. " +
  "Add-ons: screenshot +$0.0002, generate_pdf +$0.0004, ocr +$0.001, use_proxy +$0.0002, " +
  "LLM extraction +$0.001, embeddings +$0.001; method='POST' costs 1.5x. " +
  "Returns markdown by default — optimized for LLM context. " +
  "Supports GET (default) and POST via the method parameter. " +
  "Use method='POST' with body for GraphQL APIs, REST endpoints, and form submissions. " +
  "Use content_type to set the POST body Content-Type (json, urlencoded, graphql, plain). " +
  "Use headers to send custom HTTP headers to the target. " +
  "Use render_js=true to scrape dynamic pages, JavaScript-heavy sites (React, Angular, Vue, SPAs). " +
  "Use render_js='auto' for mixed sites to detect JS needs per-page (saves 30-60%). " +
  "Use actions (click, fill, press, scroll, wait_for, evaluate, ...) to drive the page before extraction. " +
  "Use use_proxy=true for geo-restricted or heavily protected sites; use_own_proxy for your own proxy integration. " +
  "Use sticky_session to reuse cookies and exit IP across calls. " +
  "Use skip_tls_verification only for sites with broken certificates. " +
  "Use formats=['json_v2'] for a structured section tree (headings + content blocks). " +
  "Use formats=['rag'] for chunked text optimized for RAG pipelines. " +
  "Use formats=['raw'] for the raw response body without extraction. " +
  "Use formats=['content'] for AI/KB pipelines — returns body_markdown, content_hash, images, links. " +
  "Use extraction_schema to extract structured fields from the page using LLM. " +
  "Use extraction_prompt for natural language extraction instructions. " +
  "Use extraction_profile or extraction_template for pre-built templates (product, article, job_posting, etc.). " +
  "Use evidence=true to include source passages alongside extracted fields. " +
  "Use embeddings to chunk and embed the scraped text. " +
  "Use cache=true and cache_ttl to enable response caching. " +
  "Use cost_controls to cap spending, pin a tier, or set a time budget. " +
  "Supports authenticated scraping via session_id, inline cookies or session_headers. " +
  "Use scroll_to_load=true for infinite-scroll pages. " +
  "Use location.country to scrape geo-targeted content from any region. " +
  "Use prefer_cost=true to minimize credit spend (starts from cheapest tier). " +
  "Use prefer_speed=true to skip to a fast reliable tier immediately. " +
  "Use fail_fast=true to error instead of auto-escalating to expensive tiers. " +
  "Use force_refresh=true to bypass cache and always fetch live content. " +
  "Use promote_schema_org=true to prefer Schema.org JSON-LD over LLM extraction on structured pages. " +
  "Use estimate_first=true to run a free cost estimate before scraping (prepended to the result). " +
  "If a long-running scrape returns a job_id instead of content, the job continues server-side.";

type ScrapeParams = z.infer<typeof scrapeSchema>;

/** Merge the top-level prefer_cost/prefer_speed/fail_fast shorthands into cost_controls (explicit cost_controls wins). */
function buildCostControls(params: ScrapeParams) {
  const merged = compact({
    prefer_cost: params.prefer_cost,
    prefer_speed: params.prefer_speed,
    fail_fast: params.fail_fast,
    ...(params.cost_controls ?? {}),
  });
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * Translate flat tool parameters into the API's UnifiedScrapeRequest body.
 * Exported for tests.
 */
export function buildScrapeRequest(params: ScrapeParams): UnifiedScrapeRequest {
  const advanced = pickAdvanced(params, ADVANCED_KEYS);
  advanced.markdown = params.formats.includes("markdown");
  if (params.screenshot !== undefined) advanced.screenshot = params.screenshot;

  return {
    ...compact({
      url: params.url,
      method: params.method,
      body: params.body,
      content_type: params.content_type,
      headers: params.headers,
      mode: params.mode,
      formats: params.formats,
      sync: true,
      sync_policy: params.sync_policy,
      timeout: params.timeout,
      max_response_bytes: params.max_response_bytes,
      include_raw_html: params.include_raw_html,
      wait_for: params.wait_for,
      wait_until: params.wait_until,
      screenshot: params.screenshot,
      enable_scroll: params.enable_scroll ?? undefined,
      pdf_format: params.pdf_format,
      ocr_language: params.ocr_language,
      location: params.location,
      extraction_schema: params.extraction_schema,
      extraction_prompt: params.extraction_prompt,
      extraction_model: params.extraction_model ?? undefined,
      extraction_provider: params.extraction_provider,
      extraction_profile: params.extraction_profile,
      extraction_template:
        params.extraction_template ??
        (params.template as UnifiedScrapeRequest["extraction_template"]),
      evidence: params.evidence,
      filter_content: params.filter_content,
      cache: params.cache,
      cache_ttl: params.cache_ttl,
      force_refresh: params.force_refresh,
      promote_schema_org: params.promote_schema_org,
      embeddings: params.embeddings,
      cost_controls: buildCostControls(params),
    }),
    advanced,
  } as UnifiedScrapeRequest;
}

/**
 * Cost-estimate request for the same scrape. The estimate endpoint prices from
 * url, mode, method, formats and the cost-bearing advanced flags only.
 */
export function buildEstimateRequest(params: {
  url: string;
  mode?: ScrapeParams["mode"];
  method?: ScrapeParams["method"];
  formats?: ScrapeParams["formats"];
  render_js?: ScrapeParams["render_js"];
  use_proxy?: boolean;
  use_own_proxy?: boolean;
  screenshot?: boolean;
  generate_pdf?: boolean;
  ocr?: boolean;
}): UnifiedScrapeRequest {
  return {
    ...compact({
      url: params.url,
      mode: params.mode,
      method: params.method,
      formats: params.formats,
    }),
    advanced: compact({
      render_js: params.render_js,
      use_proxy: params.use_proxy,
      use_own_proxy: params.use_own_proxy,
      screenshot: params.screenshot,
      generate_pdf: params.generate_pdf,
      ocr: params.ocr,
    }),
  } as UnifiedScrapeRequest;
}

export async function handleScrape(
  client: AlterLabClient,
  params: ScrapeParams,
): Promise<CallToolResult> {
  // Optional pre-flight cost estimate — runs before the scrape, no credits charged.
  // On failure, degrade gracefully: prepend a warning and continue with the scrape.
  let estimatePrefix = "";
  if (params.estimate_first) {
    try {
      const estimate = await client.estimate(buildEstimateRequest(params));
      estimatePrefix = formatEstimateInline(estimate) + "\n";
    } catch {
      estimatePrefix =
        "> **Pre-flight estimate**: unavailable (estimate API call failed — proceeding with scrape).\n\n";
    }
  }

  try {
    const response = await client.scrape(buildScrapeRequest(params));

    const balanceWarningSuffix = formatBalanceWarning(client.getLastBalanceWarning());
    return {
      content: [{ type: "text", text: estimatePrefix + formatScrapeResponse(response) + balanceWarningSuffix }],
    };
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

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as ApiError).status === "number"
  );
}