// Default-search behaviour (AlterLab #39513): plain calls run the unified search with
// content (engine auto, scrape_results true, agent preset, standard tier); an explicit
// engine or scrape_results=false opts out.
import { test } from "node:test";
import assert from "node:assert/strict";

import { searchSchema, handleSearch, buildSearchRequest } from "../dist/tools/search.js";

function body(params) {
  return buildSearchRequest(searchSchema.parse({ query: "q", ...params }));
}

test("plain search defaults to unified search with concise content", () => {
  const b = body({});
  assert.equal(b.engine, "auto");
  assert.equal(b.scrape_results, true);
  assert.equal(b.preset, "agent");
  assert.equal(b.mode, "standard");
});

test("scrape_results=false returns the unified result list only", () => {
  const b = body({ scrape_results: false });
  assert.equal(b.engine, "auto");
  assert.equal(b.scrape_results, false);
  assert.equal(b.preset, undefined);
  assert.equal(b.mode, undefined);
});

test("an explicit engine opts out of unified search and content", () => {
  for (const engine of ["duckduckgo", "google", "bing"]) {
    const b = body({ engine });
    assert.equal(b.engine, engine);
    assert.equal(b.scrape_results, false);
    assert.equal(b.preset, undefined);
    assert.equal(b.mode, undefined);
  }
});

test("explicit engine with scrape_results=true keeps legacy content request", () => {
  const b = body({ engine: "google", scrape_results: true });
  assert.equal(b.scrape_results, true);
  assert.equal(b.preset, undefined);
});

test("concise=false and explicit formats drop the agent preset; mode is honoured", () => {
  assert.equal(body({ concise: false }).preset, undefined);
  assert.equal(body({ formats: ["json"] }).preset, undefined);
  assert.equal(body({ mode: "deep" }).mode, "deep");
});

test("handler posts the unified default body", async () => {
  const sent = [];
  const client = { search: async (r) => (sent.push(r), { search_id: "s", results: [] }) };
  await handleSearch(client, searchSchema.parse({ query: "hello" }));
  assert.equal(sent[0].engine, "auto");
  assert.equal(sent[0].scrape_results, true);
});
