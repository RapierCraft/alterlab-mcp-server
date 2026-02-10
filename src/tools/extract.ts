import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";
import { formatExtractResponse } from "../format.js";

export const extractSchema = z.object({
  url: z.string().url().describe("URL to extract structured data from"),
  extraction_profile: z
    .enum(["auto", "product", "article", "job_posting", "faq", "recipe", "event"])
    .default("auto")
    .describe(
      "Pre-defined extraction profile. 'product' extracts price/title/reviews, " +
        "'article' extracts title/author/body, etc. 'auto' detects the page type"
    ),
  extraction_schema: z
    .record(z.unknown())
    .optional()
    .describe(
      "Custom JSON Schema for extraction. Fields are mapped from page content. " +
        "Overrides extraction_profile when provided"
    ),
  extraction_prompt: z
    .string()
    .optional()
    .describe(
      "Natural language instructions for extraction (e.g., 'Extract all product prices and ratings')"
    ),
  render_js: z
    .boolean()
    .default(false)
    .describe("Render JavaScript using headless browser (+3 credits)"),
  use_proxy: z
    .boolean()
    .default(false)
    .describe("Route through premium proxy (+1 credit)"),
});

export const extractDescription =
  "Extract structured data from a webpage using pre-defined profiles or custom schemas. " +
  "Profiles: 'product' (price, title, reviews), 'article' (title, author, body), " +
  "'job_posting', 'faq', 'recipe', 'event'. " +
  "Returns JSON data. Use extraction_prompt for natural language extraction instructions.";

export async function handleExtract(
  client: AlterLabClient,
  params: z.infer<typeof extractSchema>
): Promise<CallToolResult> {
  try {
    const response = await client.scrape({
      url: params.url,
      formats: ["json"],
      sync: true,
      extraction_profile: params.extraction_profile,
      extraction_schema: params.extraction_schema,
      extraction_prompt: params.extraction_prompt,
      advanced: {
        render_js: params.render_js,
        use_proxy: params.use_proxy,
      },
    });

    return {
      content: [{ type: "text", text: formatExtractResponse(response) }],
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
