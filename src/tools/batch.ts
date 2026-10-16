import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";
import type { BatchItemRequest } from "../types.js";
import {
  FORMATS_DESCRIPTION,
  advancedShape,
  allFormatEnum,
  batchExtractionProfileEnum,
  compact,
  contentTypeEnum,
  costControlsSchema,
  extractionProfileEnum,
  extractionProviderEnum,
  locationSchema,
  modeEnum,
} from "./common.js";

// ============================================================================
// Submit Batch
// ============================================================================

export const batchItemSchema = z.object({
  url: z.string().url().max(2083).describe("URL to scrape"),
  mode: modeEnum.optional().describe("Scraping mode for this URL (API default auto)"),
  method: z
    .enum(["GET", "POST"])
    .optional()
    .describe("HTTP method for this URL. POST costs 1.5x the base tier price."),
  body: z.string().optional().describe("Request body for POST requests to this URL"),
  content_type: contentTypeEnum
    .optional()
    .describe("Content-Type of the POST body for this URL"),
  formats: z
    .array(allFormatEnum)
    .optional()
    .describe("Output formats for this URL. " + FORMATS_DESCRIPTION),
  extraction_schema: z
    .record(z.unknown())
    .optional()
    .describe("JSON schema for structured extraction from this URL"),
  extraction_prompt: z
    .string()
    .max(2000)
    .optional()
    .describe("Natural language extraction instruction for this URL"),
  extraction_provider: extractionProviderEnum
    .optional()
    .describe("BYOK LLM provider for extraction on this URL"),
  extraction_profile: extractionProfileEnum
    .optional()
    .describe("Pre-built extraction profile for this URL (mutually exclusive with extraction_template)"),
  extraction_template: extractionProfileEnum
    .optional()
    .describe("Alias for extraction_profile (mutually exclusive with it)"),
  advanced: z
    .object({
      ...advancedShape,
      screenshot: z
        .boolean()
        .optional()
        .describe("Capture a full-page screenshot of this URL (+$0.0002, requires render_js)"),
      markdown: z
        .boolean()
        .optional()
        .describe("Extract content as Markdown for this URL (free)"),
    })
    .optional()
    .describe(
      "Advanced scrape options for this URL (render_js, use_proxy, use_own_proxy, actions, session_id, " +
        "cookies, skip_tls_verification, sticky_session, ...). Same fields as the alterlab_scrape parameters of the same name.",
    ),
  location: locationSchema
    .optional()
    .describe("Geo-targeting for this URL (country, language)"),
  cost_controls: costControlsSchema
    .optional()
    .describe("Cost and tier controls for this URL (max_tier, force_tier, max_credits, ...)"),
  render_js: z
    .union([z.boolean(), z.literal("auto")])
    .optional()
    .describe("Shortcut for advanced.render_js for this URL"),
  use_proxy: z
    .boolean()
    .optional()
    .describe("Shortcut for advanced.use_proxy for this URL"),
  timeout: z
    .number()
    .int()
    .min(1)
    .max(300)
    .optional()
    .describe("Timeout in seconds for this URL (1-300, API default 90)"),
  wait_for: z
    .string()
    .optional()
    .describe("CSS selector to wait for before extracting content"),
  cache: z.boolean().optional().describe("Enable caching for this URL"),
  include_raw_html: z
    .boolean()
    .optional()
    .describe("Include raw HTML in the result for this URL"),
});

export const batchSchema = z.object({
  urls: z
    .array(batchItemSchema)
    .min(1)
    .max(100)
    .describe("List of URLs to scrape (max 100)"),
  session_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      "UUID of a stored session applied to every URL in the batch (see alterlab_list_sessions)",
    ),
  webhook_url: z
    .string()
    .url()
    .max(2083)
    .optional()
    .describe(
      "Webhook URL to receive batch.completed event when all jobs finish",
    ),
  export: z
    .object({
      integration_id: z
        .string()
        .describe("ID of a storage integration (S3/R2/GCS) configured in the dashboard"),
      prefix: z.string().max(500).optional().describe("Object key prefix for exported files"),
      format: z.enum(["jsonl", "csv", "json"]).optional().describe("Export file format (API default jsonl)"),
    })
    .optional()
    .describe("Export batch results to a storage integration when the batch finishes"),
  extraction_schema: z
    .record(z.unknown())
    .optional()
    .describe("Batch-level JSON schema for structured extraction applied to every URL"),
  extraction_prompt: z
    .string()
    .max(2000)
    .optional()
    .describe("Batch-level natural language extraction instruction"),
  extraction_provider: extractionProviderEnum
    .optional()
    .describe("Batch-level BYOK LLM provider for extraction"),
  extraction_profile: batchExtractionProfileEnum
    .optional()
    .describe("Batch-level pre-built extraction profile applied to every URL"),
});

export const batchDescription =
  "Scrape up to 100 URLs in parallel with a single request — much faster and more efficient than sequential alterlab_scrape calls. " +
  "Each URL automatically gets anti-bot bypass protection (Cloudflare, DataDome, etc.) at its own tier level " +
  "(tier 1 $0.0002 ... tier 4 $0.004 per URL). " +
  "Returns a batch_id immediately — use alterlab_batch_status to poll results. " +
  "Each URL can have its own mode, method/body, formats, extraction options, advanced options, location and cost_controls. " +
  "Batch-level session_id, extraction_* and export apply to the whole batch. " +
  "Credits are pre-debited based on estimated cost; unused credits are refunded on completion. " +
  "Use this whenever you need to scrape more than 2-3 URLs.";

/** Translate a batch item's tool parameters into the API's BatchItemRequest. Exported for tests. */
export function buildBatchItem(item: z.infer<typeof batchItemSchema>): BatchItemRequest {
  const { render_js, use_proxy, advanced, ...rest } = item;
  const mergedAdvanced = compact({
    ...(advanced ?? {}),
    ...(render_js !== undefined && advanced?.render_js === undefined ? { render_js } : {}),
    ...(use_proxy !== undefined && advanced?.use_proxy === undefined ? { use_proxy } : {}),
  });
  return {
    ...compact(rest),
    ...(Object.keys(mergedAdvanced).length > 0 ? { advanced: mergedAdvanced } : {}),
  } as BatchItemRequest;
}

export async function handleBatch(
  client: AlterLabClient,
  params: z.infer<typeof batchSchema>,
): Promise<CallToolResult> {
  try {
    const response = await client.submitBatch({
      urls: params.urls.map(buildBatchItem),
      ...compact({
        session_id: params.session_id,
        webhook_url: params.webhook_url,
        export: params.export,
        extraction_schema: params.extraction_schema,
        extraction_prompt: params.extraction_prompt,
        extraction_provider: params.extraction_provider,
        extraction_profile: params.extraction_profile,
      }),
    });

    const text =
      `**Batch Submitted**\n\n` +
      `- Batch ID: \`${response.batch_id}\`\n` +
      `- Status: ${response.status}\n` +
      `- Total URLs: ${response.total_urls}\n` +
      `- Estimated credits: ${response.estimated_credits}\n\n` +
      `Use \`alterlab_batch_status\` with batch_id \`${response.batch_id}\` to poll for results.\n` +
      `Individual job IDs: ${(response.job_ids ?? []).slice(0, 5).join(", ")}${(response.job_ids ?? []).length > 5 ? ` ... and ${(response.job_ids ?? []).length - 5} more` : ""}`;

    return { content: [{ type: "text", text }] };
  } catch (error) {
    if (isApiError(error)) {
      return formatErrorResult(error);
    }
    return formatErrorResult(error as Error);
  }
}

// ============================================================================
// Batch Status
// ============================================================================

export const batchStatusSchema = z.object({
  batch_id: z.string().describe("Batch ID returned by alterlab_batch"),
});

export const batchStatusDescription =
  "Poll the status and results of a submitted batch. " +
  "Call this after alterlab_batch to check progress and retrieve scraped content. " +
  "Status values: processing, completed, failed, partially_failed. " +
  "When completed, results contains the content for each URL.";

export async function handleBatchStatus(
  client: AlterLabClient,
  params: z.infer<typeof batchStatusSchema>,
): Promise<CallToolResult> {
  try {
    const response = await client.getBatchStatus(params.batch_id);
    const text = formatBatchStatusResponse(response, params.batch_id);
    return { content: [{ type: "text", text }] };
  } catch (error) {
    if (isApiError(error)) {
      return formatErrorResult(error, { url: params.batch_id });
    }
    return formatErrorResult(error as Error, { url: params.batch_id });
  }
}

function formatBatchStatusResponse(response: unknown, batchId: string): string {
  const r = response as Record<string, unknown>;
  const status = String(r.status ?? "unknown");
  const totalUrls = Number(r.total_urls ?? 0);
  const completedCount = Number(r.completed ?? 0);
  const failedCount = Number(r.failed ?? 0);
  const creditsUsed = r.credits_used ? Number(r.credits_used) : null;
  const items = Array.isArray(r.items) ? r.items : [];

  const parts: string[] = [
    `**Batch Status: ${status.toUpperCase()}**\n`,
    `- Batch ID: \`${batchId}\``,
    `- Total URLs: ${totalUrls}`,
    `- Completed: ${completedCount}`,
    `- Failed: ${failedCount}`,
  ];

  if (creditsUsed !== null) {
    parts.push(`- Credits used: ${creditsUsed}`);
  }

  if (status === "processing") {
    const remaining = totalUrls - completedCount - failedCount;
    parts.push(
      `\n${remaining} URL${remaining !== 1 ? "s" : ""} still processing. Poll again with \`alterlab_batch_status\`.`,
    );
  } else if (items.length > 0) {
    parts.push("\n**Results:**\n");
    for (const item of items) {
      const it = item as Record<string, unknown>;
      const url = String(it.url ?? "");
      const itemStatus = String(it.status ?? "");
      const error = it.error ? ` (${String(it.error)})` : "";

      let contentPreview = "";
      const result = it.result as Record<string, unknown> | undefined;
      if (result) {
        const content = result.content;
        if (typeof content === "object" && content !== null) {
          const contentMap = content as Record<string, string>;
          const text =
            contentMap.markdown || contentMap.text || contentMap.html || "";
          if (text) {
            contentPreview = ` — "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"`;
          }
        } else if (typeof content === "string") {
          contentPreview = ` — "${content.slice(0, 80)}${content.length > 80 ? "..." : ""}"`;
        }
      }

      parts.push(`- [${itemStatus}] ${url}${error}${contentPreview}`);
    }
  }

  return parts.join("\n");
}

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as ApiError).status === "number"
  );
}
