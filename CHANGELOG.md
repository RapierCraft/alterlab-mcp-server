# Changelog

## 1.10.0

Remote mode with OAuth (#463). Local API-key behaviour is unchanged.

### Added
- Remote mode: `--remote [url]` or `ALTERLAB_MCP_URL` bridges stdio MCP to the hosted Streamable HTTP endpoint
  (`https://mcp.alterlab.io/mcp` by default) instead of calling the REST API. JSON and SSE responses are relayed,
  the `Mcp-Session-Id` and `MCP-Protocol-Version` headers are managed, and a session the server drops (404) is
  re-initialized transparently. `tools/list` is answered by the hosted server, so no tool schemas are declared in this mode.
- OAuth sign-in when no API key is present: RFC 9728 discovery from the 401 `resource_metadata`, RFC 8414
  authorization server metadata, RFC 7591 registration as a native public client, PKCE S256 authorization through the
  system browser with a loopback listener on `127.0.0.1` (random port), RFC 8707 resource binding, automatic
  refresh (before expiry and on a server 401, safe against concurrent clients), and RFC 7009 revocation.
- `--login` and `--logout` (with `--remote`) to sign in ahead of time or revoke the grant and delete local tokens.
- Token storage in `~/.alterlab/oauth.json` (`ALTERLAB_CONFIG_DIR` overrides the directory): directory `0700`,
  file `0600`, atomic replace. Tokens, codes and PKCE verifiers are never logged.
- `ALTERLAB_API_KEY` (or the saved key) with `--remote` sends the key as the bearer token, skipping OAuth.
- `src/shared/tool-definitions.json`: copy of the platform's shared tool source (synced by AlterLab's
  ecosystem-sync workflow) and a drift test that fails if the shared source gains a tool or parameter this package lacks.

### Notes
- Local mode keeps its own tool schemas. The shared source currently covers 9 tools and a subset of each tool's
  parameters, while this package exposes 26 tools and the full request schemas guarded by the schema-parity test (#616).
  Generating the local tools from the shared source would remove tools and parameters, so it is deferred until the shared
  source reaches parity (follow-up: grow `shared/mcp_tools/tool_definitions.json`, then generate the local schemas from it).
- `alterlab_crawl.block_images` is in the shared source but is rejected by the API for crawls (removed locally in 1.9.0);
  the drift test lists it as a known divergence.

## 1.9.0

Consolidated tool schemas to parity with the current AlterLab API (#615). Supersedes the stale
`ecosystem-sync` PRs and `sync` issues (#385-#613).

### Added
- `alterlab_scrape`: `headers`, `extraction_template`, `sync_policy`, `wait_until`, `screenshot`, `enable_scroll`, `pdf_format`, `ocr_language`, `embeddings`, and the full `advanced` set as flat parameters: `generate_pdf`, `ocr`, `use_own_proxy`, `use_system_proxy`, `proxy_integration_id`, `wait_condition`, `include_iframes`, `flatten_shadow_dom`, `skip_tls_verification`, `section_filter`, `session_headers`, `sticky_session`, `sticky_session_ttl`, `actions`.
- `alterlab_batch`: batch-level `session_id`, `export`, `extraction_schema`, `extraction_prompt`, `extraction_provider`, `extraction_profile`; per URL `method`, `body`, `content_type`, `advanced` (full set), `location`, `cost_controls`, `extraction_prompt`, `extraction_provider`, `extraction_profile`, `extraction_template`, `include_raw_html`; `formats` now accepts `content` and `raw`.
- `alterlab_crawl`: `budget`, `priority`, `extraction`, `extraction_template`, `extraction_provider`, `change_tracking`, `webhook`, `storage`, `cache`, `cache_ttl`, `force_refresh`, `screenshot`, `delay`, `depth_strategy`; `extraction_profile` and `formats` enums widened.
- `alterlab_search`: `engine` (duckduckgo/google/bing); `formats` accepts `content`.
- `alterlab_create_session`: `consent`, `headers`, `expires_at`, `notes`, `auto_refresh_enabled`, `notify_before_expiry`, `notify_on_failure`, `organization_id`, `shared`; cookies may be cookie objects. `alterlab_update_session` gains the notification/auto-refresh flags.
- `alterlab_screenshot`: `timeout`, `use_proxy`, `proxy_country`, `session_id`, `cookies`, `location`. `alterlab_estimate_cost`: `method`, `use_own_proxy`, `screenshot`, `generate_pdf`, `ocr`, `render_js="auto"`.
- New tool `alterlab_get_job` and 202 handling: a scrape that outlives the synchronous window now reports its `job_id` instead of failing.
- `screenshot_url`, `pdf_url`, `ocr_results`, captured cookie names and `job_id` are shown in scrape output.
- Schema-parity test (`npm test`) against `spec/request-schemas.json`; refresh with `npm run update-spec-snapshot`.

### Fixed
- `alterlab_create_session` always failed with `CONSENT_REQUIRED`; the required `consent` field is now sent. `user_agent` (not accepted by the API) is removed; pass a User-Agent via `headers`.
- `alterlab_scrape` sent `session_id`, `cookies`, `prefer_cost`, `prefer_speed`, `fail_fast` and `template` at the top level where the API ignores them. They now go to `advanced.*`, `cost_controls.*` and `extraction_template`.
- `alterlab_get_usage` called a non-existent endpoint; it now uses `GET /api/v1/usage` and reports balance, credits used this period and tier.
- Sessions list/create no longer use a trailing slash (avoided a redirect).
- Crawl: removed `block_images` (not accepted by crawl `advanced`).
- Bounds aligned with the API: URL max length 2083, `include/exclude_patterns` max 50 items, `sitemap_path` max 500, `extract.content` max 500,000, `extraction_model` max 256, integer `timeout`/`cache_ttl`.
- Pricing text: tier prices (T1 $0.0002, T2 $0.0003, T3 $0.002, T3.5 $0.0025, T4 $0.004, T5 $0.02), add-ons, POST 1.5x, BYOP 20% discount, search $0.001 (duckduckgo) / $0.004 (google, bing). README tables corrected.
- Version strings in the client User-Agent and server banner now track package.json.

### Behaviour changes
- Optional scrape/crawl/estimate parameters are omitted when unset instead of being sent with local defaults (`render_js`, `use_proxy`, `scroll_to_load`, `remove_cookie_banners`, `block_images`, `max_response_bytes`, `scroll_count`), so API defaults apply.
