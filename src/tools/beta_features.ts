import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";
import {
  formatBetaFeaturesListResponse,
  formatBetaFeaturesMyResponse,
  formatBetaFeatureToggleResponse,
} from "../format.js";

// ============================================================================
// List Beta Features
// ============================================================================

export const listBetaFeaturesSchema = z.object({});

export const listBetaFeaturesDescription =
  "List all public beta and GA features available on AlterLab, with your " +
  "current opt-in state for each. Beta features require opting in; GA features " +
  "are available to all users. Use alterlab_enable_beta_feature to opt in to " +
  "any beta feature that interests you.";

export async function handleListBetaFeatures(
  client: AlterLabClient,
): Promise<CallToolResult> {
  try {
    const response = await client.listBetaFeatures();
    return {
      content: [
        { type: "text", text: formatBetaFeaturesListResponse(response) },
      ],
    };
  } catch (error) {
    if (isApiError(error)) {
      return formatErrorResult(error);
    }
    return formatErrorResult(error as Error);
  }
}

// ============================================================================
// List My Beta Features
// ============================================================================

export const listMyBetaFeaturesSchema = z.object({});

export const listMyBetaFeaturesDescription =
  "List all beta and GA features currently active on your account — a compact " +
  "slug list for quick checks. Includes all GA features plus any beta features " +
  "you have opted in to. Use this to verify which features are available before " +
  "making API calls that require them.";

export async function handleListMyBetaFeatures(
  client: AlterLabClient,
): Promise<CallToolResult> {
  try {
    const response = await client.listMyBetaFeatures();
    return {
      content: [{ type: "text", text: formatBetaFeaturesMyResponse(response) }],
    };
  } catch (error) {
    if (isApiError(error)) {
      return formatErrorResult(error);
    }
    return formatErrorResult(error as Error);
  }
}

// ============================================================================
// Enable Beta Feature
// ============================================================================

export const enableBetaFeatureSchema = z.object({
  slug: z
    .string()
    .min(1)
    .describe(
      "URL-safe slug of the beta feature to opt in to " +
        "(e.g., 'v2-extraction', 'stealth-v3'). " +
        "Use alterlab_list_beta_features to see available slugs.",
    ),
});

export const enableBetaFeatureDescription =
  "Opt in to a beta feature on your AlterLab account. " +
  "Beta features are experimental capabilities available before general release. " +
  "This operation is idempotent — calling it when already opted in returns success. " +
  "Use alterlab_list_beta_features to discover available feature slugs.";

export async function handleEnableBetaFeature(
  client: AlterLabClient,
  params: z.infer<typeof enableBetaFeatureSchema>,
): Promise<CallToolResult> {
  try {
    const response = await client.enableBetaFeature(params.slug);
    return {
      content: [
        { type: "text", text: formatBetaFeatureToggleResponse(response) },
      ],
    };
  } catch (error) {
    if (isApiError(error)) {
      return formatErrorResult(error);
    }
    return formatErrorResult(error as Error);
  }
}

// ============================================================================
// Disable Beta Feature
// ============================================================================

export const disableBetaFeatureSchema = z.object({
  slug: z
    .string()
    .min(1)
    .describe(
      "URL-safe slug of the beta feature to opt out of " +
        "(e.g., 'v2-extraction', 'stealth-v3'). " +
        "Use alterlab_list_my_beta_features to see your currently active slugs.",
    ),
});

export const disableBetaFeatureDescription =
  "Opt out of a beta feature on your AlterLab account. " +
  "This operation is idempotent — calling it when not opted in returns success. " +
  "GA (generally available) features cannot be disabled.";

export async function handleDisableBetaFeature(
  client: AlterLabClient,
  params: z.infer<typeof disableBetaFeatureSchema>,
): Promise<CallToolResult> {
  try {
    const response = await client.disableBetaFeature(params.slug);
    return {
      content: [
        { type: "text", text: formatBetaFeatureToggleResponse(response) },
      ],
    };
  } catch (error) {
    if (isApiError(error)) {
      return formatErrorResult(error);
    }
    return formatErrorResult(error as Error);
  }
}

// ============================================================================
// Helpers
// ============================================================================

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as ApiError).status === "number"
  );
}
