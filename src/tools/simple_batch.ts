import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { formatScrapeResponse } from "../format.js";

export const simpleBatchSchema = z.object({
  urls: z
    .array(z.string().url())
    .min(1)
    .max(20)
    .describe(
      "List of URLs to scrape (max 20). All results are returned synchronously.",
    ),
  formats: z
    .array(
      z.enum(["text", "json", "json_v2", "html", "markdown", "rag", "content"]),
    )
    .default(["markdown"])
    .describe(
      "Output formats applied to every URL. 'markdown' is best for LLM consumption.",
    ),
  render_js: z
    .boolean()
    .default(false)
    .describe(
      "Render JavaScript using headless browser for all URLs. " +
        "Required for JS-heavy sites. Increases cost to tier 4 (~$0.001/req).",
    ),
  use_proxy: z
    .boolean()
    .default(false)
    .describe("Route all requests through premium proxy (+~$0.0002/req)."),
  timeout: z
    .number()
    .int()
    .min(1)
    .max(300)
    .default(90)
    .describe("Request timeout in seconds per URL (1-300)."),
  max_concurrent: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(3)
    .describe(
      "Maximum number of URLs to scrape in parallel (1-10, default 3). " +
        "Higher values finish faster but consume more concurrent connections.",
    ),
});

export const simpleBatchDescription =
  "Scrape multiple URLs simultaneously and get all results back in one call — no polling required. " +
  "Unlike alterlab_batch (async with batch_id polling), this returns all results inline when complete. " +
  "Best for 2-20 URLs where you need results immediately. For 20+ URLs, use alterlab_batch instead. " +
  "Uses concurrent scraping (controlled by max_concurrent) for speed. " +
  "Shows per-URL status, content preview, and a total cost summary at the end. " +
  "Handles partial failures gracefully — failed URLs show error details, successful ones show content.";

type ScrapeOutcome =
  | { status: "fulfilled"; url: string; text: string; cost: number }
  | { status: "rejected"; url: string; error: string };

export async function handleSimpleBatch(
  client: AlterLabClient,
  params: z.infer<typeof simpleBatchSchema>,
): Promise<CallToolResult> {
  const { urls, formats, render_js, use_proxy, timeout, max_concurrent } =
    params;

  // Concurrency semaphore — limits inflight scrapes to max_concurrent.
  let inflight = 0;
  const queue: Array<() => void> = [];

  function acquire(): Promise<void> {
    if (inflight < max_concurrent) {
      inflight++;
      return Promise.resolve();
    }
    return new Promise((resolve) => queue.push(resolve));
  }

  function release(): void {
    inflight--;
    const next = queue.shift();
    if (next) {
      inflight++;
      next();
    }
  }

  async function scrapeOne(url: string): Promise<ScrapeOutcome> {
    await acquire();
    try {
      const response = await client.scrape({
        url,
        mode: "auto",
        formats,
        sync: true,
        timeout,
        advanced: {
          render_js,
          use_proxy,
          markdown: formats.includes("markdown"),
          scroll_to_load: false,
          scroll_count: 3,
          remove_cookie_banners: true,
          block_images: false,
        },
      });
      const costMicrocents = response.billing?.final_cost_microcents ?? 0;
      const costUsd = costMicrocents / 1_000_000;
      return {
        status: "fulfilled",
        url,
        text: formatScrapeResponse(response),
        cost: costUsd,
      };
    } catch (err) {
      const errorMsg =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "detail" in err
            ? String((err as { detail?: unknown }).detail ?? "unknown error")
            : "unknown error";
      return { status: "rejected", url, error: errorMsg };
    } finally {
      release();
    }
  }

  const outcomes = await Promise.all(urls.map((url) => scrapeOne(url)));

  // Build response
  const parts: string[] = [
    `**Batch Scrape Results** — ${urls.length} URL${urls.length !== 1 ? "s" : ""}`,
    "",
  ];

  let totalCost = 0;
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < outcomes.length; i++) {
    const outcome = outcomes[i];
    parts.push(`---\n## [${i + 1}/${urls.length}] ${outcome.url}`);
    if (outcome.status === "fulfilled") {
      successCount++;
      totalCost += outcome.cost;
      parts.push(outcome.text);
    } else {
      failCount++;
      parts.push(`**Error**: ${outcome.error}`);
    }
    parts.push("");
  }

  // Summary footer
  parts.push("---");
  parts.push(
    `**Summary**: ${successCount} succeeded, ${failCount} failed` +
      (totalCost > 0 ? ` | Total cost: $${totalCost.toFixed(6)}` : ""),
  );

  return {
    content: [{ type: "text", text: parts.join("\n") }],
  };
}
