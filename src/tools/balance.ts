import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";
import { formatBalanceResponse } from "../format.js";

export const balanceSchema = z.object({});

export const balanceDescription =
  "Check your AlterLab account balance and credit usage. " +
  "Returns current balance, total deposited, and total spent. " +
  "No parameters required — uses your API key for identification.";

export async function handleBalance(
  client: AlterLabClient
): Promise<CallToolResult> {
  try {
    const balance = await client.getBalance();
    return {
      content: [{ type: "text", text: formatBalanceResponse(balance) }],
    };
  } catch (error) {
    if (isApiError(error)) {
      return formatErrorResult(error);
    }
    return formatErrorResult(error as Error);
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
