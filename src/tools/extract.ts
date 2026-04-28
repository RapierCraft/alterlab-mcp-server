import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AlterLabClient } from "../client.js";
import { type ApiError, formatErrorResult } from "../errors.js";

export const extractSchema = z.object({
  content: z
    .string()
    .min(1)
    .describe(
      "Raw content to extract from — HTML, text, or markdown. " +
        "Bring your own pre-fetched content; this endpoint does NOT scrape a URL.",
    ),
  content_type: z
    .enum(["html", "text", "markdown"])
    .default("html")
    .describe("Type of the provided content"),
  extraction_profile: z
    .enum([
      "auto",
      "product",
      "article",
      "job_posting",
      "faq",
      "recipe",
      "event",
    ])
    .optional()
    .describe(
      "Pre-defined extraction profile. 'product' extracts price/title/reviews, " +
        "'article' extracts title/author/body, etc. 'auto' detects the page type",
    ),
  extraction_schema: z
    .record(z.unknown())
    .optional()
    .describe(
      "Custom JSON Schema for extraction. Fields are mapped from content. " +
        "Overrides extraction_profile when provided",
    ),
  extraction_prompt: z
    .string()
    .max(2000)
    .optional()
    .describe(
      "Natural language instructions for LLM extraction (e.g., 'Extract all product prices and ratings'). " +
        "Charged at LLM extraction rate when provided.",
    ),
  formats: z
    .array(z.enum(["text", "json", "json_v2", "html", "markdown", "rag"]))
    .default(["json"])
    .describe(
      "Output formats for content transformation. 'json' is best for structured extraction.",
    ),
  source_url: z
    .string()
    .max(2048)
    .optional()
    .describe(
      "Original URL of the content (for context only — not fetched). " +
        "Helps the extractor understand the content's domain.",
    ),
  evidence: z
    .boolean()
    .default(false)
    .describe(
      "Include field provenance/evidence for extracted fields (which part of the content each field came from)",
    ),
});

export const extractDescription =
  "Extract structured data from raw HTML, text, or markdown content WITHOUT scraping. " +
  "Bring your own pre-fetched content. Use this when you already have the page content " +
  "and want to run AlterLab's extraction pipeline on it. " +
  "For scraping + extraction in one step, use alterlab_scrape with formats=['json'] instead. " +
  "Profiles: 'product' (price, title, reviews), 'article' (title, author, body), " +
  "'job_posting', 'faq', 'recipe', 'event'. " +
  "Returns JSON data. Use extraction_prompt for natural language extraction (LLM-powered).";

export async function handleExtract(
  client: AlterLabClient,
  params: z.infer<typeof extractSchema>,
): Promise<CallToolResult> {
  try {
    const response = await client.extract({
      content: params.content,
      content_type: params.content_type,
      extraction_profile: params.extraction_profile,
      extraction_schema: params.extraction_schema,
      extraction_prompt: params.extraction_prompt,
      formats: params.formats,
      source_url: params.source_url,
      evidence: params.evidence,
    });

    const text = formatStandaloneExtractResponse(response, params.source_url);
    return { content: [{ type: "text", text }] };
  } catch (error) {
    if (isApiError(error)) {
      return formatErrorResult(error, {
        url: params.source_url ?? "raw content",
      });
    }
    return formatErrorResult(error as Error, {
      url: params.source_url ?? "raw content",
    });
  }
}

function formatStandaloneExtractResponse(
  response: unknown,
  sourceUrl?: string,
): string {
  const r = response as Record<string, unknown>;
  const extractId = String(r.extract_id ?? "");
  const creditsUsed = Number(r.credits_used ?? 0);
  const extractionMethod = String(r.extraction_method ?? "algorithmic");
  const modelUsed = r.model_used ? String(r.model_used) : null;
  const formats = r.formats as Record<string, unknown> | undefined;

  const parts: string[] = [];

  if (sourceUrl) {
    parts.push(`# Extracted: ${sourceUrl}\n`);
  } else {
    parts.push(`# Extraction Result\n`);
  }

  if (formats) {
    // Prefer json output, then fall through to other formats
    const jsonData = formats.json || formats.json_v2;
    const markdown = formats.markdown as string | undefined;
    const text = formats.text as string | undefined;

    if (jsonData) {
      parts.push(
        "```json\n" +
          (typeof jsonData === "string"
            ? jsonData
            : JSON.stringify(jsonData, null, 2)) +
          "\n```",
      );
    } else if (markdown) {
      parts.push(markdown);
    } else if (text) {
      parts.push(text);
    } else {
      parts.push("```json\n" + JSON.stringify(formats, null, 2) + "\n```");
    }
  }

  parts.push(
    "\n---\n" +
      `Extract ID: \`${extractId}\` | ` +
      `Method: ${extractionMethod}` +
      (modelUsed ? ` (${modelUsed})` : "") +
      ` | Credits: ${creditsUsed}`,
  );

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
