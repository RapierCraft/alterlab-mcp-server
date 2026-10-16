<p align="center">
  <img src="assets/logo.png" alt="AlterLab Logo" width="120" />
</p>

<h1 align="center">AlterLab MCP Server</h1>

<p align="center">
  <strong>Give Claude, Cursor, and Windsurf the ability to scrape any website, extract structured data, and take screenshots — with automatic anti-bot bypass.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/alterlab-mcp-server"><img src="https://img.shields.io/npm/v/alterlab-mcp-server.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/alterlab-mcp-server"><img src="https://img.shields.io/npm/dm/alterlab-mcp-server.svg" alt="npm downloads" /></a>
  <a href="https://github.com/RapierCraft/alterlab-mcp-server/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/alterlab-mcp-server.svg" alt="license" /></a>
  <a href="https://smithery.ai/server/alterlab-mcp-server"><img src="https://smithery.ai/badge/alterlab-mcp-server" alt="Smithery" /></a>
</p>

<p align="center">
  <a href="https://app.alterlab.io/signin?redirect=/dashboard/keys&source=mcp&utm_source=mcp&utm_medium=integration&utm_campaign=mcp_server"><strong>Get Started Free &rarr;</strong></a> &nbsp; $1 free balance on signup &mdash; up to 5,000 scrapes.
</p>

---

## One-Line Install

### Claude Code

```bash
claude mcp add alterlab -- npx -y alterlab-mcp-server@latest
```

Then set your API key: `export ALTERLAB_API_KEY=sk_live_...` or add it to `.claude.json` (see [full setup](#install-in-claude-desktop--claude-code) below).

### Cursor

```bash
# Add to .cursor/mcp.json — see full config below
```

### Smithery

```bash
npx -y @smithery/cli install alterlab-mcp-server --client claude
```

---

## Why AlterLab Instead of WebFetch or Browser MCP?

Claude's built-in `WebFetch` tool and open-source browser MCP servers fail on most real-world websites. They cannot bypass Cloudflare, render JavaScript SPAs, or extract structured data.

AlterLab replaces broken fetch tools with **one MCP server** that actually works:

| Capability | WebFetch / fetch() | Browser MCP | AlterLab MCP |
|---|---|---|---|
| Anti-bot bypass (Cloudflare, DataDome, Akamai) | No | Partial | Yes &mdash; automatic |
| JavaScript rendering (React, Angular, Vue SPAs) | No | Yes (slow) | Yes &mdash; headless Chromium |
| Structured data extraction (JSON, Schema.org) | No | No | Yes &mdash; built-in profiles |
| Smart tier escalation (cheapest method first) | N/A | N/A | Yes &mdash; saves 60-80% |
| Residential proxy rotation (195+ countries) | No | No | Yes |
| Screenshot and PDF capture | No | Screenshot only | Yes &mdash; both |
| OCR text extraction from images | No | No | Yes |
| Cost per request | Free (but fails) | Free (but slow) | From $0.0002 |

## How Does AlterLab Web Scraping Work?

AlterLab uses a multi-tier scraping architecture. It automatically selects the cheapest method capable of fetching each URL:

1. **Curl** ($0.0002/req) &mdash; Direct HTTP for static pages, RSS feeds, public APIs
2. **HTTP** ($0.0003/req) &mdash; TLS fingerprint rotation for moderately protected sites
3. **Stealth** ($0.002/req) &mdash; Browser impersonation for Cloudflare/DataDome-protected sites
4. **Light JS** ($0.0025/req) &mdash; Lightweight JS extraction from server-rendered HTML
5. **Browser** ($0.004/req) &mdash; Full headless Chromium for JavaScript-heavy SPAs

Auto mode starts at Tier 1 and escalates only when blocked. Most websites resolve at Tiers 1-2, so **$1 gets you 1,000 to 5,000 scrapes** depending on the sites you target.

---

## Installation

### Install in Claude Desktop / Claude Code

Add to your Claude config file (`~/.claude.json` for Claude Code, or Settings for Claude Desktop):

```json
{
  "mcpServers": {
    "alterlab": {
      "command": "npx",
      "args": ["-y", "alterlab-mcp-server@latest"],
      "env": {
        "ALTERLAB_API_KEY": "sk_live_your_key_here"
      }
    }
  }
}
```

### Install in Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "alterlab": {
      "command": "npx",
      "args": ["-y", "alterlab-mcp-server@latest"],
      "env": {
        "ALTERLAB_API_KEY": "sk_live_your_key_here"
      }
    }
  }
}
```

### Install in Windsurf

Add to Windsurf MCP settings (`~/.codeium/windsurf/mcp_config.json`):

```json
{
  "mcpServers": {
    "alterlab": {
      "command": "npx",
      "args": ["-y", "alterlab-mcp-server@latest"],
      "env": {
        "ALTERLAB_API_KEY": "sk_live_your_key_here"
      }
    }
  }
}
```

### Install via Smithery

```bash
npx -y @smithery/cli install alterlab-mcp-server --client claude
```

### Get Your API Key

1. [Sign up free](https://app.alterlab.io/signin?redirect=/dashboard/keys&source=mcp&utm_source=mcp&utm_medium=integration&utm_campaign=mcp_server) &mdash; $1 free balance on signup
2. Go to **Dashboard &rarr; API Keys** and copy your key
3. Paste it into the `ALTERLAB_API_KEY` field in your MCP config

---

## Tools

### `alterlab_scrape` &mdash; Scrape Any Webpage

Scrape a URL and return its content as markdown, text, HTML, or JSON. Automatically handles anti-bot protection with tier escalation. Returns markdown by default &mdash; optimized for LLM context windows.

```
"Scrape https://www.amazon.com/dp/B0BSHF7WHW and summarize the product"
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `url` | string | required | URL to scrape |
| `mode` | `auto` \| `html` \| `js` \| `pdf` \| `ocr` | `auto` | Scraping mode |
| `method` / `body` / `content_type` / `headers` | enum / string / enum / object | `GET` | POST support (1.5x cost) and custom target headers |
| `formats` | `(text\|json\|json_v2\|html\|markdown\|rag\|content\|raw)[]` | `["markdown"]` | Output formats |
| `extraction_schema` / `extraction_prompt` | object / string | &mdash; | LLM extraction (+$0.001) |
| `extraction_profile` / `extraction_template` | enum | &mdash; | `auto`, `product`, `article`, `job_posting`, `faq`, `recipe`, `event`, `ecommerce_homepage`, `directory_listing` (`template` is a deprecated alias) |
| `extraction_provider` / `extraction_model` | enum / string | &mdash; | BYOK LLM selection |
| `evidence`, `promote_schema_org`, `filter_content` | boolean | &mdash; | Extraction behaviour |
| `cache`, `cache_ttl`, `force_refresh` | boolean / number / boolean | &mdash; | Response caching (`cache_ttl` 60-86400) |
| `render_js` | boolean \| `"auto"` | API default | Headless browser (forces Browser tier, $0.004) |
| `use_proxy`, `proxy_country` | boolean, string | &mdash; | Premium proxy (+$0.0002) and geo-targeting |
| `use_own_proxy`, `use_system_proxy`, `proxy_integration_id` | boolean, boolean, string | &mdash; | Bring-your-own-proxy selection |
| `skip_tls_verification` | boolean | &mdash; | Omit (recommended) = verify, fall back on invalid certs; `true` skip, `false` require valid cert |
| `wait_for`, `wait_until`, `wait_condition` | string | &mdash; | Selector / load-event waits |
| `actions` | object[] (max 20) | &mdash; | Browser actions: `wait`, `wait_for`, `click`, `fill`, `press`, `scroll`, `infinite_scroll`, `screenshot`, `evaluate` |
| `screenshot`, `generate_pdf`, `ocr` | boolean | &mdash; | Add-ons (+$0.0002 / +$0.0004 / +$0.001) |
| `scroll_to_load`, `scroll_count`, `enable_scroll` | boolean / 1-10 / boolean | &mdash; | Lazy-load handling |
| `include_iframes`, `flatten_shadow_dom`, `block_images`, `remove_cookie_banners` | boolean | &mdash; | Rendering options |
| `section_filter` | object | &mdash; | Filter for `json_v2` sections |
| `session_id`, `cookies`, `session_headers` | UUID, object, object | &mdash; | Authenticated scraping |
| `sticky_session`, `sticky_session_ttl` | string, 300-7200 | &mdash; | Reuse cookies and exit IP across calls (paid plans) |
| `location` | `{country, language}` | &mdash; | Geo-targeting |
| `cost_controls` | object | &mdash; | `force_tier`, `max_tier`, `max_credits`, `prefer_cost`, `prefer_speed`, `fail_fast`, `time_budget` (`prefer_cost`, `prefer_speed`, `fail_fast` also accepted at top level) |
| `embeddings` | object | &mdash; | `enabled`, `model`, `chunk_size`, `chunk_overlap` (+$0.001/page) |
| `sync_policy` | `auto` \| `wait_until_deadline` | `auto` | Wait behaviour for long scrapes |
| `timeout`, `max_response_bytes`, `include_raw_html` | number, number, boolean | `90`, 5 MB, `false` | Limits and raw output |
| `estimate_first` | boolean | `false` | Run a free cost estimate first |

Not exposed: `source` (dashboard tracking tag), `sync` (the tool is always synchronous), `webhook_url` (use `alterlab_batch`/`alterlab_crawl` webhooks). If a scrape outlives the ~85s synchronous window the tool returns a `job_id`; fetch it with `alterlab_get_job`.

### `alterlab_extract` &mdash; Extract Structured Data

Extract structured fields from HTML, text or markdown content using pre-built profiles or custom JSON Schema. Returns clean JSON &mdash; ready for databases, spreadsheets, or downstream processing.

```
"Extract the product name, price, and rating from this Amazon page"
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `content` | string (max 500,000) | required | HTML, text or markdown you already have (this tool does not fetch a URL) |
| `content_type` | `html` \| `text` \| `markdown` | `html` | Type of `content` |
| `extraction_profile` / `extraction_template` | enum | &mdash; | Profile: `auto`, `product`, `article`, `job_posting`, `faq`, `recipe`, `event`, `ecommerce_homepage`, `directory_listing` |
| `extraction_schema` | object | &mdash; | Custom JSON Schema for structured output |
| `extraction_prompt` | string | &mdash; | Natural language extraction instructions |
| `extraction_provider` / `extraction_model` | enum / string | &mdash; | BYOK LLM selection |
| `formats` | enum[] | `["json"]` | Output formats |
| `source_url`, `evidence` | string, boolean | &mdash; | Context URL and provenance |
| `cache`, `cache_ttl` | `auto` \| `skip` \| `only`, number | `auto` | Extraction result cache |

To scrape and extract in one step, use `alterlab_scrape` with `extraction_schema`.

**Extraction profiles:**

- **Product** &mdash; name, price, currency, rating, reviews, availability, images, description
- **Article** &mdash; title, author, published date, body text, featured image
- **Job Posting** &mdash; title, company, location, salary, description, requirements
- **FAQ** &mdash; question-answer pairs
- **Recipe** &mdash; ingredients, instructions, prep time, servings
- **Event** &mdash; name, date, location, description, organizer

### `alterlab_screenshot` &mdash; Screenshot Any Page

Take a full-page screenshot of any URL. Returns a PNG image directly in the conversation &mdash; no URLs to copy, no files to download.

```
"Take a screenshot of our landing page at https://alterlab.io"
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `url` | string | required | URL to screenshot |
| `wait_for` | string | &mdash; | CSS selector to wait for before capture |
| `wait_until` | enum | `networkidle` | `networkidle`, `domcontentloaded`, or `load` |
| `timeout` | number | `90` | Timeout in seconds (1-300) |
| `use_proxy`, `proxy_country` | boolean, string | &mdash; | Premium proxy and geo-targeting |
| `session_id`, `cookies` | UUID, object | &mdash; | Screenshot pages behind a login |
| `location` | `{country, language}` | &mdash; | Geo-targeting |

### `alterlab_estimate_cost` &mdash; Estimate Before You Scrape

Check how much a scrape will cost before running it. Returns the predicted tier, cost per request, and confidence level.

```
"How much would it cost to scrape linkedin.com?"
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `url` | string | required | URL to estimate |
| `mode` | enum | `auto` | Scraping mode |
| `method` | `GET` \| `POST` | `GET` | POST costs 1.5x |
| `render_js` | boolean \| `"auto"` | `false` | Include JS rendering cost |
| `use_proxy`, `use_own_proxy` | boolean | `false` | Include proxy cost / BYOP discount |
| `screenshot`, `generate_pdf`, `ocr` | boolean | &mdash; | Include add-on cost |

### `alterlab_get_job` &mdash; Fetch an Async Job

Fetch the status and result of a scrape that returned a `job_id` (a scrape that outlived the synchronous wait window). Parameter: `job_id` (string, required).

### `alterlab_check_balance` &mdash; Check Your Credits

Check your account balance, total deposited, and total spent. No parameters needed.

```
"Check my AlterLab balance"
```

### `alterlab_list_sessions` &mdash; List Stored Sessions

List all stored sessions for authenticated scraping. Sessions contain cookies for specific domains, allowing you to scrape content behind login walls.

```
"List my stored sessions"
```

### `alterlab_create_session` &mdash; Create a Session

Create a new stored session with cookies from a logged-in browser. The session is stored securely and can be reused across multiple scrape requests.

```
"Create an Amazon session with these cookies: session-id=abc123, session-token=xyz789"
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` | string | required | Human-readable name (e.g., "My Amazon Account") |
| `domain` | string | required | Domain (e.g., "amazon.com") |
| `consent` | boolean | required | Must be `true`: explicit GDPR consent to store the cookies (the API rejects creation otherwise) |
| `cookies` | `Record<string,string>` \| cookie objects[] | &mdash; | Cookies as key-value pairs or `{name, value, domain, path, ...}` objects |
| `headers` | `Record<string,string>` | &mdash; | Custom headers (e.g. a User-Agent) |
| `expires_at`, `notes` | string | &mdash; | Expiry (ISO 8601) and notes |
| `auto_refresh_enabled`, `notify_before_expiry`, `notify_on_failure` | boolean | `true` | Health checks and notifications |
| `organization_id`, `shared` | UUID, boolean | &mdash; | Organization sharing |

### `alterlab_validate_session` &mdash; Validate a Session

Check whether a stored session is still active and its cookies are valid.

```
"Is my Amazon session still valid?"
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `session_id` | string (UUID) | required | Session ID to validate |

### `alterlab_delete_session` &mdash; Delete a Session

Permanently delete a stored session and its cookies.

```
"Delete session abc-123-def"
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `session_id` | string (UUID) | required | Session ID to delete |

---

## Authenticated Scraping

AlterLab MCP supports scraping pages that require authentication. This enables AI agents to access user-specific content like order histories, account dashboards, and member-only pricing.

### How It Works

1. **Create a session** with cookies from a logged-in browser using `alterlab_create_session`
2. **Scrape authenticated pages** by passing the `session_id` to `alterlab_scrape`
3. **Manage sessions** with list, validate, and delete tools

### Example: Check Amazon Prime Pricing

```
User: "What's my Prime member price for this product?"

Claude: [calls alterlab_list_sessions → finds Amazon session]
Claude: [calls alterlab_scrape with session_id for authenticated pricing]
Claude: "The Prime member price is $24.99 (public price: $34.99)"
```

### Inline Cookies vs Stored Sessions

- **Stored sessions** (`session_id`): Best for repeated access to the same domain. Create once, reuse across requests.
- **Inline cookies** (`cookies`): Best for one-off authenticated requests where you don't need to save the session.

---

## What Can You Do with AlterLab MCP?

### Research and Analysis

Ask Claude to scrape and analyze websites in real-time:

- *"Scrape the top 5 results from this Google search and summarize them"*
- *"Extract all product prices from this Amazon category page"*
- *"Compare the pricing pages of these 3 competitors"*

### Code Generation with Real Data

Let Cursor or Windsurf fetch live data while building:

- *"Scrape this API documentation page and generate TypeScript types from it"*
- *"Extract the color palette from this website and create a Tailwind config"*
- *"Screenshot this design and recreate it in React"*

### Content and SEO

Use Claude to analyze content at scale:

- *"Scrape this blog post and suggest improvements for SEO"*
- *"Extract all FAQ entries from this help center and create a structured dataset"*
- *"Compare our landing page to the competitor's and identify gaps"*

### Monitoring and Alerts

Build agentic workflows that watch the web:

- *"Check if this product is back in stock"*
- *"Scrape this page daily and alert me when the price drops below $50"*
- *"Monitor this job board for new senior engineering positions"*

---

## Pricing &mdash; Pay-As-You-Go Web Scraping

No subscriptions. No monthly minimums. Add balance and use it whenever you need it.

### Base Scraping Costs

| Tier | Method | Cost per Request | Use Case |
|---|---|---|---|
| Curl | Direct HTTP | $0.0002 | Static pages, RSS feeds, public APIs |
| HTTP | TLS fingerprinting | $0.0003 | Sites with basic bot detection |
| Stealth | Browser impersonation | $0.002 | Cloudflare, DataDome, PerimeterX protected sites |
| Light JS | JSON extraction | $0.0025 | Server-rendered pages needing structured data |
| Browser | Headless Chromium | $0.004 | Full JavaScript SPAs (React, Angular, Vue) |

### Optional Add-Ons

| Add-On | Extra Cost | Description |
|---|---|---|
| JavaScript Rendering | forces Browser tier | No separate add-on: `render_js` bills the Browser tier ($0.004) |
| PDF Generation | +$0.0004 | PDF of the rendered page |
| LLM Extraction / Embeddings | +$0.001 | `extraction_schema` / `extraction_prompt`, `embeddings` |
| POST requests | x1.5 | `method: "POST"` costs 1.5x the tier price |
| Own proxy (BYOP) | -20% | `use_own_proxy` discount on the tier price |
| Search | $0.001 / $0.004 | duckduckgo / google and bing engines |
| Screenshot Capture | +$0.0002 | Full-page PNG screenshot |
| Premium Proxy | +$0.0002 | Geo-targeted residential proxy (195+ countries) |
| OCR Text Extraction | +$0.001 | Extract text from images on the page |

**$1 = 5,000 light scrapes.** New accounts get $1 free balance on signup.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ALTERLAB_API_KEY` | Yes | &mdash; | Your API key ([get one free](https://app.alterlab.io/signin?redirect=/dashboard/keys&source=mcp&utm_source=mcp&utm_medium=integration&utm_campaign=mcp_server)) |
| `ALTERLAB_API_URL` | No | `https://api.alterlab.io` | API base URL (for self-hosted or development) |

---

## Frequently Asked Questions

### How do I add web scraping to Claude, Cursor, or Windsurf?

Install the AlterLab MCP server. For Claude Code, run `claude mcp add alterlab -- npx -y alterlab-mcp-server@latest` and set your `ALTERLAB_API_KEY`. For Claude Desktop, Cursor, or Windsurf, add the JSON config block to your MCP settings file. Once configured, your AI assistant can scrape any URL, extract structured data, and take screenshots directly in conversation.

### Can Claude scrape websites that are behind Cloudflare or anti-bot protection?

Yes. AlterLab automatically handles Cloudflare, DataDome, PerimeterX, Akamai, and other anti-bot systems. It uses a multi-tier approach that starts with the cheapest method and escalates only when blocked. You don't need to configure anything &mdash; anti-bot bypass is fully automatic.

### What is an MCP server and how does it work with Claude?

MCP (Model Context Protocol) is Anthropic's open standard for connecting AI assistants to external tools and data sources. An MCP server is a small program that exposes tools &mdash; like web scraping &mdash; that Claude, Cursor, or Windsurf can call during a conversation. The AlterLab MCP server gives your AI assistant 23 tools: scrape, extract, screenshot, crawl, search, map, batch scraping, session management, beta features, and more.

### How is AlterLab different from Firecrawl, ScrapingBee, or Apify MCP servers?

AlterLab starts at $0.0002 per request &mdash; 5-20x cheaper than most scraping APIs &mdash; because it only uses expensive browser rendering when a site actually requires it. Smart tier escalation means you pay for what each site needs, not the maximum. AlterLab also includes built-in structured data extraction with pre-built profiles (product, article, job posting, etc.).

### Can I scrape Amazon, Walmart, and other e-commerce sites from Claude?

Yes. AlterLab handles all major e-commerce anti-bot protection. Use the `alterlab_extract` tool with `extraction_profile: "product"` to get structured JSON: product name, price, currency, rating, review count, availability, and images &mdash; ready for analysis, comparison, or data pipelines.

### Can Cursor scrape documentation and generate code from it?

Yes. With AlterLab MCP installed in Cursor, you can ask it to scrape API documentation, library docs, or any reference page and generate TypeScript types, API clients, or component code from the live content. This is more reliable than relying on the LLM's training data, which may be outdated.

### Does AlterLab MCP work with JavaScript-heavy sites (React, Angular, Vue)?

Yes. Use `render_js: true` or set `mode: "js"` to enable full headless Chromium rendering. AlterLab renders the complete page including all JavaScript, waits for dynamic content to load, then extracts content from the fully rendered DOM. This works for React, Angular, Vue, Next.js, and any other JavaScript framework.

### What output format is best for AI and LLM context windows?

Use markdown (the default). It preserves document structure &mdash; headings, tables, lists, links &mdash; while being 60-80% smaller than raw HTML. Claude, GPT-4, and other LLMs process markdown significantly better than HTML. AlterLab's markdown output is specifically optimized for LLM context windows.

### Is there rate limiting?

Free-tier accounts have rate limits. Adding any balance removes rate limits. The MCP server includes automatic retry with exponential backoff for transient rate limit errors (429).

### Can I use this MCP server for large-scale scraping?

Yes. For parallel scraping, use `alterlab_batch` to scrape up to 100 URLs in a single request — much faster than sequential calls. For crawling entire domains, use `alterlab_crawl`. You can also build agentic workflows that scrape many URLs sequentially, or use the [n8n integration](https://www.npmjs.com/package/n8n-nodes-alterlab) for workflow automation.

---

## Error Handling

The MCP server returns helpful error messages with suggested next actions:

| Error | What Happens | Suggested Action |
|---|---|---|
| **401** Unauthorized | Invalid API key | Check `ALTERLAB_API_KEY` is set correctly |
| **402** Insufficient Credits | Balance too low | Run `alterlab_check_balance`, add funds |
| **403** Forbidden | Site blocked the request | Try `render_js: true` + `use_proxy: true` |
| **429** Rate Limited | Too many requests | Automatic retry with backoff |
| **504** Gateway Timeout | Scrape took too long | Increase `timeout`, simplify request |

---

## Agentic Workflows — AI Agents That Scrape the Web

AlterLab MCP turns any AI agent into a web-capable agent. Instead of relying on stale training data, your agent can fetch live information from any website during execution.

### Use Cases for AI Agents

- **Research agents** — scrape multiple sources, cross-reference facts, generate reports with citations
- **Data pipeline agents** — extract structured product/pricing/job data on a schedule
- **Competitive intelligence** — monitor competitor pages, track pricing changes, detect new features
- **Content generation** — scrape real data to ground LLM output in facts, not hallucinations
- **Lead enrichment** — scrape company websites to enrich CRM records with live data
- **Compliance monitoring** — check regulatory pages, terms of service, and policy updates

### Compatible AI Frameworks and Clients

Works with any tool that supports MCP (Model Context Protocol):

- **Claude Desktop** / **Claude Code** — Anthropic's AI assistant
- **Cursor** — AI-powered code editor
- **Windsurf** — Codeium's AI IDE
- **Cline** — VS Code AI assistant
- **GitHub Copilot** — via MCP configuration
- **Custom agents** — any framework using the MCP SDK (Python, TypeScript, Go)
- **n8n** — workflow automation via [n8n-nodes-alterlab](https://www.npmjs.com/package/n8n-nodes-alterlab)

---

## Contributing

```bash
git clone https://github.com/RapierCraft/alterlab-mcp-server.git
cd alterlab-mcp-server
npm install
npm run build
```

## Support

- [API Documentation](https://docs.alterlab.io/api?utm_source=mcp&utm_medium=integration&utm_campaign=mcp_server)
- [Dashboard & API Keys](https://app.alterlab.io/dashboard?utm_source=mcp&utm_medium=integration&utm_campaign=mcp_server)
- [GitHub Issues](https://github.com/RapierCraft/alterlab-mcp-server/issues)
- [support@alterlab.io](mailto:support@alterlab.io)

## License

[MIT](LICENSE)
