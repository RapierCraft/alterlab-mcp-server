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
      "ecommerce_homepage",
      "directory_listing",
    ])
    .optional()
    .describe(
      "Pre-defined extraction profile. 'product' extracts price/title/reviews, " +
        "'article' extracts title/author/body, etc. 'auto' detects the page type. " +
        "Mutually exclusive with extraction_template.",
    ),
  extraction_template: z
    .enum([
      "auto",
      "product",
      "article",
      "job_posting",
      "faq",
      "recipe",
      "event",
      "ecommerce_homepage",
      "directory_listing",
    ])
    .optional()
    .describe(
      "Shorthand alias for extraction_profile — selects the same pre-built schema template. " +
        "Mutually exclusive with extraction_profile.",
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
  extraction_model: z
    .string()
    .nullish()
    .describe(
      "Per-request LLM model override in provider-specific format (e.g. 'gpt-4o', 'claude-opus-4-5-20251101', 'llama3-70b-8192'). " +
        "Overrides the model saved in your BYOK key settings for this request only.",
    ),
  extraction_provider: z
    .enum(["openai", "anthropic", "openrouter", "groq"])
    .optional()
    .describe(
      "LLM provider to use for extraction. Selects the matching BYOK key registered at " +
        "/dashboard/settings/llm-keys. When omitted, the most recently used registered key is used.",
    ),
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
    .default(["json"])
    .describe(
      "Output formats for content transformation. 'json' is best for structured extraction. " +
        "'content' returns filtered/cleaned content. " +
        "'raw' returns the unprocessed response body.",
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
  cache: z
    .enum(["auto", "skip", "only"])
    .default("auto")
    .describe(
      "Cache control for LLM extraction results. " +
        "'auto': return cached result if available (default). " +
        "'skip': bypass cache lookup, always call LLM (result is still stored). " +
        "'only': return cached result or 404 if not cached — never calls the LLM.",
    ),
  cache_ttl: z
    .number()
    .int()
    .min(1)
    .max(86400)
    .optional()
    .describe(
      "TTL for caching this extraction result, in seconds. " +
        "Defaults to server setting (3600s). Max 86400s (24 hours).",
    ),
});

export const extractDescription =
  "Extract structured data from raw HTML, text, or markdown content WITHOUT scraping. " +
  "Bring your own pre-fetched content. Use this when you already have the page content " +
  "and want to run AlterLab's extraction pipeline on it. " +
  "For scraping + extraction in one step, use alterlab_scrape with formats=['json'] instead. " +
  "Profiles: 'product' (price, title, reviews), 'article' (title, author, body), " +
  "'job_posting', 'faq', 'recipe', 'event', 'ecommerce_homepage', 'directory_listing'. " +
  "Returns JSON data. Use extraction_prompt for natural language extraction (LLM-powered). " +
  "Use cache='only' to retrieve a previously cached result without calling the LLM.";

export async function handleExtract(
  client: AlterLabClient,
  params: z.infer<typeof extractSchema>,
): Promise<CallToolResult> {
  try {
    const response = await client.extract({
      content: params.content,
      content_type: params.content_type,
      extraction_profile: params.extraction_profile,
      extraction_template: params.extraction_template,
      extraction_schema: params.extraction_schema,
      extraction_prompt: params.extraction_prompt,
      extraction_model: params.extraction_model ?? undefined,
      extraction_provider: params.extraction_provider,
      formats: params.formats,
      source_url: params.source_url,
      evidence: params.evidence,
      cache: params.cache,
      cache_ttl: params.cache_ttl,
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
  const cacheHit = Boolean(r.cache_hit);
  const extractionMetadata = r.extraction_metadata as
    | Record<string, unknown>
    | undefined;

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

  // Build footer with cache + model info from extraction_metadata when available
  const provider = extractionMetadata?.provider ?? null;
  const modelFromMeta = extractionMetadata?.model
    ? String(extractionMetadata.model)
    : null;
  const effectiveModel = modelFromMeta ?? modelUsed;

  const footerParts: string[] = [
    `Extract ID: \`${extractId}\``,
    `Method: ${extractionMethod}${effectiveModel ? ` (${effectiveModel})` : ""}`,
  ];

  if (cacheHit) {
    footerParts.push("Cache: hit");
  } else if (provider) {
    footerParts.push(`Provider: ${provider}`);
  }

  footerParts.push(`Credits: ${creditsUsed}`);

  parts.push("\n---\n" + footerParts.join(" | "));

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
