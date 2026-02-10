import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";
import { TIER_NAMES } from "../types.js";

export const screenshotSchema = z.object({
  url: z.string().url().describe("URL to take a screenshot of"),
  wait_for: z
    .string()
    .optional()
    .describe("CSS selector to wait for before taking screenshot"),
  wait_until: z
    .enum(["networkidle", "domcontentloaded", "load"])
    .default("networkidle")
    .describe("Page load event to wait for before screenshot"),
});

export const screenshotDescription =
  "Take a full-page screenshot of a URL. Returns the screenshot as a PNG image. " +
  "Uses headless browser rendering. " +
  "Use wait_for to wait for a specific element before capturing.";

export async function handleScreenshot(
  client: AlterLabClient,
  params: z.infer<typeof screenshotSchema>
): Promise<CallToolResult> {
  try {
    // Screenshot requires render_js=true and screenshot=true
    const response = await client.scrape({
      url: params.url,
      mode: "js",
      sync: true,
      screenshot: true,
      wait_for: params.wait_for,
      wait_until: params.wait_until,
      advanced: {
        render_js: true,
        screenshot: true,
      },
    });

    if (!response.screenshot_url) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              `Screenshot was not generated for ${params.url}.\n\n` +
              "The page may have failed to render. Try:\n" +
              "- Increasing timeout\n" +
              "- Using wait_for to target a specific element\n" +
              "- Checking that the URL is accessible",
          },
        ],
      };
    }

    // Fetch the screenshot image and return as base64
    const base64 = await client.fetchScreenshotAsBase64(
      response.screenshot_url
    );

    const tier = response.billing.tier_used;
    const tierName = TIER_NAMES[tier] || tier;

    return {
      content: [
        {
          type: "image" as const,
          data: base64,
          mimeType: "image/png",
        },
        {
          type: "text" as const,
          text:
            `Screenshot of ${response.url}\n` +
            `Tier: ${tierName} | Time: ${response.response_time_ms}ms`,
        },
      ],
    };
  } catch (error) {
    if (isApiError(error)) {
      return formatErrorResult(error, { url: params.url });
    }
    return formatErrorResult(error as Error, { url: params.url });
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
