// ============================================================================
// API Request Types
// ============================================================================

export interface AdvancedOptions {
  render_js?: boolean;
  screenshot?: boolean;
  markdown?: boolean;
  use_proxy?: boolean;
  proxy_country?: string;
  wait_condition?: string;
  remove_cookie_banners?: boolean;
}

export interface UnifiedScrapeRequest {
  url: string;
  mode?: "auto" | "html" | "js" | "pdf" | "ocr";
  sync?: boolean;
  advanced?: AdvancedOptions;
  formats?: ("text" | "json" | "html" | "markdown")[];
  include_raw_html?: boolean;
  timeout?: number;
  extraction_schema?: Record<string, unknown>;
  extraction_prompt?: string;
  extraction_profile?:
    | "auto"
    | "product"
    | "article"
    | "job_posting"
    | "faq"
    | "recipe"
    | "event";
  wait_for?: string;
  screenshot?: boolean;
  wait_until?: string;
  session_id?: string;
  cookies?: Record<string, string>;
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

export interface UnifiedScrapeResponse {
  job_id?: string;
  url: string;
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
