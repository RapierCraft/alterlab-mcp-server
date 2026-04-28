import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";

// ============================================================================
// Submit Batch
// ============================================================================

const batchItemSchema = z.object({
  url: z.string().url().describe("URL to scrape"),
  mode: z
    .enum(["auto", "html", "js", "pdf", "ocr"])
    .default("auto")
    .optional()
    .describe("Scraping mode for this URL"),
  formats: z
    .array(z.enum(["text", "json", "json_v2", "html", "markdown", "rag"]))
    .optional()
    .describe("Output formats for this URL (overrides batch-level formats)"),
  extraction_schema: z
    .record(z.unknown())
    .optional()
    .describe("JSON schema for structured extraction from this URL"),
  render_js: z.boolean().optional().describe("Render JavaScript for this URL"),
  use_proxy: z.boolean().optional().describe("Use premium proxy for this URL"),
  timeout: z
    .number()
    .int()
    .min(1)
    .max(300)
    .default(90)
    .optional()
    .describe("Timeout in seconds for this URL"),
  wait_for: z
    .string()
    .optional()
    .describe("CSS selector to wait for before extracting content"),
  cache: z
    .boolean()
    .default(false)
    .optional()
    .describe("Enable caching for this URL"),
});

export const batchSchema = z.object({
  urls: z
    .array(batchItemSchema)
    .min(1)
    .max(100)
    .describe("List of URLs to scrape (max 100)"),
  webhook_url: z
    .string()
    .url()
    .optional()
    .describe(
      "Webhook URL to receive batch.completed event when all jobs finish",
    ),
});

export const batchDescription =
  "Submit up to 100 URLs for parallel scraping in a single batch request. " +
  "Returns a batch_id immediately — use alterlab_batch_status to poll results. " +
  "Each URL can have its own mode, formats, extraction_schema, and options. " +
  "Credits are pre-debited based on estimated cost; unused credits are refunded on completion. " +
  "Use this instead of calling alterlab_scrape repeatedly for multiple URLs.";

export async function handleBatch(
  client: AlterLabClient,
  params: z.infer<typeof batchSchema>,
): Promise<CallToolResult> {
  try {
    const response = await client.submitBatch({
      urls: params.urls.map((item) => ({
        url: item.url,
        mode: item.mode,
        formats: item.formats,
        extraction_schema: item.extraction_schema,
        timeout: item.timeout,
        wait_for: item.wait_for,
        cache: item.cache,
        advanced: {
          render_js: item.render_js,
          use_proxy: item.use_proxy,
        },
      })),
      webhook_url: params.webhook_url,
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
