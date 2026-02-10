import {
  TIER_NAMES,
  TIER_PRICES,
  type BalanceResponse,
  type CostEstimate,
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
          "\n```"
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
      (response.cached ? " | Cached" : "")
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
  } else if (typeof response.content === "object" && response.content !== null) {
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
      (typeof jsonData === "string" ? jsonData : JSON.stringify(jsonData, null, 2)) +
      "\n```"
  );

  // Metadata
  const tier = response.billing.tier_used;
  const tierName = TIER_NAMES[tier] || tier;

  parts.push(
    "\n---\n" +
      `Source: ${response.url} | ` +
      `Tier: ${tierName} | ` +
      `Method: ${response.extraction_method || "algorithmic"} | ` +
      `Time: ${response.response_time_ms}ms`
  );

  return parts.join("\n");
}

/**
 * Format a cost estimate as readable text.
 */
export function formatEstimateResponse(estimate: CostEstimate): string {
  const tierName = TIER_NAMES[estimate.estimated_tier] || estimate.estimated_tier;
  const tierPrice = TIER_PRICES[estimate.estimated_tier] || "unknown";

  return (
    `**Cost Estimate for ${estimate.url}**\n\n` +
    `- Estimated tier: **${tierName}** (tier ${estimate.estimated_tier})\n` +
    `- Estimated cost: **${tierPrice}** per request\n` +
    `- Confidence: ${estimate.confidence}\n` +
    `- Max possible cost: tier 4 (browser) = $0.001/req\n\n` +
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
