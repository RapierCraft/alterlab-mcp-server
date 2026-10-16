import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";
import type { SessionCreateRequest } from "../types.js";
import { compact } from "./common.js";
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

const cookieObjectSchema = z
  .object({
    name: z.string().min(1),
    value: z.string(),
    domain: z.string().optional(),
    path: z.string().optional(),
    secure: z.boolean().optional(),
    httpOnly: z.boolean().optional(),
    sameSite: z.string().optional(),
    expires: z.number().optional(),
  })
  .passthrough();

const cookiesSchema = z.union([
  z.record(z.string(), z.string()),
  z.array(cookieObjectSchema).max(100),
]);

const COOKIES_DESCRIPTION =
  'Cookies as a {name: value} object (e.g. {"session-id": "abc123"}) or as a list (max 100) of cookie ' +
  "objects with metadata: {name, value, domain?, path?, secure?, httpOnly?, sameSite?, expires?}.";

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
    .min(3)
    .max(255)
    .describe("Domain this session is for (e.g., 'amazon.com')"),
  consent: z
    .boolean()
    .describe(
      "Explicit GDPR consent from the account owner to store these session cookies. " +
        "Must be true — the API rejects session creation with CONSENT_REQUIRED otherwise. " +
        "Only set true after the user has agreed to AlterLab storing their cookies.",
    ),
  cookies: cookiesSchema.optional().describe("Cookies for authentication. " + COOKIES_DESCRIPTION),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Custom headers sent with this session (e.g., a User-Agent or Authorization header)",
    ),
  expires_at: z
    .string()
    .optional()
    .describe("Session expiry in ISO 8601 format (e.g., '2026-12-31T23:59:59Z')"),
  notes: z.string().max(1000).optional().describe("Free-text notes about this session"),
  auto_refresh_enabled: z
    .boolean()
    .optional()
    .describe("Enable proactive expiry detection and health checks (API default true)"),
  notify_before_expiry: z
    .boolean()
    .optional()
    .describe("Notify when the session is about to expire (API default true)"),
  notify_on_failure: z
    .boolean()
    .optional()
    .describe("Notify when session validation fails (API default true)"),
  organization_id: z
    .string()
    .uuid()
    .optional()
    .describe("Organization to assign the session to (org admins only)"),
  shared: z
    .boolean()
    .optional()
    .describe("Share the session with organization members immediately (API default false)"),
});

export const createSessionDescription =
  "Create a new stored session for authenticated scraping. " +
  "Provide cookies from a logged-in browser session to enable scraping " +
  "behind login walls. The session is stored securely and can be reused " +
  "across multiple scrape requests via session_id. " +
  "Requires consent=true (explicit GDPR consent to store the cookies); optional headers, expires_at, notes, " +
  "auto_refresh/notification flags and organization sharing are supported.";

export async function handleCreateSession(
  client: AlterLabClient,
  params: z.infer<typeof createSessionSchema>,
): Promise<CallToolResult> {
  try {
    const response = await client.createSession(compact(params) as SessionCreateRequest);
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
  cookies: cookiesSchema
    .optional()
    .describe(
      "New cookies — replaces ALL existing cookies. " + COOKIES_DESCRIPTION,
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
  auto_refresh_enabled: z
    .boolean()
    .optional()
    .describe("Enable or disable proactive expiry detection and health checks"),
  notify_before_expiry: z
    .boolean()
    .optional()
    .describe("Enable or disable the before-expiry notification"),
  notify_on_failure: z
    .boolean()
    .optional()
    .describe("Enable or disable the validation-failure notification"),
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
  cookies: cookiesSchema
    .optional()
    .describe(
      "New cookies to replace the old ones. If omitted, only failure counters are reset. " +
        COOKIES_DESCRIPTION,
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
