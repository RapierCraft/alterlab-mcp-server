import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";
import { formatScrapeResponse } from "../format.js";
import type { UnifiedScrapeResponse } from "../types.js";

export const getJobSchema = z.object({
  job_id: z
    .string()
    .min(1)
    .describe(
      "Job ID returned by an async or downgraded scrape (alterlab_scrape reports it when a scrape outlives the ~85s synchronous window)",
    ),
});

export const getJobDescription =
  "Fetch the status and result of an asynchronous scrape job by job_id. " +
  "Use this when alterlab_scrape or alterlab_screenshot returns a job_id instead of content " +
  "(a long-running scrape that outlived the synchronous wait window). " +
  "Status values: queued, processing, succeeded, failed, rejected (rejected = not processed due to insufficient balance; stop polling and check the balance). " +
  "Polling is free; do not re-run the scrape, which would be billed again.";

const MAX_RAW_CHARS = 20_000;

export async function handleGetJob(
  client: AlterLabClient,
  params: z.infer<typeof getJobSchema>,
): Promise<CallToolResult> {
  try {
    const job = await client.getJob(params.job_id);
    return { content: [{ type: "text", text: formatJob(job, params.job_id) }] };
  } catch (error) {
    if (isApiError(error)) {
      return formatErrorResult(error, { url: params.job_id });
    }
    return formatErrorResult(error as Error, { url: params.job_id });
  }
}

function formatJob(job: Record<string, unknown>, jobId: string): string {
  const status = String(job.status ?? "unknown");
  const parts: string[] = [`**Job ${status.toUpperCase()}**\n`, `- Job ID: \`${jobId}\``];

  if (job.error) {
    parts.push(
      `- Error: ${typeof job.error === "string" ? job.error : JSON.stringify(job.error)}`,
    );
  }

  const result = job.result as Record<string, unknown> | undefined;
  if (result && typeof result === "object") {
    if (result.billing && result.url) {
      parts.push("\n" + formatScrapeResponse(result as unknown as UnifiedScrapeResponse));
    } else {
      const raw = JSON.stringify(result, null, 2);
      parts.push(
        "\n```json\n" +
          raw.slice(0, MAX_RAW_CHARS) +
          (raw.length > MAX_RAW_CHARS ? "\n... (truncated)" : "") +
          "\n```",
      );
    }
  } else if (status === "queued" || status === "processing" || status === "pending") {
    parts.push("\nStill running — call alterlab_get_job again in a few seconds.");
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
