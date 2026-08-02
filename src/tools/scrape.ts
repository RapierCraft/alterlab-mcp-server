import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";
import { formatScrapeResponse, formatEstimateInline, formatBalanceWarning } from "../format.js";

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
      .describe(
        "Hard spending cap for this request in credits. Request fails if cost would exceed this.",
      ),
    prefer_cost: z
      .boolean()
      .optional()
      .describe(
        "Optimize for cost — try cheaper tiers first, accept lower success probability.",
      ),
    prefer_speed: z
      .boolean()
      .optional()
      .describe(
        "Optimize for speed — skip to the most reliable tier for this domain.",
      ),
    fail_fast: z
      .boolean()
      .optional()
      .describe(
        "Return error instead of escalating to more expensive tiers on failure.",
      ),
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
    "Fine-grained cost and tier controls. Use to cap spending, pin a tier, or trade off cost vs speed. " +
      "Prefer these over the top-level prefer_cost/prefer_speed/fail_fast fields for full control.",
  );

export const scrapeSchema = z.object({
  url: z.string().url().describe("URL to scrape"),
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
    .array(
      z.enum(["text", "json", "json_v2", "html", "markdown", "rag", "raw", "content"]),
    )
    .default(["markdown"])
    .describe(
      "Output formats. 'markdown' is best for LLM consumption. " +
        "'json_v2' returns a structured section tree (headings + content blocks). " +
        "'rag' returns chunked text optimized for retrieval-augmented generation. " +
        "'raw' returns the raw response body without extraction. " +
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
  extraction_model: z
    .string()
    .nullish()
    .describe(
      "Per-request LLM model override in provider-specific format (e.g. 'gpt-4o', 'claude-opus-4-5-20251101', 'llama3-70b-8192'). " +
        "Overrides the model saved in your BYOK key settings for this request only.",
    ),
  extraction_provider: z
    .enum(["openai", "anthropic", "openrouter", "groq"])
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
  extraction_profile: z
    .enum([
      "auto",
      "product",
      "article",
      "job_posting",
      "faq",
      "recipe",
      "event",
      "ecommerce_homepage",
      "directory_listing",
    ])
    .optional()
    .describe(
      "Pre-built extraction schema template. " +
        "auto: detect best template. product: e-commerce product details. " +
        "article: news/blog article fields. job_posting: job listing fields. " +
        "faq: FAQ entries. recipe: recipe ingredients and instructions. " +
        "event: event details. ecommerce_homepage: homepage product listings. " +
        "directory_listing: directory/listing page entries.",
    ),
  template: z
    .string()
    .optional()
    .describe(
      "Named extraction template to apply to the scrape result. " +
        "Accepts standard template names (e.g. 'product', 'article', 'job_posting') " +
        "or a custom template name registered in your account. " +
        "When provided, routes the request through template-based extraction.",
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
  block_images: z
    .boolean()
    .default(false)
    .describe(
      "Block image downloads during browser rendering. " +
        "Reduces proxy bandwidth and speeds up scrapes. Only effective with render_js=true.",
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
  prefer_cost: z
    .boolean()
    .optional()
    .describe(
      "Optimize for lowest cost — try cheaper tiers first before escalating. " +
        "Best for non-time-sensitive scrapes where minimizing credit spend matters. " +
        "Mutually exclusive intent with prefer_speed.",
    ),
  prefer_speed: z
    .boolean()
    .optional()
    .describe(
      "Optimize for speed — skip to a reliable tier immediately instead of escalating from Tier 1. " +
        "Best for time-sensitive scrapes where latency matters more than cost. " +
        "Mutually exclusive intent with prefer_cost.",
    ),
  fail_fast: z
    .boolean()
    .optional()
    .describe(
      "Fail immediately if the page requires an expensive tier (browser/captcha) instead of auto-escalating. " +
        "Use this to protect against unexpected credit spend on protected pages. " +
        "Returns an error with the required tier instead of automatically upgrading.",
    ),
  force_refresh: z
    .boolean()
    .optional()
    .describe(
      "Bypass the cache and always fetch a fresh copy of the page. " +
        "Use when you need real-time content and a cached result would be stale.",
    ),
  promote_schema_org: z
    .boolean()
    .optional()
    .describe(
      "Use Schema.org JSON-LD/Microdata as the primary structured-data source when present. " +
        "Promotes machine-readable metadata embedded in the page over LLM extraction. " +
        "Most effective on e-commerce, recipe, and news article pages.",
    ),
  cost_controls: costControlsSchema,
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
  embeddings:
    z.union([z.unknown()]).optional().describe("Optional embeddings configuration. When enabled, scraped text content is chunked and embedded using OpenAI models. +$0.001 per page."),
  enable_scroll:
    z.union([z.boolean(), z.unknown()]).optional().describe("Force enable scrolling for lazy-load images. true: Always scroll (captures dynamic images, +5-10s), false: Never scroll (faster, may miss dynamic images), null: Auto (scroll unless social media site)"),
  extraction_template:
    z.union([z.enum(["auto", "product", "article", "job_posting", "faq", "recipe", "event", "ecommerce_homepage", "directory_listing"]), z.unknown()]).optional().describe("Shorthand for extraction_profile. Selects a pre-built schema template by name. Mutually exclusive with extraction_profile."),
  flatten_shadow_dom:
    z.boolean().default(false).describe("Flatten Shadow DOM roots into regular DOM for extraction (free, requires render_js). Web Components with shadow roots become visible in the serialized HTML."),
  generate_pdf:
    z.boolean().default(false).describe("Generate PDF of rendered page (+$0.0004, requires render_js)"),
  headers:
    z.union([z.record(z.unknown()), z.unknown()]).optional().describe("Custom HTTP headers to include in the request to the target URL. Hop-by-hop headers (Connection, Transfer-Encoding, Host, etc.) are not allowed."),
  include_iframes:
    z.boolean().default(false).describe("Inline iframe content into the main document (free, requires render_js). Same-origin iframes are read directly; cross-origin iframes are marked but not fetched."),
  markdown:
    z.boolean().default(false).describe("Extract content as Markdown (free)"),
  ocr:
    z.boolean().default(false).describe("Extract text from images using OCR (+$0.001)"),
  ocr_language:
    z.string().default("eng").describe("See AlterLab API docs for ocr_language."),
  pdf_format:
    z.string().default("markdown").describe("See AlterLab API docs for pdf_format."),
  proxy_integration_id:
    z.union([z.string(), z.unknown()]).optional().describe("Specific proxy integration ID to use (requires use_own_proxy=true)"),
  screenshot:
    z.boolean().default(false).describe("Capture full-page screenshot (+$0.0002, requires render_js)"),
  section_filter:
    z.union([z.unknown()]).optional().describe("Filter options for json_v2 section tree output. Only applies when 'json_v2' is in the formats list. Controls which sections and content blocks are included in the response."),
  session_headers:
    z.union([z.record(z.unknown()), z.unknown()]).optional().describe("Inline auth headers (e.g. Authorization: Bearer). Merged with session headers if session_id is also resolving headers."),
  sticky_session:
    z.union([z.string(), z.unknown()]).optional().describe("Customer-facing sticky-session handle. Two separate /scrape calls that pass the same sticky_session value reuse the cookies captured on the first call (see captured_cookies in the response) for the handle's TTL, and target the SAME exit IP on a best-effort basis. Note the exit IP is only guaranteed to hold for the upstream residential-session window (~10 minutes) — for longer TTLs the shared cookie jar persists but the exit IP may rotate. Enables stateful multi-request flows — e.g. request 1 loads a page, request 2 fetches the captcha/image that appeared using request 1's cookie jar (and, within ~10 min, the same IP). Requires a paid plan (growth tier or above). Alphanumeric, '-' and '_' only, max 128 chars."),
  sticky_session_ttl:
    z.union([z.number(), z.unknown()]).optional().describe("Sticky-session lifetime in seconds (300–7200, default 1800). This governs how long the captured cookie jar bound to sticky_session is retained; after it the handle resolves to a fresh jar. The exit-IP pin is separate and shorter — it holds only for the upstream residential-session window (~10 minutes), so a TTL above that keeps the cookie jar alive while the exit IP may rotate. Ignored unless sticky_session is set."),
  use_own_proxy:
    z.boolean().default(false).describe("Use your own integrated proxy instead of system proxy ($0.0008/request)"),
  use_system_proxy:
    z.boolean().default(false).describe("Override your default proxy integration and use AlterLab's system proxy instead"),
  wait_condition:
    z.string().default("networkidle").describe("Wait condition for JS rendering (domcontentloaded|networkidle|load)"),
  wait_until:
    z.string().default("networkidle").describe("See AlterLab API docs for wait_until."),
});

export const scrapeDescription =
  "Get data from any website, bypass Cloudflare and anti-bot protection, scrape JavaScript-rendered pages, " +
  "or fetch content from dynamic single-page apps. " +
  "Turn any URL into clean, LLM-ready markdown — or get text, HTML, JSON, and structured sections. " +
  "Automatically bypasses anti-bot protection (Cloudflare, Akamai, DataDome, PerimeterX, hCaptcha) " +
  "with intelligent 4-tier escalation — no manual configuration needed. " +
  "Cost-efficient: starts at $0.0001/page for simple sites, auto-escalates only when protection is detected. " +
  "Returns markdown by default — optimized for LLM context. " +
  "Supports GET (default) and POST via the method parameter. " +
  "Use method='POST' with body for GraphQL APIs, REST endpoints, and form submissions. " +
  "Use content_type to set the POST body Content-Type (json, urlencoded, graphql, plain). " +
  "Use render_js=true to scrape dynamic pages, JavaScript-heavy sites (React, Angular, Vue, SPAs). " +
  "Use render_js='auto' for mixed sites to detect JS needs per-page (saves 30-60%). " +
  "Use use_proxy=true for geo-restricted or heavily protected sites. " +
  "Use formats=['json_v2'] for a structured section tree (headings + content blocks). " +
  "Use formats=['rag'] for chunked text optimized for RAG pipelines. " +
  "Use formats=['raw'] for the raw response body without extraction. " +
  "Use formats=['content'] for AI/KB pipelines — returns body_markdown, content_hash, images, links. " +
  "Use extraction_schema to extract structured fields from the page using LLM. " +
  "Use extraction_prompt for natural language extraction instructions. " +
  "Use extraction_profile for pre-built templates (product, article, job_posting, etc.). " +
  "Use evidence=true to include source passages alongside extracted fields. " +
  "Use cache=true and cache_ttl to enable response caching. " +
  "Use cost_controls to cap spending, pin a tier, or set a time budget. " +
  "Supports authenticated scraping via session_id or inline cookies. " +
  "Use scroll_to_load=true for infinite-scroll pages. " +
  "Use location.country to scrape geo-targeted content from any region. " +
  "Use prefer_cost=true to minimize credit spend (starts from cheapest tier). " +
  "Use prefer_speed=true to skip to a fast reliable tier immediately. " +
  "Use fail_fast=true to error instead of auto-escalating to expensive tiers. " +
  "Use force_refresh=true to bypass cache and always fetch live content. " +
  "Use promote_schema_org=true to prefer Schema.org JSON-LD over LLM extraction on structured pages. " +
  "Use estimate_first=true to run a free cost estimate before scraping (prepended to the result).";

export async function handleScrape(
  client: AlterLabClient,
  params: z.infer<typeof scrapeSchema>,
): Promise<CallToolResult> {
  // Optional pre-flight cost estimate — runs before the scrape, no credits charged.
  // On failure, degrade gracefully: prepend a warning and continue with the scrape.
  let estimatePrefix = "";
  if (params.estimate_first) {
    try {
      const estimate = await client.estimate({
        url: params.url,
        mode: params.mode,
        formats: params.formats,
        advanced: {
          render_js: typeof params.render_js === "boolean" ? params.render_js : false,
          use_proxy: params.use_proxy,
        },
      });
      estimatePrefix = formatEstimateInline(estimate) + "\n";
    } catch {
      estimatePrefix =
        "> **Pre-flight estimate**: unavailable (estimate API call failed — proceeding with scrape).\n\n";
    }
  }

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
      extraction_model: params.extraction_model ?? undefined,
      extraction_provider: params.extraction_provider,
      extraction_profile: params.extraction_profile,
      template: params.template,
      evidence: params.evidence,
      filter_content: params.filter_content,
      cache: params.cache,
      cache_ttl: params.cache_ttl,
      prefer_cost: params.prefer_cost,
      prefer_speed: params.prefer_speed,
      fail_fast: params.fail_fast,
      force_refresh: params.force_refresh,
      promote_schema_org: params.promote_schema_org,
      cost_controls: params.cost_controls,
      advanced: {
        render_js: params.render_js,
        use_proxy: params.use_proxy,
        proxy_country: params.proxy_country,
        markdown: params.formats.includes("markdown"),
        scroll_to_load: params.scroll_to_load,
        scroll_count: params.scroll_count,
        remove_cookie_banners: params.remove_cookie_banners,
        block_images: params.block_images,
      },
    });

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