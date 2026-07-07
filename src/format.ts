import {
  TIER_NAMES,
  TIER_PRICES,
  type BalanceResponse,
  type BalanceWarning,
  type BetaFeatureListResponse,
  type BetaFeatureMyResponse,
  type BetaFeatureToggleResponse,
  type CostEstimate,
  type SessionCreateResponse,
  type SessionDetailResponse,
  type SessionListResponse,
  type SessionValidateResponse,
  type UnifiedScrapeResponse,
} from "./types.js";

/**
 * Format a scrape response as LLM-optimized markdown.
 * Returns primary content + a compact metadata footer.
 */
export function formatScrapeResponse(response: UnifiedScrapeResponse): string {
  const parts: string[] = [];

  // Title
  if (response.title) {
    parts.push(`# ${response.title}\n`);
  }

  // Schema-extracted data takes priority when extraction_schema was used.
  // When filtered_content is present, content.json contains the same data (API mirrors it
  // there per #19899) — skip the json branch below to avoid double-displaying it.
  const hasFilteredContent = Boolean(response.filtered_content);
  if (hasFilteredContent) {
    parts.push(
      "## Extracted Data\n\n" +
        "```json\n" +
        JSON.stringify(response.filtered_content, null, 2) +
        "\n```",
    );
  }

  // Main content — prefer markdown format from multi-format response
  const content = response.content;
  if (typeof content === "object" && content !== null) {
    const contentMap = content as Record<string, string>;
    if (contentMap.markdown) {
      parts.push(contentMap.markdown);
    } else if (contentMap.text) {
      parts.push(contentMap.text);
    } else if (contentMap.html) {
      parts.push("```html\n" + contentMap.html + "\n```");
    } else if (contentMap.json && !hasFilteredContent) {
      // Skip content.json when filtered_content was already shown above —
      // the API sets content.json = filtered_content when extraction_schema is used.
      parts.push(
        "```json\n" +
          (typeof contentMap.json === "string"
            ? contentMap.json
            : JSON.stringify(contentMap.json, null, 2)) +
          "\n```",
      );
    } else if (
      !contentMap.markdown &&
      !contentMap.text &&
      !contentMap.html &&
      !contentMap.json
    ) {
      // Unknown structure — dump as JSON
      parts.push("```json\n" + JSON.stringify(content, null, 2) + "\n```");
    }
  } else if (typeof content === "string") {
    parts.push(content);
  }

  // Metadata footer
  const tier = response.billing.tier_used;
  const tierName = TIER_NAMES[tier] || tier;
  const tierPrice = TIER_PRICES[tier] || "unknown";
  const cost = response.billing.final_cost_microcents
    ? `$${(response.billing.final_cost_microcents / 1_000_000).toFixed(6)}`
    : `${response.billing.total_credits} credits`;

  const sourceUrl =
    response.redirected && response.final_url
      ? `${response.url} → ${response.final_url}`
      : response.url;

  parts.push(
    "\n---\n" +
      `Source: ${sourceUrl} | ` +
      `Tier: ${tierName} (${tierPrice}/req) | ` +
      `Cost: ${cost} | ` +
      `Time: ${response.response_time_ms}ms` +
      (response.cached ? " | Cached" : "") +
      (response.billing.byop_applied ? " | BYOP" : ""),
  );

  if (response.redirect_chain && response.redirect_chain.length > 0) {
    const chain = response.redirect_chain
      .map((hop) => `${hop.status_code} → ${hop.url}`)
      .join("\n  ");
    parts.push(`Redirect chain:\n  ${chain}`);
  }

  if (
    response.billing.escalations &&
    response.billing.escalations.length > 1
  ) {
    const escalationSummary = response.billing.escalations
      .map((e) => {
        const tierLabel = TIER_NAMES[e.tier] || e.tier;
        const durationLabel = e.duration_ms ? ` (${e.duration_ms}ms)` : "";
        return `${tierLabel}: ${e.result}${durationLabel}`;
      })
      .join(" → ");
    parts.push(`Escalation path: ${escalationSummary}`);
  }

  if (response.billing.optimization_suggestion) {
    parts.push(`Tip: ${response.billing.optimization_suggestion}`);
  }

  if (response.content_truncated) {
    const t = response.content_truncated;
    const truncatedMB = (t.truncated_at_bytes / 1_048_576).toFixed(1);
    const originalMB = (t.original_size_bytes / 1_048_576).toFixed(1);
    const truncationPrefix = `Warning: Content truncated at ${truncatedMB} MB (original: ${originalMB} MB, reason: ${t.truncation_reason}). `;
    if (t.truncation_reason === "response_body_cap") {
      parts.push(
        truncationPrefix +
          `Increase max_response_bytes or use a more targeted selector to capture the full page.`,
      );
    } else {
      // readability_input_cap or readability_output_cap — server-side caps that
      // max_response_bytes cannot affect. Advising users to increase it would be misleading.
      parts.push(
        truncationPrefix +
          `This is a server-side readability cap and cannot be raised via max_response_bytes. ` +
          `Use a more targeted CSS selector to reduce the content region size.`,
      );
    }
  }

  if (response.quality_warning) {
    const qw = response.quality_warning;
    parts.push(
      `Quality warning: ${qw.reason} (code: ${qw.code}, word_count: ${qw.word_count}). ` +
        `Content was delivered but may contain anti-bot artifacts.`,
    );
  }

  return parts.join("\n");
}

/**
 * Format an extraction response — structured JSON as markdown code block.
 */
export function formatExtractResponse(response: UnifiedScrapeResponse): string {
  const parts: string[] = [];

  // Prefer filtered_content (schema-matched), then JSON from content
  let jsonData: unknown = null;

  if (response.filtered_content) {
    jsonData = response.filtered_content;
  } else if (
    typeof response.content === "object" &&
    response.content !== null
  ) {
    const contentMap = response.content as Record<string, unknown>;
    jsonData = contentMap.json || contentMap;
  } else {
    jsonData = response.content;
  }

  if (response.title) {
    parts.push(`# Extracted: ${response.title}\n`);
  }

  parts.push(
    "```json\n" +
      (typeof jsonData === "string"
        ? jsonData
        : JSON.stringify(jsonData, null, 2)) +
      "\n```",
  );

  // Metadata
  const tier = response.billing.tier_used;
  const tierName = TIER_NAMES[tier] || tier;

  parts.push(
    "\n---\n" +
      `Source: ${response.url} | ` +
      `Tier: ${tierName} | ` +
      `Method: ${response.extraction_method || "algorithmic"} | ` +
      `Time: ${response.response_time_ms}ms`,
  );

  return parts.join("\n");
}

/**
 * Format a cost estimate as a compact inline header (one line).
 * Used by estimate_first in alterlab_scrape to prepend before scrape results.
 */
export function formatEstimateInline(estimate: CostEstimate): string {
  const tierName =
    TIER_NAMES[estimate.estimated_tier] || estimate.estimated_tier;
  const tierPrice = TIER_PRICES[estimate.estimated_tier] || "unknown";
  return (
    `> **Pre-flight estimate**: ${tierPrice}/req (${tierName}, tier ${estimate.estimated_tier}) — ` +
    `confidence: ${estimate.confidence}. ${estimate.reasoning}\n`
  );
}

/**
 * Format a cost estimate as readable text.
 */
export function formatEstimateResponse(estimate: CostEstimate): string {
  const tierName =
    TIER_NAMES[estimate.estimated_tier] || estimate.estimated_tier;
  const tierPrice = TIER_PRICES[estimate.estimated_tier] || "unknown";

  return (
    `**Cost Estimate for ${estimate.url}**\n\n` +
    `- Estimated tier: **${tierName}** (tier ${estimate.estimated_tier})\n` +
    `- Estimated cost: **${tierPrice}** per request\n` +
    `- Confidence: ${estimate.confidence}\n` +
    `- Max possible cost: tier 4 (browser) = $0.004/req\n\n` +
    `${estimate.reasoning}`
  );
}

/**
 * Format a balance response as readable text, including balance status and
 * estimated runway (days at current spending rate).
 */
export function formatBalanceResponse(balance: BalanceResponse): string {
  const deposited = (balance.total_deposited_cents / 100).toFixed(2);
  const spent = (balance.total_spent_cents / 100).toFixed(2);
  const balanceUsd = balance.balance_microcents / 1_000_000;

  // Balance status classification
  let status: string;
  if (balanceUsd <= 0) {
    status = "Exhausted — top up to continue scraping";
  } else if (balanceUsd < 0.10) {
    status = "Critical (< $0.10)";
  } else if (balanceUsd < 0.50) {
    status = "Low (< $0.50)";
  } else {
    status = "Healthy";
  }

  // Estimated runway: days at current average daily spend rate.
  // Uses total_spent_cents as a proxy for lifetime spend, but since we don't
  // know the account age, we can only compute runway if daily spend is
  // non-zero. The balance endpoint doesn't expose daily spend directly, so
  // we skip runway here and recommend alterlab_get_usage for that detail.
  const lines: string[] = [
    `**Account Balance**\n`,
    `- Balance: **${balance.balance_display}**`,
    `- Status: ${status}`,
    `- Total deposited: $${deposited}`,
    `- Total spent: $${spent}`,
    `\nFor spending breakdown and estimated runway: use \`alterlab_get_usage\``,
    `Add funds: https://alterlab.io/dashboard/billing`,
  ];

  return lines.join("\n");
}

/**
 * Format a balance warning from response headers into a human-readable suffix.
 *
 * Returns a non-empty string (starting with a newline) when the balance is
 * low, critical, or exhausted. Returns an empty string when warning is null
 * (healthy balance — no suffix appended).
 */
export function formatBalanceWarning(warning: BalanceWarning | null): string {
  if (!warning) return "";

  const fundUrl = "https://alterlab.io/dashboard/billing";
  switch (warning.level) {
    case "exhausted":
      return (
        `\n\n> **Balance exhausted**: ${warning.balance} remaining. ` +
        `Add funds to continue scraping: ${fundUrl}`
      );
    case "critical":
      return (
        `\n\n> **Critical balance**: ${warning.balance} remaining. ` +
        `Top up soon to avoid interruptions: ${fundUrl}`
      );
    case "low":
      return (
        `\n\n> **Low balance**: ${warning.balance} remaining. ` +
        `Add funds: ${fundUrl}`
      );
    default:
      return "";
  }
}

/**
 * Format a session list response as readable text.
 */
export function formatSessionListResponse(
  response: SessionListResponse,
): string {
  if (response.sessions.length === 0) {
    return (
      "**No sessions found.**\n\n" +
      "Create a session with `alterlab_create_session` to enable authenticated scraping.\n" +
      "You'll need cookies from a logged-in browser session for the target domain."
    );
  }

  const parts: string[] = [`**Stored Sessions** (${response.total} total)\n`];

  for (const session of response.sessions) {
    const status =
      session.status === "active"
        ? "Active"
        : session.status === "expired"
          ? "Expired"
          : "Invalid";
    const lastUsed = session.last_used_at
      ? `Last used: ${session.last_used_at}`
      : "Never used";

    parts.push(
      `- **${session.name}** (\`${session.id}\`)\n` +
        `  Domain: ${session.domain} | Status: ${status} | ` +
        `Cookies: ${session.cookie_count} | ${lastUsed}`,
    );
  }

  parts.push(
    "\nUse a session_id with `alterlab_scrape` to scrape authenticated pages.",
  );

  return parts.join("\n");
}

/**
 * Format a session create response.
 */
export function formatSessionCreateResponse(
  response: SessionCreateResponse,
): string {
  return (
    `**Session Created**\n\n` +
    `- Name: **${response.name}**\n` +
    `- ID: \`${response.id}\`\n` +
    `- Domain: ${response.domain}\n` +
    `- Status: ${response.status}\n\n` +
    `Use this session_id with \`alterlab_scrape\` to scrape authenticated pages on ${response.domain}.`
  );
}

/**
 * Format a session validation response.
 */
export function formatSessionValidateResponse(
  response: SessionValidateResponse,
): string {
  const statusIcon = response.valid ? "Valid" : "Invalid";
  const parts = [
    `**Session Validation: ${statusIcon}**\n`,
    `- Name: **${response.name}**`,
    `- ID: \`${response.id}\``,
    `- Domain: ${response.domain}`,
    `- Status: ${response.status}`,
  ];

  if (response.reason) {
    parts.push(`- Reason: ${response.reason}`);
  }

  if (!response.valid) {
    parts.push(
      "\nThis session can no longer be used for authenticated scraping. " +
        "Create a new session with fresh cookies using `alterlab_create_session`.",
    );
  }

  return parts.join("\n");
}

/**
 * Format a session detail response (get session).
 */
export function formatSessionDetailResponse(
  response: SessionDetailResponse,
): string {
  const parts = [
    `**Session: ${response.name}**\n`,
    `- ID: \`${response.id}\``,
    `- Domain: ${response.domain}`,
    `- Status: ${response.status}`,
    `- Cookies: ${response.cookie_names.length} (${response.cookie_names.join(", ")})`,
  ];

  if (response.header_names && response.header_names.length > 0) {
    parts.push(
      `- Custom headers: ${response.header_names.length} (${response.header_names.join(", ")})`,
    );
  }

  if (response.expires_at) {
    const expiryLabel = response.expiry_status
      ? ` (${response.expiry_status})`
      : "";
    parts.push(`- Expires: ${response.expires_at}${expiryLabel}`);
  }

  parts.push(
    `\n**Usage Stats**`,
    `- Total requests: ${response.total_requests}`,
    `- Successful: ${response.successful_requests}`,
    `- Success rate: ${(response.success_rate * 100).toFixed(1)}%`,
    `- Consecutive failures: ${response.consecutive_failures}`,
  );

  if (response.last_used_at) {
    parts.push(`- Last used: ${response.last_used_at}`);
  }
  if (response.last_validated_at) {
    parts.push(`- Last validated: ${response.last_validated_at}`);
  }
  if (response.notes) {
    parts.push(`\n**Notes**: ${response.notes}`);
  }

  parts.push(`\n- Created: ${response.created_at}`);
  parts.push(`- Updated: ${response.updated_at}`);

  return parts.join("\n");
}

/**
 * Format a session update response.
 */
export function formatSessionUpdateResponse(
  response: SessionDetailResponse,
): string {
  return (
    `**Session Updated**\n\n` +
    `- Name: **${response.name}**\n` +
    `- ID: \`${response.id}\`\n` +
    `- Domain: ${response.domain}\n` +
    `- Status: ${response.status}\n` +
    `- Cookies: ${response.cookie_names.length}\n\n` +
    `Session has been updated successfully.`
  );
}

/**
 * Format a session refresh response.
 */
export function formatSessionRefreshResponse(
  response: SessionDetailResponse,
): string {
  return (
    `**Session Cookies Refreshed**\n\n` +
    `- Name: **${response.name}**\n` +
    `- ID: \`${response.id}\`\n` +
    `- Domain: ${response.domain}\n` +
    `- Status: ${response.status}\n` +
    `- Cookies: ${response.cookie_names.length}\n\n` +
    `Cookies have been rotated and failure counters reset. ` +
    `The session is ready for authenticated scraping.`
  );
}

/**
 * Format a beta features list response (all public features with opt-in state).
 */
export function formatBetaFeaturesListResponse(
  response: BetaFeatureListResponse,
): string {
  if (response.features.length === 0) {
    return (
      "**No beta features available.**\n\n" +
      "AlterLab has no public beta features at this time. " +
      "Check back later for new capabilities in early access."
    );
  }

  const parts: string[] = [`**Beta Features** (${response.total} total)\n`];

  for (const feature of response.features) {
    const statusLabel =
      feature.status === "ga"
        ? "GA"
        : feature.status === "beta"
          ? "Beta"
          : "Hidden";
    const optInLabel = feature.enabled ? "Opted in" : "Not opted in";

    parts.push(
      `- **${feature.name}** (\`${feature.slug}\`) [${statusLabel}]\n` +
        `  ${feature.description}\n` +
        `  Status: ${optInLabel}`,
    );
  }

  parts.push(
    "\nUse `alterlab_enable_beta_feature` or `alterlab_disable_beta_feature` to manage your opt-ins.",
  );

  return parts.join("\n");
}

/**
 * Format a compact beta features list for the authenticated user (slugs only).
 */
export function formatBetaFeaturesMyResponse(
  response: BetaFeatureMyResponse,
): string {
  if (response.features.length === 0) {
    return (
      "**Your Active Beta Features**: none\n\n" +
      "You have no beta features enabled. " +
      "Use `alterlab_list_beta_features` to see available features."
    );
  }

  const slugList = response.features.map((slug) => `- \`${slug}\``).join("\n");

  return (
    `**Your Active Beta Features** (${response.features.length})\n\n` +
    `${slugList}\n\n` +
    `These features are active on your account (GA features + opted-in beta features).`
  );
}

/**
 * Format a beta feature enable/disable toggle response.
 */
export function formatBetaFeatureToggleResponse(
  response: BetaFeatureToggleResponse,
): string {
  const action = response.enabled ? "Enabled" : "Disabled";
  return (
    `**Beta Feature ${action}**\n\n` +
    `- Feature: \`${response.feature_slug}\`\n` +
    `- Status: ${response.enabled ? "Active" : "Inactive"}\n\n` +
    `${response.message}`
  );
}
