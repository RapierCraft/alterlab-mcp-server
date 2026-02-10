import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";
import { formatScrapeResponse } from "../format.js";

export const scrapeSchema = z.object({
  url: z.string().url().describe("URL to scrape"),
  mode: z
    .enum(["auto", "html", "js", "pdf", "ocr"])
    .default("auto")
    .describe("Scraping mode: auto (recommended), html, js (headless browser), pdf, or ocr"),
  formats: z
    .array(z.enum(["text", "json", "html", "markdown"]))
    .default(["markdown"])
    .describe("Output formats. 'markdown' is best for LLM consumption"),
  render_js: z
    .boolean()
    .default(false)
    .describe("Render JavaScript using headless browser (+3 credits). Required for JS-heavy sites"),
  use_proxy: z
    .boolean()
    .default(false)
    .describe("Route through premium proxy (+1 credit). Helps bypass geo-restrictions and anti-bot"),
  proxy_country: z
    .string()
    .optional()
    .describe("ISO country code for geo-targeting (e.g., 'US', 'DE'). Requires use_proxy=true"),
  wait_for: z
    .string()
    .optional()
    .describe("CSS selector to wait for before extracting content (e.g., '#main-content')"),
  timeout: z
    .number()
    .min(1)
    .max(300)
    .default(90)
    .describe("Request timeout in seconds (1-300)"),
  include_raw_html: z
    .boolean()
    .default(false)
    .describe("Include raw HTML in the response alongside formatted content"),
});

export const scrapeDescription =
  "Scrape a URL and return its content as markdown, text, HTML, or JSON. " +
  "Automatically handles anti-bot protection with tier escalation. " +
  "Returns markdown by default — optimized for LLM context. " +
  "Use render_js=true for JavaScript-heavy sites (React, Angular, SPAs). " +
  "Use use_proxy=true for geo-restricted or heavily protected sites.";

export async function handleScrape(
  client: AlterLabClient,
  params: z.infer<typeof scrapeSchema>
): Promise<CallToolResult> {
  try {
    const response = await client.scrape({
      url: params.url,
      mode: params.mode,
      formats: params.formats,
      sync: true,
      timeout: params.timeout,
      include_raw_html: params.include_raw_html,
      wait_for: params.wait_for,
      advanced: {
        render_js: params.render_js,
        use_proxy: params.use_proxy,
        proxy_country: params.proxy_country,
        markdown: params.formats.includes("markdown"),
      },
    });

    return {
      content: [{ type: "text", text: formatScrapeResponse(response) }],
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
