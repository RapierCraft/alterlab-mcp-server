// Schema-parity tests: every request field in the AlterLab OpenAPI spec snapshot
// (spec/request-schemas.json) must be exposed by the matching MCP tool with the
// same enum values and bounds, or be listed below as intentionally omitted with
// a reason. Tool parameters that are not in the spec must be listed as tool-only.
// Each exposed field is also checked end to end: the handler must send the value
// at the spec's location in the request body.
//
// Refresh the snapshot with:  node scripts/refresh-spec-snapshot.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { scrapeSchema, handleScrape } from "../dist/tools/scrape.js";
import { estimateSchema, handleEstimate } from "../dist/tools/estimate.js";
import { screenshotSchema, handleScreenshot } from "../dist/tools/screenshot.js";
import { extractSchema, handleExtract } from "../dist/tools/extract.js";
import { batchSchema, batchItemSchema, handleBatch } from "../dist/tools/batch.js";
import { mapSchema, handleMap } from "../dist/tools/map.js";
import { crawlSchema, handleCrawl } from "../dist/tools/crawl.js";
import { searchSchema, handleSearch } from "../dist/tools/search.js";
import {
  createSessionSchema,
  updateSessionSchema,
  refreshSessionSchema,
  handleCreateSession,
  handleUpdateSession,
  handleRefreshSession,
} from "../dist/tools/sessions.js";

const snapshot = JSON.parse(
  readFileSync(new URL("../spec/request-schemas.json", import.meta.url), "utf8"),
);

// ---------------------------------------------------------------------------
// Spec helpers
// ---------------------------------------------------------------------------

/** Collapse `anyOf: [X, null]` to X. */
function norm(s) {
  if (!s) return s;
  if (s.anyOf) {
    const rest = s.anyOf.filter((x) => x.type !== "null");
    if (rest.length === 1) return norm({ ...s, ...rest[0], anyOf: undefined });
    return { ...s, anyOf: rest };
  }
  return s;
}

/** Flatten a spec object schema to leaf paths; nested objects with `properties` are expanded. */
function specLeaves(schema, prefix = "") {
  const out = [];
  for (const [k, raw] of Object.entries(schema.properties ?? {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    const s = norm(raw);
    if (s.type === "object" && s.properties) out.push(...specLeaves(s, p));
    else out.push({ path: p, schema: s });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Zod helpers (zod v3 internals)
// ---------------------------------------------------------------------------

function unwrap(z) {
  while (z && ["ZodOptional", "ZodNullable", "ZodDefault", "ZodEffects"].includes(z._def.typeName)) {
    z = z._def.innerType ?? z._def.schema;
  }
  return z;
}
const kind = (z) => unwrap(z)._def.typeName;

function toolTree(zobj) {
  return unwrap(zobj)._def.shape();
}

/** Resolve a dotted path through nested zod objects. */
function toolLookup(shape, path) {
  const parts = path.split(".");
  let cur = shape;
  let z;
  for (const part of parts) {
    if (!cur || !(part in cur)) return undefined;
    z = cur[part];
    const u = unwrap(z);
    cur = u._def.typeName === "ZodObject" ? u._def.shape() : undefined;
  }
  return z;
}

function check(z, key) {
  return (unwrap(z)._def.checks ?? []).find((c) => c.kind === key);
}

function enumValues(z) {
  const u = unwrap(z);
  if (u._def.typeName === "ZodEnum") return [...u._def.values];
  if (u._def.typeName === "ZodLiteral") return [u._def.value];
  if (u._def.typeName === "ZodUnion") return u._def.options.flatMap(enumValues);
  if (u._def.typeName === "ZodArray") return enumValues(u._def.type);
  return [];
}

/** Compare one tool field against its spec schema; returns a list of problems. */
function compareField(path, spec, z) {
  const problems = [];
  const u = unwrap(z);
  const tn = u._def.typeName;

  if (spec.enum) {
    const got = enumValues(z);
    if (JSON.stringify([...got].sort()) !== JSON.stringify([...spec.enum].sort())) {
      problems.push(`${path}: enum ${JSON.stringify(got)} != spec ${JSON.stringify(spec.enum)}`);
    }
  }
  if (spec.type === "array" && spec.items?.enum) {
    const got = enumValues(z);
    if (JSON.stringify([...got].sort()) !== JSON.stringify([...spec.items.enum].sort())) {
      problems.push(`${path}: item enum ${JSON.stringify(got)} != spec ${JSON.stringify(spec.items.enum)}`);
    }
  }
  if (spec.type === "integer" || spec.type === "number") {
    if (tn !== "ZodNumber") problems.push(`${path}: spec ${spec.type} but tool is ${tn}`);
    else {
      if (spec.type === "integer" && !check(z, "int")) problems.push(`${path}: spec integer but tool is not .int()`);
      for (const [specKey, zodKind] of [["minimum", "min"], ["maximum", "max"]]) {
        if (spec[specKey] !== undefined) {
          const c = check(z, zodKind);
          if (!c || c.value !== spec[specKey]) {
            problems.push(`${path}: ${specKey} ${c?.value} != spec ${spec[specKey]}`);
          }
        }
      }
    }
  }
  if (spec.type === "string" && !spec.enum) {
    // A tool may narrow a free-form spec string to an enum (e.g. wait_until).
    if (!["ZodString", "ZodEnum", "ZodLiteral"].includes(tn)) problems.push(`${path}: spec string but tool is ${tn}`);
    else if (tn === "ZodString" && spec.maxLength !== undefined) {
      const c = check(z, "max") ?? check(z, "length");
      if (!c || c.value !== spec.maxLength) {
        problems.push(`${path}: maxLength ${c?.value} != spec ${spec.maxLength}`);
      }
    }
  }
  if (spec.type === "boolean" && tn !== "ZodBoolean") problems.push(`${path}: spec boolean but tool is ${tn}`);
  if (spec.type === "array" && tn !== "ZodArray") problems.push(`${path}: spec array but tool is ${tn}`);
  if (spec.type === "array" && spec.maxItems !== undefined && tn === "ZodArray") {
    const mx = u._def.maxLength?.value;
    if (mx !== spec.maxItems) problems.push(`${path}: maxItems ${mx} != spec ${spec.maxItems}`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Value generation + fake client for pass-through checks
// ---------------------------------------------------------------------------

function sample(z) {
  const u = unwrap(z);
  switch (u._def.typeName) {
    case "ZodString": {
      if (check(z, "uuid")) return "123e4567-e89b-42d3-a456-426614174000";
      if (check(z, "url")) return "https://example.com/page";
      const len = check(z, "length");
      if (len) return "US".padEnd(len.value, "S");
      const min = check(z, "min")?.value ?? 1;
      const max = check(z, "max")?.value ?? Infinity;
      return "example.com".padEnd(Math.max(min, 1), "x").slice(0, Math.min(max, 64));
    }
    case "ZodNumber": {
      const c = check(z, "min");
      if (!c) return 1;
      return c.inclusive === false ? c.value + 1 : c.value;
    }
    case "ZodBoolean":
      return true;
    case "ZodEnum":
      return u._def.values[0];
    case "ZodLiteral":
      return u._def.value;
    case "ZodArray":
      return [sample(u._def.type)];
    case "ZodObject":
      return Object.fromEntries(Object.entries(u._def.shape()).map(([k, v]) => [k, sample(v)]));
    case "ZodRecord":
      return { key: sample(u._def.valueType) };
    case "ZodUnion":
      return sample(u._def.options[0]);
    case "ZodDiscriminatedUnion":
      return sample(u._def.options[0]);
    case "ZodUnknown":
    case "ZodAny":
      return "v";
    default:
      throw new Error(`No sample for ${u._def.typeName}`);
  }
}

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function fakeClient(sink) {
  const record = (name) => async (...args) => {
    sink.push({ name, args });
    throw new Error("fake client: stop after capture");
  };
  return {
    getLastBalanceWarning: () => null,
    scrape: record("scrape"),
    estimate: record("estimate"),
    extract: record("extract"),
    submitBatch: record("submitBatch"),
    map: record("map"),
    startCrawl: record("startCrawl"),
    search: record("search"),
    createSession: record("createSession"),
    updateSession: record("updateSession"),
    refreshSession: record("refreshSession"),
  };
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

const ENCRYPTION_OMIT = {
  encryption_mode: "client-side (zero-knowledge) encryption needs the account RSA public key and local AES wrapping; the MCP server only supports server-side encryption",
  encrypted_cookies: "client-side encryption payload, see encryption_mode",
  wrapped_key: "client-side encryption payload, see encryption_mode",
  cookie_names: "client-side encryption payload, see encryption_mode",
  key_version: "client-side encryption payload, see encryption_mode",
};

const cases = [
  {
    name: "alterlab_scrape",
    endpoint: "POST /api/v1/scrape",
    schema: scrapeSchema,
    handler: handleScrape,
    call: "scrape",
    flatten: ["advanced"],
    map: {
      "advanced.screenshot": "screenshot",
      "cost_controls.prefer_cost": "cost_controls.prefer_cost",
    },
    omit: {
      source: "tracking tag set by the dashboard playground; MCP traffic is identified by the X-AlterLab-Source header",
      sync: "the tool always sends sync=true and renders 202 downgrades with a job_id (see alterlab_get_job)",
      webhook_url: "webhooks need a public receiver and the tool is synchronous; use alterlab_batch or alterlab_crawl webhooks for async delivery",
      "advanced.markdown": "derived: sent as true whenever formats includes 'markdown'",
    },
    noSample: ["estimate_first", "template"],
    toolOnly: {
      estimate_first: "client-side: runs POST /scrape/estimate first",
      template: "deprecated alias, sent as extraction_template",
      prefer_cost: "shorthand merged into cost_controls.prefer_cost",
      prefer_speed: "shorthand merged into cost_controls.prefer_speed",
      fail_fast: "shorthand merged into cost_controls.fail_fast",
    },
  },
  {
    name: "alterlab_estimate_cost",
    endpoint: "POST /api/v1/scrape/estimate",
    schema: estimateSchema,
    handler: handleEstimate,
    call: "estimate",
    flatten: ["advanced"],
    omitRest:
      "the estimate endpoint prices from url, mode, method, formats and the cost-bearing add-ons only; " +
      "other scrape fields do not change the estimate",
    mustExpose: ["url", "mode", "method", "formats", "advanced.render_js", "advanced.use_proxy", "advanced.use_own_proxy", "screenshot", "advanced.screenshot", "advanced.generate_pdf", "advanced.ocr"],
    map: { "advanced.screenshot": "screenshot" },
    omit: { screenshot: "covered by advanced.screenshot mapping" },
  },
  {
    name: "alterlab_screenshot",
    endpoint: "POST /api/v1/scrape",
    schema: screenshotSchema,
    handler: handleScreenshot,
    call: "scrape",
    flatten: ["advanced"],
    omitRest:
      "alterlab_screenshot is a thin wrapper that forces mode=js, render_js and screenshot; " +
      "use alterlab_scrape with screenshot=true for the full option set",
    mustExpose: ["url", "wait_for", "wait_until", "timeout", "location.country", "location.language", "advanced.use_proxy", "advanced.proxy_country", "advanced.session_id", "advanced.cookies"],
    fixedByTool: ["mode", "screenshot", "sync", "advanced.render_js", "advanced.screenshot"],
  },
  {
    name: "alterlab_extract",
    endpoint: "POST /api/v1/extract",
    schema: extractSchema,
    handler: handleExtract,
    call: "extract",
  },
  {
    name: "alterlab_map",
    endpoint: "POST /api/v1/map",
    schema: mapSchema,
    handler: handleMap,
    call: "map",
  },
  {
    name: "alterlab_search",
    endpoint: "POST /api/v1/search",
    schema: searchSchema,
    handler: handleSearch,
    call: "search",
    omit: {
      tenant_id: "internal B2B routing field; not valid for API-key callers",
      session_pool_id: "internal B2B session-pool routing field",
    },
  },
  {
    name: "alterlab_crawl",
    endpoint: "POST /api/v1/crawl",
    schema: crawlSchema,
    handler: handleCrawl,
    call: "startCrawl",
    flatten: ["advanced"],
    omit: {
      output: "S3/GCS/webhook-stream sinks need cloud credentials or signing secrets; keep those out of chat transcripts and configure storage via the dashboard",
      "advanced.max_concurrency": "duplicate of top-level max_concurrency, which takes precedence server-side",
    },
  },
  {
    name: "alterlab_batch (batch level)",
    endpoint: "POST /api/v1/batch",
    schema: batchSchema,
    handler: handleBatch,
    call: "submitBatch",
    prepare: (params) => ({ ...params, urls: [{ url: "https://example.com/a" }] }),
    omit: {},
    toolOnly: {},
    ownedPaths: ["urls"],
    mapSpecRoot: (s) => ({ ...s, properties: Object.fromEntries(Object.entries(s.properties).filter(([k]) => k !== "urls")) }),
    toolRoot: (shape) => Object.fromEntries(Object.entries(shape).filter(([k]) => k !== "urls")),
  },
  {
    name: "alterlab_batch (per URL)",
    endpoint: "POST /api/v1/batch",
    specNode: (s) => norm(s.properties.urls).items,
    schema: batchItemSchema,
    handler: handleBatch,
    call: "submitBatch",
    bodyPrefix: "urls.0",
    prepare: (params) => ({ urls: [params] }),
    flatten: [],
    toolOnly: {
      render_js: "shortcut for advanced.render_js (backward compatible)",
      use_proxy: "shortcut for advanced.use_proxy (backward compatible)",
    },
  },
  {
    name: "alterlab_create_session",
    endpoint: "POST /api/v1/sessions",
    schema: createSessionSchema,
    handler: handleCreateSession,
    call: "createSession",
    omit: ENCRYPTION_OMIT,
  },
  {
    name: "alterlab_update_session",
    endpoint: "PATCH /api/v1/sessions/{session_id}",
    schema: updateSessionSchema,
    handler: handleUpdateSession,
    call: "updateSession",
    toolOnly: { session_id: "path parameter" },
    argIndex: 1,
  },
  {
    name: "alterlab_refresh_session",
    endpoint: "POST /api/v1/sessions/{session_id}/refresh",
    schema: refreshSessionSchema,
    handler: handleRefreshSession,
    call: "refreshSession",
    omit: ENCRYPTION_OMIT,
    toolOnly: { session_id: "path parameter" },
    argIndex: 1,
  },
];

for (const c of cases) {
  test(`schema parity: ${c.name}`, async () => {
    let specRoot = snapshot.endpoints[c.endpoint];
    assert.ok(specRoot, `snapshot is missing ${c.endpoint}; run scripts/refresh-spec-snapshot.mjs`);
    if (c.specNode) specRoot = c.specNode(specRoot);
    if (c.mapSpecRoot) specRoot = c.mapSpecRoot(specRoot);

    let shape = toolTree(c.schema);
    if (c.toolRoot) shape = c.toolRoot(shape);

    const flatten = c.flatten ?? [];
    const omit = c.omit ?? {};
    const toolOnly = c.toolOnly ?? {};
    const mapping = c.map ?? {};
    const leaves = specLeaves(specRoot);
    const problems = [];
    const consumed = new Set();
    /** @type {{specPath:string, toolPath:string}[]} */
    const exposed = [];

    for (const { path, schema } of leaves) {
      if (path in omit) {
        assert.ok(String(omit[path]).length > 10, `omit reason for ${path} must explain why`);
        continue;
      }
      let toolPath = mapping[path];
      let z = toolPath ? toolLookup(shape, toolPath) : undefined;
      if (!z) {
        toolPath = undefined;
        const candidates = [path];
        for (const f of flatten) if (path.startsWith(`${f}.`)) candidates.push(path.slice(f.length + 1));
        for (const cand of candidates) {
          const hit = toolLookup(shape, cand);
          if (hit) {
            toolPath = cand;
            z = hit;
            break;
          }
        }
      }
      if (!z) {
        if (c.omitRest && !(c.mustExpose ?? []).includes(path)) continue;
        problems.push(`spec field ${path} is not exposed by the tool (add it, or list it in omit with a reason)`);
        continue;
      }
      consumed.add(toolPath.split(".")[0]);
      consumed.add(toolPath);
      if (!(c.fixedByTool ?? []).includes(path)) exposed.push({ specPath: path, toolPath });
      problems.push(...compareField(path, schema, z));
    }

    for (const owned of c.ownedPaths ?? []) consumed.add(owned);

    // Tool params that map to nothing in the spec.
    for (const key of Object.keys(shape)) {
      if (consumed.has(key)) continue;
      // A nested tool object is fine if any of its children were consumed.
      if ([...consumed].some((p) => p.startsWith(`${key}.`))) continue;
      if (key in toolOnly) continue;
      problems.push(`tool parameter ${key} has no counterpart in the spec (remove it, or list it in toolOnly with a reason)`);
    }
    for (const key of Object.keys(toolOnly)) {
      if (!(key in shape)) problems.push(`toolOnly lists ${key} but the tool no longer has it`);
    }
    for (const key of c.mustExpose ?? []) {
      if (!leaves.some((l) => l.path === key) && !leaves.some((l) => l.path.startsWith(`${key}.`))) {
        problems.push(`mustExpose lists ${key} which is not in the spec`);
      }
    }

    // Action types accepted by `actions` must match the spec's action union.
    if (shape.actions) {
      const specActions = norm(getPath(snapshot.endpoints["POST /api/v1/scrape"], "properties.advanced.properties.actions"));
      const specTypes = (specActions.items.oneOf ?? []).map((o) => o.properties.type.const).sort();
      const toolTypes = [...unwrap(unwrap(shape.actions)._def.type)._def.optionsMap.keys()].sort();
      if (JSON.stringify(specTypes) !== JSON.stringify(toolTypes)) {
        problems.push(`actions: tool types ${toolTypes} != spec ${specTypes}`);
      }
    }

    assert.deepEqual(problems, [], `\n  ${problems.join("\n  ")}`);

    // End-to-end: each exposed field must reach the request body at the spec location.
    const sink = [];
    const toolParams = {};
    for (const [k, z] of Object.entries(shape)) {
      if ((c.noSample ?? []).includes(k)) continue;
      toolParams[k] = sample(z);
    }
    const input = c.prepare ? c.prepare(toolParams) : toolParams;
    const parsed = c.schema.safeParse(c.bodyPrefix ? input.urls[0] : c.prepare ? { ...input } : input);
    assert.ok(parsed.success, `sample params failed zod validation: ${JSON.stringify(parsed.error?.issues)}`);
    await c.handler(fakeClient(sink), input);
    const call = sink.find((s) => s.name === c.call);
    assert.ok(call, `handler did not call client.${c.call}`);
    const body = call.args[c.argIndex ?? 0];
    const prefix = c.bodyPrefix ? `${c.bodyPrefix}.` : "";
    const lost = [];
    for (const { specPath, toolPath } of exposed) {
      const expected = getPath(parsed.data, toolPath);
      const actual = getPath(body, prefix + specPath);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        lost.push(`${specPath}: sent ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)} (from tool param ${toolPath})`);
      }
    }
    assert.deepEqual(lost, [], `\n  ${lost.join("\n  ")}`);
  });
}

test("snapshot covers every endpoint the client calls", () => {
  const client = readFileSync(new URL("../src/client.ts", import.meta.url), "utf8");
  const used = new Set();
  for (const m of client.matchAll(/["`](\/api\/v1\/[^"`]*)["`]/g)) {
    used.add(m[1].replace(/\$\{[^}]+\}/g, "{x}").replace(/\/$/, ""));
  }
  const known = [...Object.keys(snapshot.endpoints), ...snapshot.present_only].map((k) =>
    k.split(" ")[1].replace(/\{[^}]+\}/g, "{x}"),
  );
  for (const path of used) {
    assert.ok(known.includes(path), `client calls ${path} which the snapshot does not list (add it to scripts/refresh-spec-snapshot.mjs)`);
  }
});

test("deprecated scrape `template` is sent as extraction_template", async () => {
  const sink = [];
  await handleScrape(fakeClient(sink), scrapeSchema.parse({ url: "https://example.com", template: "product" }));
  assert.equal(sink[0].args[0].extraction_template, "product");
  sink.length = 0;
  await handleScrape(
    fakeClient(sink),
    scrapeSchema.parse({ url: "https://example.com", template: "product", extraction_template: "article" }),
  );
  assert.equal(sink[0].args[0].extraction_template, "article");
});

test("scrape prefer_* shorthands merge into cost_controls, explicit cost_controls win", async () => {
  const sink = [];
  await handleScrape(
    fakeClient(sink),
    scrapeSchema.parse({
      url: "https://example.com",
      prefer_cost: true,
      fail_fast: true,
      cost_controls: { fail_fast: false, max_tier: "3" },
    }),
  );
  assert.deepEqual(sink[0].args[0].cost_controls, { prefer_cost: true, fail_fast: false, max_tier: "3" });
});

test("scrape session_id and cookies travel inside advanced (top-level copies are ignored by the API)", async () => {
  const sink = [];
  await handleScrape(
    fakeClient(sink),
    scrapeSchema.parse({
      url: "https://example.com",
      session_id: "123e4567-e89b-42d3-a456-426614174000",
      cookies: { a: "b" },
    }),
  );
  const body = sink[0].args[0];
  assert.equal(body.advanced.session_id, "123e4567-e89b-42d3-a456-426614174000");
  assert.deepEqual(body.advanced.cookies, { a: "b" });
  assert.equal(body.session_id, undefined);
  assert.equal(body.cookies, undefined);
});

test("optional parameters left unset are not sent (API defaults apply)", async () => {
  const sink = [];
  await handleScrape(fakeClient(sink), scrapeSchema.parse({ url: "https://example.com" }));
  const body = sink[0].args[0];
  for (const key of ["cache", "evidence", "location", "cost_controls", "embeddings", "headers"]) {
    assert.equal(key in body, false, `${key} must be omitted when unset`);
  }
  assert.deepEqual(body.advanced, { markdown: true });
});

test("version is identical in package.json, server.json, client and server banner", () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const pkg = JSON.parse(read("../package.json")).version;
  const server = JSON.parse(read("../server.json"));
  assert.equal(server.version, pkg);
  assert.equal(server.packages[0].version, pkg);
  assert.match(read("../src/client.ts"), new RegExp(`const VERSION = "${pkg.replace(/\./g, "\\.")}"`));
  assert.match(read("../src/index.ts"), new RegExp(`version: "${pkg.replace(/\./g, "\\.")}"`));
});
