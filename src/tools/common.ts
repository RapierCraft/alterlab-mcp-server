import { z } from "zod";

/**
 * Zod building blocks shared by several tools. Enum values, bounds and field
 * names mirror the AlterLab OpenAPI request schemas; the schema-parity test
 * (test/schema-parity.test.mjs) fails when they drift from spec/request-schemas.json.
 */

export const tierEnum = z.enum(["1", "2", "3", "3.5", "4"]);

export const extractionProfileEnum = z.enum([
  "auto",
  "product",
  "article",
  "job_posting",
  "faq",
  "recipe",
  "event",
  "ecommerce_homepage",
  "directory_listing",
]);

/** Batch-level extraction_profile only accepts the original seven profiles. */
export const batchExtractionProfileEnum = z.enum([
  "auto",
  "product",
  "article",
  "job_posting",
  "faq",
  "recipe",
  "event",
]);

export const extractionProviderEnum = z.enum([
  "openai",
  "anthropic",
  "openrouter",
  "groq",
]);

export const modeEnum = z.enum(["auto", "html", "js", "pdf", "ocr"]);

export const contentTypeEnum = z.enum([
  "application/json",
  "application/x-www-form-urlencoded",
  "text/plain",
  "application/graphql",
]);

/** Output formats accepted by scrape, extract, batch items and estimate. */
export const allFormatEnum = z.enum([
  "text",
  "json",
  "json_v2",
  "html",
  "markdown",
  "rag",
  "content",
  "raw",
]);

/** Output formats accepted by crawl and search (no "raw"). */
export const crawlFormatEnum = z.enum([
  "text",
  "json",
  "json_v2",
  "html",
  "markdown",
  "rag",
  "content",
]);

export const FORMATS_DESCRIPTION =
  "'markdown' is best for LLM consumption. " +
  "'json_v2' returns a structured section tree (headings + content blocks). " +
  "'rag' returns chunked text optimized for retrieval-augmented generation. " +
  "'raw' returns the raw response body without extraction. " +
  "'content' returns body_markdown + content_hash + images + links for AI/KB pipelines.";

export const locationSchema = z
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
  .describe(
    "Geo-targeting parameters for localized content scraping. " +
      "Controls proxy country routing, Accept-Language header, and browser locale.",
  );

export const costControlsSchema = z
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
          "Cannot exceed force_tier when both are set. " +
          "Combining render_js=true with a max_tier below 4 is rejected (render_js forces tier 4).",
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
  .describe(
    "Fine-grained cost and tier controls. Use to cap spending, pin a tier, or trade off cost vs speed.",
  );

const waitAction = z.object({
  type: z.literal("wait"),
  milliseconds: z.number().int().min(100).max(30000).optional(),
  selector: z.string().max(500).optional().describe("CSS selector to wait for visibility"),
});
const waitForAction = z.object({
  type: z.literal("wait_for"),
  selector: z.string().max(500),
  timeout: z.number().int().min(1000).max(30000).optional().describe("Timeout in ms (default 10000)"),
});
const clickAction = z.object({
  type: z.literal("click"),
  selector: z.string().max(500),
});
const fillAction = z.object({
  type: z.literal("fill"),
  selector: z.string().max(500),
  value: z.string().max(5000),
});
const pressAction = z.object({
  type: z.literal("press"),
  key: z.string().max(50).describe("Key to press, e.g. 'Enter', 'Tab', 'Escape'"),
});
const scrollAction = z.object({
  type: z.literal("scroll"),
  direction: z.enum(["down", "up"]).optional(),
  amount: z.number().int().min(1).max(20).optional().describe("Viewport heights to scroll"),
});
const infiniteScrollAction = z.object({
  type: z.literal("infinite_scroll"),
  max_scrolls: z.number().int().min(1).max(50).optional(),
  delay: z.number().int().min(200).max(5000).optional().describe("Delay between scrolls in ms"),
  end_selector: z.string().max(500).optional().describe("Stop scrolling when this selector appears"),
});
const screenshotAction = z.object({
  type: z.literal("screenshot"),
  full_page: z.boolean().optional(),
});
const evaluateAction = z.object({
  type: z.literal("evaluate"),
  script: z
    .string()
    .max(5120)
    .describe(
      "JavaScript to run in the page (max 5120 chars). Network APIs (fetch, XMLHttpRequest, WebSocket) " +
        "and dynamic code execution (eval, Function) are blocked.",
    ),
});

export const actionSchema = z.discriminatedUnion("type", [
  waitAction,
  waitForAction,
  clickAction,
  fillAction,
  pressAction,
  scrollAction,
  infiniteScrollAction,
  screenshotAction,
  evaluateAction,
]);

export const sectionFilterSchema = z.object({
  min_content_blocks: z.number().int().min(0).optional(),
  exclude_content_types: z.array(z.string()).optional(),
  content_only: z.boolean().optional(),
});

/**
 * Fields of the API's `advanced` object for scrape requests. scrape spreads
 * these as flat tool parameters; batch items nest them under `advanced`.
 * `markdown` is intentionally absent: it is derived from `formats`.
 * `screenshot` is the top-level scrape field the API promotes into advanced.
 */
export const advancedShape = {
  render_js: z
    .union([z.boolean(), z.literal("auto")])
    .optional()
    .describe(
      "Render JavaScript using a headless browser (forces Tier 4 minimum, $0.004/req — no separate add-on charge). " +
        "Required for JS-heavy sites. Set to 'auto' for smart detection (probes each page, " +
        "only renders JS-heavy pages with a browser — saves 30-60% on mixed sites).",
    ),
  use_proxy: z
    .boolean()
    .optional()
    .describe(
      "Route through AlterLab's premium proxy (+$0.0002). Helps bypass geo-restrictions and anti-bot",
    ),
  use_own_proxy: z
    .boolean()
    .optional()
    .describe(
      "Use your own proxy integration (bring-your-own-proxy) instead of the system proxy. " +
        "BYOP requests get a 20% discount on the tier price.",
    ),
  use_system_proxy: z
    .boolean()
    .optional()
    .describe(
      "Override your default proxy integration and use AlterLab's system proxy for this request.",
    ),
  proxy_integration_id: z
    .string()
    .optional()
    .describe("Specific proxy integration ID to use (requires use_own_proxy=true)"),
  proxy_country: z
    .string()
    .optional()
    .describe("ISO country code for proxy geo-targeting (e.g., 'US', 'DE'). Requires use_proxy=true"),
  wait_condition: z
    .string()
    .optional()
    .describe("Wait condition for JS rendering: domcontentloaded, networkidle or load"),
  remove_cookie_banners: z
    .boolean()
    .optional()
    .describe(
      "Remove cookie consent banners from HTML before content extraction (free; the API default is true)",
    ),
  include_iframes: z
    .boolean()
    .optional()
    .describe(
      "Inline iframe content into the main document (free, requires render_js). " +
        "Same-origin iframes are read directly; cross-origin iframes are marked but not fetched.",
    ),
  flatten_shadow_dom: z
    .boolean()
    .optional()
    .describe(
      "Flatten Shadow DOM roots into regular DOM for extraction (free, requires render_js).",
    ),
  skip_tls_verification: z
    .boolean()
    .optional()
    .describe(
      "TLS certificate verification for the target. Omit (recommended): certificates are verified, and if " +
        "the site's own certificate is invalid (expired, self-signed, wrong hostname, incomplete chain) " +
        "the page is still fetched without verification. true skips verification from the start. " +
        "false always requires a valid certificate, so sites with an invalid certificate fail.",
    ),
  block_images: z
    .boolean()
    .optional()
    .describe(
      "Block image downloads during browser rendering. " +
        "Reduces proxy bandwidth and speeds up scrapes. Only effective with render_js=true.",
    ),
  scroll_to_load: z
    .boolean()
    .optional()
    .describe(
      "Scroll page to trigger lazy-loaded content (requires render_js). " +
        "Performs explicit viewport-height scrolls to load dynamic content. Adds ~2-3s latency.",
    ),
  scroll_count: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("Number of scroll iterations when scroll_to_load is enabled (1-10, API default 3)"),
  generate_pdf: z
    .boolean()
    .optional()
    .describe("Generate a PDF of the rendered page (+$0.0004, requires render_js)"),
  ocr: z
    .boolean()
    .optional()
    .describe("Extract text from images using OCR (+$0.001)"),
  section_filter: sectionFilterSchema
    .optional()
    .describe(
      "Filter for the json_v2 section tree. Only applies when 'json_v2' is in formats.",
    ),
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
  session_headers: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Inline auth headers sent to the target (e.g. Authorization: Bearer ...). " +
        "Merged with the stored session's headers when session_id is also set.",
    ),
  sticky_session: z
    .string()
    .max(128)
    .optional()
    .describe(
      "Sticky-session handle. Scrapes that pass the same value reuse the cookie jar captured on the first " +
        "call and, best-effort, the same exit IP (~10 min). Alphanumeric, '-' and '_' only. " +
        "Requires a paid plan (growth tier or above).",
    ),
  sticky_session_ttl: z
    .number()
    .int()
    .min(300)
    .max(7200)
    .optional()
    .describe(
      "Sticky-session cookie-jar lifetime in seconds (300-7200, API default 1800). " +
        "Ignored unless sticky_session is set.",
    ),
  actions: z
    .array(actionSchema)
    .max(20)
    .optional()
    .describe(
      "Browser automation actions run in order after page load (max 20, requires render_js=true). " +
        "Failed actions are skipped without aborting the sequence. Results are returned in action_results. " +
        "Each action has a 'type': wait, wait_for, click, fill, press, scroll, infinite_scroll, screenshot, evaluate.",
    ),
};

/** Drop undefined keys so optional tool params are not serialised as null/undefined. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

export function pickAdvanced<T extends Record<string, unknown>>(
  params: T,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (params[k] !== undefined) out[k] = params[k];
  }
  return out;
}

export const ADVANCED_KEYS = Object.keys(advancedShape);
