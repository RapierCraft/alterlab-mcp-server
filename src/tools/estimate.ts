import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";
import { formatEstimateResponse } from "../format.js";
import { allFormatEnum, FORMATS_DESCRIPTION, modeEnum } from "./common.js";
import { buildEstimateRequest } from "./scrape.js";

export const estimateSchema = z.object({
  url: z.string().url().max(2083).describe("URL to estimate scraping cost for"),
  mode: modeEnum.default("auto").describe("Scraping mode"),
  method: z
    .enum(["GET", "POST"])
    .optional()
    .describe("HTTP method. POST requests cost 1.5x the base tier price."),
  formats: z
    .array(allFormatEnum)
    .optional()
    .describe(
      "Output formats to include in the estimate. Passed to the API but does not currently affect the cost estimate — the endpoint uses URL-pattern heuristics only. " +
        FORMATS_DESCRIPTION,
    ),
  render_js: z
    .union([z.boolean(), z.literal("auto")])
    .default(false)
    .describe(
      "Enable JS rendering (forces Tier 4 minimum, $0.004 — no separate add-on charge)",
    ),
  use_proxy: z
    .boolean()
    .default(false)
    .describe("Include premium proxy cost (+$0.0002)"),
  use_own_proxy: z
    .boolean()
    .optional()
    .describe("Price the request with your own proxy integration (20% BYOP discount)"),
  screenshot: z.boolean().optional().describe("Include the screenshot add-on (+$0.0002)"),
  generate_pdf: z.boolean().optional().describe("Include the PDF add-on (+$0.0004)"),
  ocr: z.boolean().optional().describe("Include the OCR add-on (+$0.001)"),
});

export const estimateDescription =
  "Preview the cost of scraping a URL before committing — no credits charged. " +
  "Returns the predicted anti-bot tier, estimated cost per request, and confidence level. " +
  "Call this before scraping protected or unfamiliar sites to avoid surprises. " +
  "Tier 1 (curl): $0.0002. Tier 2 (http): $0.0003. Tier 3 (stealth): $0.002. Tier 3.5 (lightjs): $0.0025. " +
  "Tier 4 (full browser): $0.004. Tier 5 (captcha solver): $0.02. " +
  "Use render_js, use_proxy, screenshot, generate_pdf, ocr and method to see how options affect cost.";

export async function handleEstimate(
  client: AlterLabClient,
  params: z.infer<typeof estimateSchema>,
): Promise<CallToolResult> {
  try {
    const estimate = await client.estimate(buildEstimateRequest(params));
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
