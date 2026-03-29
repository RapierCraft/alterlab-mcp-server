import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";
import {
  formatSessionListResponse,
  formatSessionCreateResponse,
  formatSessionDetailResponse,
  formatSessionUpdateResponse,
  formatSessionRefreshResponse,
  formatSessionValidateResponse,
} from "../format.js";

// ============================================================================
// List Sessions
// ============================================================================

export const listSessionsSchema = z.object({});

export const listSessionsDescription =
  "List all stored sessions for authenticated scraping. " +
  "Sessions contain cookies for specific domains, allowing you to scrape " +
  "content that requires login (e.g., Amazon order history, LinkedIn profiles). " +
  "Use the returned session_id with alterlab_scrape to scrape authenticated pages.";

export async function handleListSessions(
  client: AlterLabClient,
): Promise<CallToolResult> {
  try {
    const response = await client.listSessions();
    return {
      content: [{ type: "text", text: formatSessionListResponse(response) }],
    };
  } catch (error) {
    if (isApiError(error)) {
      return formatErrorResult(error);
    }
    return formatErrorResult(error as Error);
  }
}

// ============================================================================
// Create Session
// ============================================================================

export const createSessionSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .describe(
      "Human-readable name for this session (e.g., 'My Amazon Account')",
    ),
  domain: z
    .string()
    .min(1)
    .describe("Domain this session is for (e.g., 'amazon.com')"),
  cookies: z
    .record(z.string(), z.string())
    .describe(
      "Cookie key-value pairs for authentication " +
        '(e.g., {"session-id": "abc123", "session-token": "xyz789"})',
    ),
  user_agent: z
    .string()
    .optional()
    .describe("Browser User-Agent string to use with this session"),
});

export const createSessionDescription =
  "Create a new stored session for authenticated scraping. " +
  "Provide cookies from a logged-in browser session to enable scraping " +
  "behind login walls. The session is stored securely and can be reused " +
  "across multiple scrape requests via session_id.";

export async function handleCreateSession(
  client: AlterLabClient,
  params: z.infer<typeof createSessionSchema>,
): Promise<CallToolResult> {
  try {
    const response = await client.createSession({
      name: params.name,
      domain: params.domain,
      cookies: params.cookies,
      user_agent: params.user_agent,
    });
    return {
      content: [{ type: "text", text: formatSessionCreateResponse(response) }],
    };
  } catch (error) {
    if (isApiError(error)) {
      return formatErrorResult(error);
    }
    return formatErrorResult(error as Error);
  }
}

// ============================================================================
// Validate Session
// ============================================================================

export const validateSessionSchema = z.object({
  session_id: z.string().uuid().describe("UUID of the session to validate"),
});

export const validateSessionDescription =
  "Validate whether a stored session is still active and its cookies are valid. " +
  "Run this before scraping if you suspect a session may have expired. " +
  "Returns the session status and a reason if invalid.";

export async function handleValidateSession(
  client: AlterLabClient,
  params: z.infer<typeof validateSessionSchema>,
): Promise<CallToolResult> {
  try {
    const response = await client.validateSession(params.session_id);
    return {
      content: [
        { type: "text", text: formatSessionValidateResponse(response) },
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
// Get Session
// ============================================================================

export const getSessionSchema = z.object({
  session_id: z.string().uuid().describe("UUID of the session to retrieve"),
});

export const getSessionDescription =
  "Get detailed information about a specific stored session. " +
  "Returns session status, cookie names, usage statistics (total requests, " +
  "success rate), expiry info, and notes. Use this to inspect a session " +
  "before deciding to validate, refresh, or delete it.";

export async function handleGetSession(
  client: AlterLabClient,
  params: z.infer<typeof getSessionSchema>,
): Promise<CallToolResult> {
  try {
    const response = await client.getSession(params.session_id);
    return {
      content: [{ type: "text", text: formatSessionDetailResponse(response) }],
    };
  } catch (error) {
    if (isApiError(error)) {
      return formatErrorResult(error);
    }
    return formatErrorResult(error as Error);
  }
}

// ============================================================================
// Update Session
// ============================================================================

export const updateSessionSchema = z.object({
  session_id: z.string().uuid().describe("UUID of the session to update"),
  name: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe("New name for the session"),
  cookies: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "New cookie key-value pairs — replaces ALL existing cookies " +
        '(e.g., {"session-id": "new123", "session-token": "newxyz"})',
    ),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe("New custom headers — replaces ALL existing headers"),
  expires_at: z
    .string()
    .optional()
    .describe(
      "New expiration date in ISO 8601 format (e.g., '2026-12-31T23:59:59Z')",
    ),
  notes: z
    .string()
    .max(1000)
    .optional()
    .describe("Notes or description for this session"),
});

export const updateSessionDescription =
  "Update a stored session's properties. You can change the name, rotate " +
  "cookies, update custom headers, set a new expiration, or add notes. " +
  "When cookies are provided, they replace ALL existing cookies (not merged). " +
  "Use this instead of delete+recreate when you need to rotate credentials.";

export async function handleUpdateSession(
  client: AlterLabClient,
  params: z.infer<typeof updateSessionSchema>,
): Promise<CallToolResult> {
  try {
    const { session_id, ...updateFields } = params;
    const response = await client.updateSession(session_id, updateFields);
    return {
      content: [{ type: "text", text: formatSessionUpdateResponse(response) }],
    };
  } catch (error) {
    if (isApiError(error)) {
      return formatErrorResult(error);
    }
    return formatErrorResult(error as Error);
  }
}

// ============================================================================
// Refresh Session
// ============================================================================

export const refreshSessionSchema = z.object({
  session_id: z.string().uuid().describe("UUID of the session to refresh"),
  cookies: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "New cookie key-value pairs to replace the old ones. " +
        "If omitted, only failure counters are reset.",
    ),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe("Updated custom headers to include with the session"),
});

export const refreshSessionDescription =
  "Refresh a session by rotating its cookies and resetting failure counters. " +
  "This is the preferred way to update cookies after re-authenticating in " +
  "your browser. The session status is reset to active. If cookies are " +
  "omitted, only the failure counters are reset.";

export async function handleRefreshSession(
  client: AlterLabClient,
  params: z.infer<typeof refreshSessionSchema>,
): Promise<CallToolResult> {
  try {
    const { session_id, ...refreshFields } = params;
    const response = await client.refreshSession(session_id, refreshFields);
    return {
      content: [{ type: "text", text: formatSessionRefreshResponse(response) }],
    };
  } catch (error) {
    if (isApiError(error)) {
      return formatErrorResult(error);
    }
    return formatErrorResult(error as Error);
  }
}

// ============================================================================
// Delete Session
// ============================================================================

export const deleteSessionSchema = z.object({
  session_id: z.string().uuid().describe("UUID of the session to delete"),
});

export const deleteSessionDescription =
  "Delete a stored session. This permanently removes the session and its " +
  "cookies. Use this when a session is no longer needed or has been compromised.";

export async function handleDeleteSession(
  client: AlterLabClient,
  params: z.infer<typeof deleteSessionSchema>,
): Promise<CallToolResult> {
  try {
    await client.deleteSession(params.session_id);
    return {
      content: [
        {
          type: "text",
          text: `Session \`${params.session_id}\` has been deleted.`,
        },
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
