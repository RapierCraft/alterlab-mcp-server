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
    .array(
      z.enum(["text", "json", "json_v2", "html", "markdown", "rag", "content"]),
    )
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
        "Result is returned in content.json (add 'json' to formats) and in the top-level filtered_content field. " +
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

  // ── Auto-generated from OpenAPI spec ──
  actions:
    z.union([z.array(z.unknown()), z.unknown()]).optional().describe("Browser automation actions to execute after page load (max 20). Requires render_js=true. Actions execute sequentially; failed actions are skipped (don't abort the sequence). Results returned in action_results."),
  cache:
    z.boolean().default(false).describe("Enable caching. When True, results may be returned from cache on repeat calls where the full cache key matches: URL, scraping mode, HTTP method, request body, output options (formats, extraction config, render settings, geo-targeting), and user identity — each user's cache is isolated. For GET: standard opt-in caching. For POST: only valid when the endpoint is idempotent (e.g. GraphQL queries, read-only REST POSTs) — caching a mutating POST will cause stale responses to be returned instead of executing the mutation."),
  cache_ttl:
    z.union([z.number(), z.unknown()]).optional().describe("Cache TTL in seconds (60-86400). Defaults to 3600 (60 min) when cache=True."),
  content_type:
    z.union([z.enum(["application/json", "application/x-www-form-urlencoded", "text/plain", "application/graphql"]), z.unknown()]).optional().describe("Content-Type header for the request body. Defaults to 'application/json' when body is provided. Supported values: 'application/json', 'application/x-www-form-urlencoded', 'text/plain', 'application/graphql'. multipart/form-data (file uploads) is not supported. Ignored when body is not set."),
  cost_controls:
    z.union([z.unknown()]).optional().describe("See AlterLab API docs for cost_controls."),
  embeddings:
    z.union([z.unknown()]).optional().describe("Optional embeddings configuration. When enabled, scraped text content is chunked and embedded using OpenAI models. +$0.001 per page."),
  enable_scroll:
    z.union([z.boolean(), z.unknown()]).optional().describe("Force enable scrolling for lazy-load images. true: Always scroll (captures dynamic images, +5-10s), false: Never scroll (faster, may miss dynamic images), null: Auto (scroll unless social media site)"),
  extraction_template:
    z.union([z.enum(["auto", "product", "article", "job_posting", "faq", "recipe", "event", "ecommerce_homepage", "directory_listing"]), z.unknown()]).optional().describe("Shorthand for extraction_profile. Selects a pre-built schema template by name. Mutually exclusive with extraction_profile."),
  filter_content:
    z.boolean().default(false).describe("Apply quality filtering to extracted content. When False (default), returns all parsed content without quality thresholds (lossless mode)."),
  flatten_shadow_dom:
    z.boolean().default(false).describe("Flatten Shadow DOM roots into regular DOM for extraction (free, requires render_js). Web Components with shadow roots become visible in the serialized HTML."),
  force_refresh:
    z.boolean().default(false).describe("Force fresh fetch even if cache=True. Deprecated: prefer cache=False."),
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
  promote_schema_org:
    z.boolean().default(true).describe("Use Schema.org as primary structure when available"),
  proxy_integration_id:
    z.union([z.string(), z.unknown()]).optional().describe("Specific proxy integration ID to use (requires use_own_proxy=true)"),
  screenshot:
    z.boolean().default(false).describe("Capture full-page screenshot (+$0.0002, requires render_js)"),
  section_filter:
    z.union([z.unknown()]).optional().describe("Filter options for json_v2 section tree output. Only applies when 'json_v2' is in the formats list. Controls which sections and content blocks are included in the response."),
  session_headers:
    z.union([z.record(z.unknown()), z.unknown()]).optional().describe("Inline auth headers (e.g. Authorization: Bearer). Merged with session headers if session_id is also resolving headers."),
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
  "Use extraction_schema to extract structured fields from the page using LLM (add formats=['json'] to retrieve result in content.json, also available in filtered_content). " +
  "Use extraction_prompt for natural language extraction instructions (mutually exclusive with extraction_schema). " +
  "Use extraction_profile to select a pre-built extraction template (product, article, job_posting, etc.). " +
  "Use extraction_provider to select a specific BYOK LLM provider (openai, anthropic, openrouter, groq). " +
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
      extraction_prompt: params.extraction_prompt,
      extraction_model: params.extraction_model ?? undefined,
      extraction_provider: params.extraction_provider,
      extraction_profile: params.extraction_profile,
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