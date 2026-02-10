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
  "3": "$0.0005",
  "3.5": "$0.0007",
  "4": "$0.001",
  "5": "$0.02",
};
