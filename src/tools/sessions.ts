import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";
import { formatSessionListResponse, formatSessionCreateResponse, formatSessionValidateResponse } from "../format.js";

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
  client: AlterLabClient
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
    .describe("Human-readable name for this session (e.g., 'My Amazon Account')"),
  domain: z
    .string()
    .min(1)
    .describe("Domain this session is for (e.g., 'amazon.com')"),
  cookies: z
    .record(z.string(), z.string())
    .describe(
      "Cookie key-value pairs for authentication " +
      "(e.g., {\"session-id\": \"abc123\", \"session-token\": \"xyz789\"})"
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
  params: z.infer<typeof createSessionSchema>
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
  session_id: z
    .string()
    .uuid()
    .describe("UUID of the session to validate"),
});

export const validateSessionDescription =
  "Validate whether a stored session is still active and its cookies are valid. " +
  "Run this before scraping if you suspect a session may have expired. " +
  "Returns the session status and a reason if invalid.";

export async function handleValidateSession(
  client: AlterLabClient,
  params: z.infer<typeof validateSessionSchema>
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
// Delete Session
// ============================================================================

export const deleteSessionSchema = z.object({
  session_id: z
    .string()
    .uuid()
    .describe("UUID of the session to delete"),
});

export const deleteSessionDescription =
  "Delete a stored session. This permanently removes the session and its " +
  "cookies. Use this when a session is no longer needed or has been compromised.";

export async function handleDeleteSession(
  client: AlterLabClient,
  params: z.infer<typeof deleteSessionSchema>
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
