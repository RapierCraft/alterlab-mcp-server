import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";
import type { UsageResponse } from "../types.js";

export const usageSchema = z.object({});

export const usageDescription =
  "Get account usage for the current billing period — balance, credits consumed this period, " +
  "account tier and entitlement source. " +
  "Use this to track spend against your plan; use alterlab_check_balance for deposit and spend totals. " +
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
  const parts: string[] = ["**Usage**\n"];

  parts.push(`- Balance: $${(usage.balance_microcents / 1_000_000).toFixed(4)}`);
  parts.push(`- Credits used this period: ${usage.credits_used_month}`);
  parts.push(`- Account tier: ${usage.account_tier}`);
  parts.push(`- Entitlement source: ${usage.entitlement_source}`);
  parts.push(`- Period: ${usage.period_start} to ${usage.period_end}`);

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
