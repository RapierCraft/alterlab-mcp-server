import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface ApiError {
  status: number;
  detail?: string;
  url?: string;
}

export function formatErrorResult(
  error: ApiError | Error,
  context?: { url?: string }
): CallToolResult {
  if (error instanceof Error) {
    // Network/timeout errors
    const url = context?.url ? ` for ${context.url}` : "";
    if (error.name === "AbortError" || error.message.includes("timeout")) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              `Request timed out${url}.\n\n` +
              "Suggested actions:\n" +
              "- Increase the `timeout` parameter (max 300s)\n" +
              "- Try with `render_js: false` if JS rendering is enabled\n" +
              "- The page may be very slow to load; try again later",
          },
        ],
      };
    }
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Request failed${url}: ${error.message}`,
        },
      ],
    };
  }

  const url = error.url ? ` for ${error.url}` : context?.url ? ` for ${context.url}` : "";
  const detail = error.detail || "Unknown error";

  switch (error.status) {
    case 400:
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              `Bad request${url}: ${detail}\n\n` +
              "Check the parameters and try again. Common issues:\n" +
              "- Invalid URL format\n" +
              "- Unsupported mode for this URL type",
          },
        ],
      };

    case 401:
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "Authentication failed: Invalid API key.\n\n" +
              "Check that ALTERLAB_API_KEY is set correctly.\n" +
              "Get a new key at: https://alterlab.io/dashboard/api-keys",
          },
        ],
      };

    case 402:
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              `Insufficient credits${url}.\n\n` +
              "Suggested actions:\n" +
              "- Use `alterlab_check_balance` to see your current balance\n" +
              "- Add funds at: https://alterlab.io/dashboard/billing\n" +
              "- Use `alterlab_estimate_cost` to check costs before scraping",
          },
        ],
      };

    case 403:
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              `Access denied${url}: ${detail}\n\n` +
              "The site may have blocked the request. Suggested actions:\n" +
              "- Try with `render_js: true` to use a headless browser\n" +
              "- Try with `use_proxy: true` to route through a premium proxy\n" +
              "- Some sites may not be scrapable",
          },
        ],
      };

    case 422:
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Validation error${url}: ${detail}`,
          },
        ],
      };

    case 429:
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              `Rate limited${url}.\n\n` +
              "Too many requests. Wait a moment and try again.\n" +
              "The request will be automatically retried with backoff.",
          },
        ],
      };

    case 504:
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              `Gateway timeout${url}.\n\n` +
              "The scraping job may still be running on the server.\n" +
              "Do NOT retry immediately — credits may have been consumed.\n" +
              "Wait and check your balance before retrying.",
          },
        ],
      };

    default:
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `API error (${error.status})${url}: ${detail}`,
          },
        ],
      };
  }
}
