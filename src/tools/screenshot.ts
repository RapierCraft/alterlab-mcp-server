import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";
import { TIER_NAMES } from "../types.js";
import { formatAsyncScrapeAccepted, formatBalanceWarning } from "../format.js";
import { compact, locationSchema } from "./common.js";

export const screenshotSchema = z.object({
  url: z.string().url().max(2083).describe("URL to take a screenshot of"),
  wait_for: z
    .string()
    .optional()
    .describe("CSS selector to wait for before taking screenshot"),
  wait_until: z
    .enum(["networkidle", "domcontentloaded", "load"])
    .default("networkidle")
    .describe("Page load event to wait for before screenshot"),
  timeout: z
    .number()
    .int()
    .min(1)
    .max(300)
    .optional()
    .describe("Request timeout in seconds (1-300, API default 90)"),
  use_proxy: z
    .boolean()
    .optional()
    .describe("Route through AlterLab's premium proxy (+$0.0002)"),
  proxy_country: z
    .string()
    .optional()
    .describe("ISO country code for proxy geo-targeting. Requires use_proxy=true"),
  session_id: z
    .string()
    .uuid()
    .optional()
    .describe("UUID of a stored session, to screenshot a logged-in page"),
  cookies: z
    .record(z.string(), z.string())
    .optional()
    .describe("Inline cookies for a one-off authenticated screenshot"),
  location: locationSchema.optional(),
});

export const screenshotDescription =
  "Take a screenshot of any website, capture a webpage as an image, or snapshot a URL visually. " +
  "Works on anti-bot protected sites (Cloudflare, DataDome, etc.) — uses the same bypass engine as alterlab_scrape. " +
  "Returns a full-page PNG screenshot directly in the conversation — rendered with a real headless browser " +
  "(tier 4 $0.004 + $0.0002 screenshot add-on). " +
  "Use wait_for to wait for a specific element before capturing. " +
  "Use wait_until to control page load timing (networkidle, domcontentloaded, load). " +
  "Use session_id or cookies to capture pages behind a login. " +
  "For the full set of scrape options (actions, sticky sessions, cost controls), call alterlab_scrape with screenshot=true.";

export async function handleScreenshot(
  client: AlterLabClient,
  params: z.infer<typeof screenshotSchema>,
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
      timeout: params.timeout,
      location: params.location,
      advanced: compact({
        render_js: true,
        screenshot: true,
        use_proxy: params.use_proxy,
        proxy_country: params.proxy_country,
        session_id: params.session_id,
        cookies: params.cookies,
      }),
    });

    if (!response.billing) {
      // 202: the render outlived the synchronous wait window.
      return {
        content: [{ type: "text", text: formatAsyncScrapeAccepted(response as never) }],
      };
    }

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
      response.screenshot_url,
    );

    const tier = response.billing.tier_used;
    const tierName = TIER_NAMES[tier] || tier;

    const balanceWarningSuffix = formatBalanceWarning(client.getLastBalanceWarning());
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
            `Tier: ${tierName} | Time: ${response.response_time_ms}ms` +
            balanceWarningSuffix,
        },
      ],
    };
  } catch (error) {
    const balanceWarningSuffix = formatBalanceWarning(client.getLastBalanceWarning());
    const result = isApiError(error)
      ? formatErrorResult(error, { url: params.url })
      : formatErrorResult(error as Error, { url: params.url });
    if (balanceWarningSuffix && result.content[0]?.type === "text") {
      (result.content[0] as { type: "text"; text: string }).text += balanceWarningSuffix;
    }
    return result;
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
