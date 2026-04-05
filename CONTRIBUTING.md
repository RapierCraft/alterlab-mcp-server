# Contributing to AlterLab MCP Server

Thank you for your interest in contributing. AlterLab MCP Server is open source and welcomes contributions from the community — whether that is a bug fix, a new feature, improved documentation, or a test case.

This guide covers everything you need to get started.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Environment](#development-environment)
- [Project Structure](#project-structure)
- [Building and Running Locally](#building-and-running-locally)
- [Testing Your Changes](#testing-your-changes)
- [Code Style](#code-style)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Reporting Issues](#reporting-issues)

---

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this standard. Please report unacceptable behavior to [support@alterlab.io](mailto:support@alterlab.io).

---

## Getting Started

### Prerequisites

- **Node.js** 18 or later (`node --version`)
- **npm** 8 or later (comes with Node.js)
- **Git**
- An **AlterLab API key** for integration testing — get one free at [app.alterlab.io/signin](https://app.alterlab.io/signin). New accounts receive $1 free balance (up to 5,000 scrapes).

### Fork and Clone

```bash
# Fork the repository on GitHub first, then:
git clone https://github.com/YOUR_USERNAME/alterlab-mcp-server.git
cd alterlab-mcp-server
```

---

## Development Environment

Install dependencies:

```bash
npm install
```

Set your API key for local testing:

```bash
export ALTERLAB_API_KEY=sk_live_your_key_here
```

You can also point the server at a custom API endpoint if you are running AlterLab locally:

```bash
export ALTERLAB_API_URL=http://localhost:8000
```

---

## Project Structure

```
alterlab-mcp-server/
├── src/
│   ├── index.ts          # MCP server entry point — registers all tools
│   ├── client.ts         # HTTP client for the AlterLab REST API
│   ├── config.ts         # Environment variable loading and validation
│   ├── errors.ts         # Typed error classes and error formatting
│   ├── format.ts         # Output formatting helpers (markdown, JSON, text)
│   ├── types.ts          # Shared TypeScript types and Zod schemas
│   └── tools/
│       ├── scrape.ts     # alterlab_scrape tool
│       ├── extract.ts    # alterlab_extract tool
│       ├── screenshot.ts # alterlab_screenshot tool
│       ├── estimate.ts   # alterlab_estimate_cost tool
│       ├── balance.ts    # alterlab_check_balance tool
│       └── sessions.ts   # Session management tools
├── dist/                 # Compiled JavaScript output (generated, not committed)
├── tsconfig.json         # TypeScript compiler configuration
└── package.json
```

Each tool file exports a Zod schema, a description string, and a handler function. The handler is the sole point of contact with the API client. Adding a new tool means creating a file in `src/tools/`, then registering it in `src/index.ts`.

---

## Building and Running Locally

Compile TypeScript to JavaScript:

```bash
npm run build
```

Run the compiled server:

```bash
npm start
```

Watch mode recompiles on every file change — useful during development:

```bash
npm run dev
```

To test the server end-to-end inside an MCP client (Claude Code), point it at your local build instead of the published package:

```json
{
  "mcpServers": {
    "alterlab-dev": {
      "command": "node",
      "args": ["/absolute/path/to/alterlab-mcp-server/dist/index.js"],
      "env": {
        "ALTERLAB_API_KEY": "sk_live_your_key_here"
      }
    }
  }
}
```

---

## Testing Your Changes

There is no automated test suite at this time. Contributions that add tests are welcome. For now, the recommended verification flow is:

1. Build: `npm run build` — fix any TypeScript compilation errors.
2. Type check without emitting: `npx tsc --noEmit`.
3. Run the server with your MCP client and exercise the affected tools manually.
4. Verify that errors from the API are surfaced clearly and that successful responses are formatted correctly.

When submitting a PR that changes a tool's behavior, include example inputs and outputs in the PR description so reviewers can verify the change manually.

---

## Code Style

The project uses TypeScript with strict mode enabled. Please follow these conventions:

- **TypeScript strict mode**: All code must compile without errors under `"strict": true`. Do not use `any` unless there is a documented reason.
- **Zod for input validation**: All tool input schemas are defined with Zod. New parameters must be added to the relevant Zod schema before being used in the handler.
- **Explicit return types**: Functions that are exported or non-trivial should have explicit return type annotations.
- **Error handling**: Use the typed error classes in `src/errors.ts`. Do not swallow errors silently. Surface them to the MCP client with a clear, actionable message.
- **No default exports**: Use named exports throughout for consistency with the existing codebase.
- **Async/await**: Prefer `async/await` over raw Promise chains.
- **Formatting**: There is no automated formatter enforced by CI at this time. Follow the existing indentation (2 spaces), quote style (double quotes), and semicolon usage visible in the source files.

Before submitting, run a final build to ensure there are no type errors:

```bash
npm run build
```

---

## Submitting a Pull Request

1. **Create a branch** from `main`:
   ```bash
   git checkout -b fix/describe-what-you-fixed
   # or
   git checkout -b feat/describe-what-you-added
   ```

2. **Make your changes.** Keep each PR focused on one concern. Mixed changes (e.g., a bug fix bundled with an unrelated refactor) will be asked to be split.

3. **Build and verify** locally before pushing:
   ```bash
   npm run build
   ```

4. **Commit** with a clear message. We follow [Conventional Commits](https://www.conventionalcommits.org/) loosely:
   - `fix(scrape): handle empty response body gracefully`
   - `feat(extract): add recipe extraction profile`
   - `docs: clarify session_id parameter description`
   - `chore: update MCP SDK to v1.13.0`

5. **Push and open a PR** against the `main` branch of `RapierCraftStudios/alterlab-mcp-server`:
   ```bash
   git push origin your-branch-name
   ```
   Then open a pull request on GitHub using the PR template.

6. **Respond to review feedback.** A maintainer will review your PR. If changes are requested, push additional commits to the same branch — do not open a new PR.

### What Makes a Good PR

- A clear description of the problem being solved or the feature being added.
- A note on how the change was tested.
- No unrelated changes bundled in.
- TypeScript compiles cleanly.

---

## Reporting Issues

Use GitHub Issues to report bugs and request features. Please use the issue templates:

- **Bug report**: For unexpected behavior, errors, or regressions.
- **Feature request**: For new tools, parameters, or integration ideas.

Before opening an issue, search existing issues to avoid duplicates.

For questions about the AlterLab API itself (authentication, billing, scraping behavior), reach out to [support@alterlab.io](mailto:support@alterlab.io) or consult the [API documentation](https://docs.alterlab.io/api).

---

## API Key for Testing

Most tool changes require a live API key to verify behavior against the real AlterLab backend. Sign up at [app.alterlab.io/signin](https://app.alterlab.io/signin) to get $1 free balance — enough for thousands of test scrapes at the cheapest tiers.

If you are fixing a bug that does not require live API calls (e.g., input validation, error message formatting, TypeScript types), you do not need an API key.
