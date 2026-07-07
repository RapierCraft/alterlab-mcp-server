import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";
import type { UsageResponse } from "../types.js";

export const usageSchema = z.object({});

export const usageDescription =
  "Get a detailed spending breakdown for your AlterLab account — credits consumed today, this week, and this month, " +
  "plus the top domains by credit consumption. " +
  "Use this to audit costs, identify expensive domains, and track usage trends. " +
  "No parameters required — uses your API key for identification.";

export async function handleUsage(
  client: AlterLabClient,
): Promise<CallToolResult> {
  try {
    const usage = await client.getUsage();
    return {
      content: [{ type: "text", text: formatUsageResponse(usage) }],
    };
  } catch (error) {
    if (isApiError(error)) {
      return formatErrorResult(error);
    }
    return formatErrorResult(error as Error);
  }
}

function formatUsageResponse(usage: UsageResponse): string {
  const parts: string[] = ["**Usage & Spending Breakdown**\n"];

  parts.push("**Time Windows**");
  parts.push(`- Today:      ${usage.today_credits} credits (${usage.today_requests ?? "—"} requests)`);
  parts.push(`- This week:  ${usage.this_week_credits} credits (${usage.this_week_requests ?? "—"} requests)`);
  parts.push(`- This month: ${usage.this_month_credits} credits`);
  parts.push(`- All time:   ${usage.total_credits} credits`);

  if (usage.top_domains && usage.top_domains.length > 0) {
    parts.push("\n**Top Domains by Credit Consumption**");
    for (const entry of usage.top_domains) {
      parts.push(
        `- ${entry.domain}: ${entry.credits_used} credits (${entry.requests} requests)`,
      );
    }
  }

  if (usage.usage_since) {
    parts.push(`\n_Usage tracked since: ${usage.usage_since}_`);
  }

  parts.push("\nAdd funds: https://alterlab.io/dashboard/billing");

  return parts.join("\n");
}

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as ApiError).status === "number"
  );
}
