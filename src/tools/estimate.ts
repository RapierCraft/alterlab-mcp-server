import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";
import { formatEstimateResponse } from "../format.js";

export const estimateSchema = z.object({
  url: z.string().url().describe("URL to estimate scraping cost for"),
  mode: z
    .enum(["auto", "html", "js", "pdf", "ocr"])
    .default("auto")
    .describe("Scraping mode"),
  formats: z
    .array(
      z.enum([
        "text",
        "json",
        "json_v2",
        "html",
        "markdown",
        "rag",
        "content",
        "raw",
      ]),
    )
    .optional()
    .describe(
      "Output formats to include in the estimate. Affects cost prediction accuracy. " +
        "'json_v2' returns a structured section tree. " +
        "'rag' returns chunked text for retrieval-augmented generation. " +
        "'content' returns body_markdown + content_hash + images + links. " +
        "'raw' returns the response body byte-for-byte with no transformation.",
    ),
  render_js: z
    .boolean()
    .default(false)
    .describe(
      "Enable JS rendering (forces Tier 4 minimum — no separate add-on charge)",
    ),
  use_proxy: z
    .boolean()
    .default(false)
    .describe("Include premium proxy cost (+1 credit)"),
});

export const estimateDescription =
  "Estimate the cost of scraping a URL without actually scraping it. " +
  "Returns the predicted tier, cost per request, and confidence level. " +
  "Use this to check costs before running expensive scrapes.";

export async function handleEstimate(
  client: AlterLabClient,
  params: z.infer<typeof estimateSchema>,
): Promise<CallToolResult> {
  try {
    const estimate = await client.estimate({
      url: params.url,
      mode: params.mode,
      formats: params.formats,
      advanced: {
        render_js: params.render_js,
        use_proxy: params.use_proxy,
      },
    });
    return {
      content: [{ type: "text", text: formatEstimateResponse(estimate) }],
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
