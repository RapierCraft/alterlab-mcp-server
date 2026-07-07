// ============================================================================
// API Request Types
// ============================================================================

export interface AdvancedOptions {
  render_js?: boolean | "auto";
  screenshot?: boolean;
  markdown?: boolean;
  use_proxy?: boolean;
  proxy_country?: string;
  wait_condition?: string;
  remove_cookie_banners?: boolean;
  scroll_to_load?: boolean;
  scroll_count?: number;
  block_images?: boolean;
}

export interface LocationOptions {
  country?: string;
  language?: string;
}

export interface UnifiedScrapeRequest {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  body?: string;
  mode?: "auto" | "html" | "js" | "pdf" | "ocr";
  sync?: boolean;
  advanced?: AdvancedOptions;
  formats?: (
    | "text"
    | "json"
    | "json_v2"
    | "html"
    | "markdown"
    | "rag"
    | "content"
    | "raw"
  )[];
  include_raw_html?: boolean;
  timeout?: number;
  max_response_bytes?: number;
  extraction_schema?: Record<string, unknown>;
  extraction_prompt?: string;
  extraction_model?: string;
  extraction_provider?: "openai" | "anthropic" | "openrouter" | "groq";
  extraction_profile?:
    | "auto"
    | "product"
    | "article"
    | "job_posting"
    | "faq"
    | "recipe"
    | "event"
    | "ecommerce_homepage"
    | "directory_listing";
  template?: string;
  wait_for?: string;
  screenshot?: boolean;
  wait_until?: string;
  session_id?: string;
  cookies?: Record<string, string>;
  location?: LocationOptions;
  // Cost-control hints — influence tier selection without changing scrape mode
  prefer_cost?: boolean;
  prefer_speed?: boolean;
  fail_fast?: boolean;
  force_refresh?: boolean;
  promote_schema_org?: boolean;
}

// ============================================================================
// Crawl Types
// ============================================================================

export interface CrawlAdvancedOptions {
  render_js?: boolean | "auto";
  use_proxy?: boolean;
  wait_for?: string;
  timeout?: number;
  block_images?: boolean;
}

export interface CrawlRequest {
  url: string;
  max_pages?: number;
  max_depth?: number;
  include_patterns?: string[];
  exclude_patterns?: string[];
  sitemap?: "include" | "skip" | "only";
  sitemap_path?: string;
  formats?: ("text" | "json" | "json_v2" | "html" | "markdown" | "content")[];
  extraction_schema?: Record<string, unknown>;
  extraction_model?: string;
  max_concurrency?: number;
  respect_robots?: boolean;
  include_subdomains?: boolean;
  webhook_url?: string;
  advanced?: CrawlAdvancedOptions;
}

export interface CrawlResponse {
  crawl_id: string;
  status: string;
  url: string;
  created_at?: string;
}

export interface CrawlStatusResponse {
  crawl_id: string;
  status: string;
  url: string;
  pages_scraped?: number;
  pages_total?: number;
  credits_used?: number;
  results?: Record<string, unknown>[];
  error?: string;
}

export interface CrawlCancelResponse {
  crawl_id: string;
  status: string;
  pages_scraped?: number;
  credits_refunded?: number;
}

// ============================================================================
// Search Types
// ============================================================================

export interface SearchRequest {
  query: string;
  num_results?: number;
  page?: number;
  domain?: string;
  country?: string;
  language?: string;
  time_range?: "hour" | "day" | "week" | "month" | "year";
  scrape_results?: boolean;
  formats?: ("text" | "json" | "json_v2" | "html" | "markdown" | "content")[];
  extraction_schema?: Record<string, unknown>;
}

export interface SearchResponse {
  search_id: string;
  query: string;
  results_requested: number;
  results_count: number;
  credits_used: number;
  results: Record<string, unknown>[];
  cost_breakdown?: Record<string, unknown>;
  featured_snippet?: Record<string, unknown>;
  knowledge_panel?: Record<string, unknown>;
  people_also_ask?: Record<string, unknown>[];
}

// ============================================================================
// Map Types
// ============================================================================

export interface MapRequest {
  url: string;
  max_pages?: number;
  max_depth?: number;
  include_patterns?: string[];
  exclude_patterns?: string[];
  search?: string;
  sitemap?: "skip" | "include" | "only";
  sitemap_path?: string;
  include_metadata?: boolean;
  include_subdomains?: boolean;
  respect_robots?: boolean;
}

export interface MapResponse {
  map_id: string;
  total_urls: number;
  urls: Record<string, unknown>[];
  sitemap_found: boolean;
  robots_txt?: Record<string, unknown>;
  credits_used: number;
}

// ============================================================================
// Extract Types
// ============================================================================

export interface ExtractRequest {
  content: string;
  content_type?: "html" | "text" | "markdown";
  extraction_schema?: Record<string, unknown>;
  extraction_profile?:
    | "auto"
    | "product"
    | "article"
    | "job_posting"
    | "faq"
    | "recipe"
    | "event"
    | "ecommerce_homepage"
    | "directory_listing";
  extraction_template?:
    | "auto"
    | "product"
    | "article"
    | "job_posting"
    | "faq"
    | "recipe"
    | "event"
    | "ecommerce_homepage"
    | "directory_listing";
  extraction_prompt?: string;
  extraction_model?: string;
  extraction_provider?: "openai" | "anthropic" | "openrouter" | "groq";
  formats?: (
    | "text"
    | "json"
    | "json_v2"
    | "html"
    | "markdown"
    | "rag"
    | "content"
    | "raw"
  )[];
  source_url?: string;
  evidence?: boolean;
  cache?: "auto" | "skip" | "only";
  cache_ttl?: number;
}

/**
 * Per-call extraction transparency metadata returned in POST /v1/extract responses.
 *
 * Provides full context about how the extraction was performed: which LLM provider
 * and model were used, token counts, AlterLab's invocation fee, latency, and whether
 * a cached result was served. Token counts are null when no LLM was invoked.
 */
export interface ExtractionMetadata {
  /** Extraction mode: 'byok' when BYOK key was used, 'algorithmic' otherwise. */
  mode: string;
  /** LLM provider used (openai, anthropic, openrouter, groq), or null if no LLM ran. */
  provider?: string | null;
  /** LLM model ID used for extraction, or null if no LLM ran. */
  model?: string | null;
  /** Prompt token count reported by the provider, or null if unavailable. */
  input_tokens?: number | null;
  /** Completion token count reported by the provider, or null if unavailable. */
  output_tokens?: number | null;
  /** AlterLab invocation fee charged in microcents (net of any refunds). */
  cost_microcents: number;
  /** Whether a cached extraction result was served. */
  cached: boolean;
  /** End-to-end extraction latency in milliseconds. */
  latency_ms: number;
}

export interface ExtractResponse {
  extract_id: string;
  formats: Record<string, unknown>;
  credits_used: number;
  model_used?: string;
  extraction_method: string;
  /** Extraction profile applied (if any). */
  extraction_profile?: string;
  content_size_chars: number;
  /**
   * Full extraction context including provider, model, token usage,
   * invocation cost, latency, and cache status. Populated on every call.
   */
  extraction_metadata?: ExtractionMetadata;
  /**
   * True when the LLM extraction result was served from Redis cache.
   * When true, no LLM call was made and the BYOK invocation fee was not charged.
   */
  cache_hit?: boolean;
}

// ============================================================================
// Batch Types
// ============================================================================

export interface BatchItemRequest {
  url: string;
  mode?: "auto" | "html" | "js" | "pdf" | "ocr";
  formats?: (
    | "text"
    | "json"
    | "json_v2"
    | "html"
    | "markdown"
    | "rag"
    | "content"
  )[];
  extraction_schema?: Record<string, unknown>;
  timeout?: number;
  wait_for?: string;
  cache?: boolean;
  advanced?: AdvancedOptions;
}

export interface BatchRequest {
  urls: BatchItemRequest[];
  webhook_url?: string;
}

export interface BatchResponse {
  batch_id: string;
  status: string;
  total_urls: number;
  estimated_credits: number;
  job_ids?: string[];
}

export interface BatchStatusResponse {
  batch_id: string;
  status: string;
  total_urls: number;
  completed?: number;
  failed?: number;
  credits_used?: number;
  items?: Record<string, unknown>[];
}

// ============================================================================
// Session Types
// ============================================================================

export interface Session {
  id: string;
  name: string;
  domain: string;
  status: "active" | "expired" | "invalid";
  created_at: string;
  updated_at: string;
  last_used_at?: string;
  expires_at?: string;
  cookie_count: number;
}

export interface SessionListResponse {
  sessions: Session[];
  total: number;
}

export interface SessionCreateRequest {
  name: string;
  domain: string;
  cookies: Record<string, string>;
  user_agent?: string;
}

export interface SessionCreateResponse {
  id: string;
  name: string;
  domain: string;
  status: "active";
  created_at: string;
}

export interface SessionValidateResponse {
  id: string;
  name: string;
  domain: string;
  status: "active" | "expired" | "invalid";
  valid: boolean;
  reason?: string;
}

export interface SessionDetailResponse {
  id: string;
  name: string;
  domain: string;
  cookie_names: string[];
  header_names?: string[];
  status: string;
  expires_at?: string;
  last_validated_at?: string;
  consecutive_failures: number;
  last_used_at?: string;
  total_requests: number;
  successful_requests: number;
  success_rate: number;
  notes?: string;
  expiry_status?: string;
  created_at: string;
  updated_at: string;
}

export interface SessionUpdateRequest {
  name?: string;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  expires_at?: string;
  notes?: string;
}

export interface SessionRefreshRequest {
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ContentTruncationInfo {
  /** Always true when this object is present. */
  truncated: boolean;
  /** Number of bytes at which the content was cut before processing. */
  truncated_at_bytes: number;
  /** Original content size in bytes before truncation. */
  original_size_bytes: number;
  /**
   * Why truncation occurred:
   * - 'readability_input_cap': HTML exceeded 2 MB before Readability processing
   * - 'readability_output_cap': extracted text exceeded the output size cap
   * - 'response_body_cap': raw response body exceeded max_response_bytes limit
   */
  truncation_reason:
    | "readability_input_cap"
    | "readability_output_cap"
    | "response_body_cap";
}

export interface TierEscalationDetail {
  tier: string;
  result: "success" | "failed" | "skipped";
  credits: number;
  duration_ms?: number;
  error?: string;
}

export interface BillingDetails {
  total_credits: number;
  tier_used: string;
  escalations: TierEscalationDetail[];
  savings: number;
  optimization_suggestion?: string;
  byop_applied?: boolean;
  final_cost_microcents?: number;
}

export interface QualityWarning {
  code: string;
  reason: string;
  word_count: number;
  content_size_bytes: number;
}

export interface RedirectHop {
  url: string;
  status_code: number;
}

export interface UnifiedScrapeResponse {
  job_id?: string;
  url: string;
  final_url?: string;
  redirected?: boolean;
  redirect_chain?: RedirectHop[];
  status_code: number;
  content: string | Record<string, unknown>;
  title?: string;
  published_at?: string;
  author?: string;
  metadata?: Record<string, unknown>;
  headers: Record<string, string>;
  cached: boolean;
  response_time_ms: number;
  size_bytes: number;
  structured_content?: Record<string, unknown>[];
  raw_html?: string;
  screenshot_url?: string;
  pdf_url?: string;
  filtered_content?: Record<string, unknown>;
  content_truncated?: ContentTruncationInfo;
  quality_warning?: QualityWarning;
  billing: BillingDetails;
  extraction_method?: string;
  version?: string;
}

export interface CostEstimate {
  url: string;
  estimated_tier: string;
  estimated_credits: number;
  confidence: "low" | "medium" | "high";
  max_possible_credits: number;
  reasoning: string;
}

export interface BalanceResponse {
  balance_microcents: number;
  balance_display: string;
  total_deposited_cents: number;
  total_spent_cents: number;
}

/**
 * Balance warning data parsed from X-AlterLab-Balance and
 * X-AlterLab-Balance-Warning response headers.
 *
 * The backend sends these headers on every API response so the client can
 * surface proactive warnings to the user without requiring a dedicated
 * balance check call.
 */
export interface BalanceWarning {
  /** Balance level as reported by the header: 'low', 'critical', or 'exhausted'. */
  level: "low" | "critical" | "exhausted";
  /** Human-readable balance amount from X-AlterLab-Balance (e.g. '$0.42'). */
  balance: string;
  /** Raw balance in dollars parsed from the header, or null if unparseable. */
  balance_usd: number | null;
}

// ============================================================================
// Beta Features Types
// ============================================================================

export type BetaFeatureStatus = "hidden" | "beta" | "ga";

export interface BetaFeatureListItem {
  slug: string;
  name: string;
  description: string;
  status: BetaFeatureStatus;
  created_at: string;
  /** True if the current user has opted in to this feature. */
  enabled: boolean;
}

export interface BetaFeatureListResponse {
  features: BetaFeatureListItem[];
  total: number;
}

export interface BetaFeatureMyResponse {
  /** Sorted list of feature slugs accessible to the requesting user (GA + opted-in beta). */
  features: string[];
}

export interface BetaFeatureToggleResponse {
  feature_slug: string;
  enabled: boolean;
  message: string;
}

// ============================================================================
// Tier Info
// ============================================================================

export const TIER_NAMES: Record<string, string> = {
  "1": "curl",
  "2": "http",
  "3": "stealth",
  "3.5": "lightjs",
  "4": "browser",
  "5": "captcha",
};

export const TIER_PRICES: Record<string, string> = {
  "1": "$0.0002",
  "2": "$0.0003",
  "3": "$0.002",
  "3.5": "$0.0025",
  "4": "$0.004",
  "5": "$0.02",
};

// ============================================================================
// Auth / User Types
// ============================================================================

/**
 * Structured rate-limit tier information derived from an account's balance.
 * Matches the TierInfo Pydantic model in services/api/app/schemas/auth.py.
 * Returned as part of UserResponse to give API consumers a single place
 * to read their current rate-limit tier without a separate usage call.
 */
export interface TierInfo {
  /** Human-readable tier name, e.g. 'Free', 'Basic', 'Growth'. */
  name: string;
  /** Machine-readable tier identifier, e.g. 'free', 'basic', 'growth'. */
  slug: string;
  /** Maximum API requests per minute allowed at this tier. */
  requests_per_minute: number;
  /** Maximum number of concurrent scrape requests allowed at this tier. */
  concurrent_requests: number;
  /** Minimum account balance (USD) required to qualify for this tier. */
  min_balance_usd: number;
  /** Upper balance threshold (USD) for this tier. null means no upper limit. */
  max_balance_usd: number | null;
  /** Slug of the next higher tier, or null if already at the top tier. */
  next_tier_slug: string | null;
  /** Balance (USD) needed to reach the next tier, or null if at top tier. */
  next_tier_threshold_usd: number | null;
}

/**
 * Current authenticated user with balance-based tier info.
 * Matches the UserResponse Pydantic model in services/api/app/schemas/auth.py.
 * Returned by GET /api/v1/auth/me.
 */
export interface UserResponse {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  created_at: string;
  subscription_tier: string;
  credits_remaining: number;
  credits_total: number;
  welcome_shown: boolean;
  reduced_bonus: boolean;
  /** Structured rate-limit tier details for the current balance level. */
  tier_info?: TierInfo | null;
}

// ============================================================================
// Usage / Spending Types
// ============================================================================

export interface UsageDomainEntry {
  domain: string;
  credits_used: number;
  requests: number;
}

/**
 * Detailed usage breakdown returned by GET /api/v1/billing/usage.
 * Provides spending summaries for different time windows and the top domains
 * consuming the most credits.
 */
export interface UsageResponse {
  /** Credits consumed today (UTC day). */
  today_credits: number;
  /** Credits consumed in the current calendar week (Mon–Sun UTC). */
  this_week_credits: number;
  /** Credits consumed in the current calendar month. */
  this_month_credits: number;
  /** Total lifetime credits consumed across all time. */
  total_credits: number;
  /** Number of API requests made today. */
  today_requests: number;
  /** Number of API requests made this week. */
  this_week_requests: number;
  /** Top domains by credit consumption (up to 10 entries). */
  top_domains: UsageDomainEntry[];
  /** Timestamp of the oldest usage record included in totals. */
  usage_since?: string;
}
