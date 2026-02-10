<p align="center">
  <img src="https://alterlab.io/logo.png" alt="AlterLab Logo" width="120" />
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
claude mcp add alterlab -- npx -y alterlab-mcp-server
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
3. **Stealth** ($0.0005/req) &mdash; Browser impersonation for Cloudflare/DataDome-protected sites
4. **Light JS** ($0.0007/req) &mdash; Lightweight JS extraction from server-rendered HTML
5. **Browser** ($0.001/req) &mdash; Full headless Chromium for JavaScript-heavy SPAs

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
      "args": ["-y", "alterlab-mcp-server"],
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
      "args": ["-y", "alterlab-mcp-server"],
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
      "args": ["-y", "alterlab-mcp-server"],
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
| `formats` | `(text\|json\|html\|markdown)[]` | `["markdown"]` | Output formats |
| `render_js` | boolean | `false` | Use headless browser (+3 credits) |
| `use_proxy` | boolean | `false` | Premium proxy (+1 credit) |
| `proxy_country` | string | &mdash; | ISO country code for geo-targeting (e.g., `US`, `DE`) |
| `wait_for` | string | &mdash; | CSS selector to wait for before extraction |
| `timeout` | number | `90` | Timeout in seconds (1-300) |
| `include_raw_html` | boolean | `false` | Include raw HTML alongside formatted content |

### `alterlab_extract` &mdash; Extract Structured Data

Extract structured fields from any webpage using pre-built profiles or custom JSON Schema. Returns clean JSON &mdash; ready for databases, spreadsheets, or downstream processing.

```
"Extract the product name, price, and rating from this Amazon page"
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `url` | string | required | URL to extract from |
| `extraction_profile` | enum | `auto` | Profile: `product`, `article`, `job_posting`, `faq`, `recipe`, `event` |
| `extraction_schema` | object | &mdash; | Custom JSON Schema for structured output |
| `extraction_prompt` | string | &mdash; | Natural language extraction instructions |
| `render_js` | boolean | `false` | Use headless browser |
| `use_proxy` | boolean | `false` | Premium proxy |

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

### `alterlab_estimate_cost` &mdash; Estimate Before You Scrape

Check how much a scrape will cost before running it. Returns the predicted tier, cost per request, and confidence level.

```
"How much would it cost to scrape linkedin.com?"
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `url` | string | required | URL to estimate |
| `mode` | enum | `auto` | Scraping mode |
| `render_js` | boolean | `false` | Include JS rendering cost |
| `use_proxy` | boolean | `false` | Include proxy cost |

### `alterlab_check_balance` &mdash; Check Your Credits

Check your account balance, total deposited, and total spent. No parameters needed.

```
"Check my AlterLab balance"
```

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
| Stealth | Browser impersonation | $0.0005 | Cloudflare, DataDome, PerimeterX protected sites |
| Light JS | JSON extraction | $0.0007 | Server-rendered pages needing structured data |
| Browser | Headless Chromium | $0.001 | Full JavaScript SPAs (React, Angular, Vue) |

### Optional Add-Ons

| Add-On | Extra Cost | Description |
|---|---|---|
| JavaScript Rendering | +$0.0006 | Headless Chromium for dynamic content |
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

Install the AlterLab MCP server. For Claude Code, run `claude mcp add alterlab -- npx -y alterlab-mcp-server` and set your `ALTERLAB_API_KEY`. For Claude Desktop, Cursor, or Windsurf, add the JSON config block to your MCP settings file. Once configured, your AI assistant can scrape any URL, extract structured data, and take screenshots directly in conversation.

### Can Claude scrape websites that are behind Cloudflare or anti-bot protection?

Yes. AlterLab automatically handles Cloudflare, DataDome, PerimeterX, Akamai, and other anti-bot systems. It uses a multi-tier approach that starts with the cheapest method and escalates only when blocked. You don't need to configure anything &mdash; anti-bot bypass is fully automatic.

### What is an MCP server and how does it work with Claude?

MCP (Model Context Protocol) is Anthropic's open standard for connecting AI assistants to external tools and data sources. An MCP server is a small program that exposes tools &mdash; like web scraping &mdash; that Claude, Cursor, or Windsurf can call during a conversation. The AlterLab MCP server gives your AI assistant 5 tools: scrape, extract, screenshot, estimate cost, and check balance.

### How is AlterLab different from Firecrawl, ScrapingBee, or Apify MCP servers?

AlterLab starts at $0.0002 per request &mdash; 5-20x cheaper than most scraping APIs &mdash; because it only uses expensive browser rendering when a site actually requires it. Smart tier escalation means you pay for what each site needs, not the maximum. AlterLab also includes built-in structured data extraction with pre-built profiles (product, article, job posting, etc.) at no extra cost.

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

Yes. The MCP server processes one request at a time through the conversation interface, but you can build agentic workflows that scrape many URLs sequentially. For batch processing, use the AlterLab API directly or the [n8n integration](https://www.npmjs.com/package/n8n-nodes-alterlab).

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
