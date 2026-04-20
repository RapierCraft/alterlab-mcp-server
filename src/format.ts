import {
  TIER_NAMES,
  TIER_PRICES,
  type BalanceResponse,
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
    } else if (contentMap.json) {
      parts.push(
        "```json\n" +
          (typeof contentMap.json === "string"
            ? contentMap.json
            : JSON.stringify(contentMap.json, null, 2)) +
          "\n```",
      );
    } else {
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

  parts.push(
    "\n---\n" +
      `Source: ${response.url} | ` +
      `Tier: ${tierName} (${tierPrice}/req) | ` +
      `Cost: ${cost} | ` +
      `Time: ${response.response_time_ms}ms` +
      (response.cached ? " | Cached" : ""),
  );

  if (response.billing.optimization_suggestion) {
    parts.push(`Tip: ${response.billing.optimization_suggestion}`);
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
 * Format a balance response as readable text.
 */
export function formatBalanceResponse(balance: BalanceResponse): string {
  const deposited = (balance.total_deposited_cents / 100).toFixed(2);
  const spent = (balance.total_spent_cents / 100).toFixed(2);

  return (
    `**Account Balance**\n\n` +
    `- Balance: **${balance.balance_display}**\n` +
    `- Total deposited: $${deposited}\n` +
    `- Total spent: $${spent}\n\n` +
    `Add funds: https://alterlab.io/dashboard/billing`
  );
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
