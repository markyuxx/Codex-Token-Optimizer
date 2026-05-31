# Codex Token Optimizer

Codex Token Optimizer is local tooling for reducing agent context cost in coding workflows. It is honest about what is exact, what is estimated, and what only works when your workflow actually routes reads, retrieval, and command output through the tool.

It is not magic, and it is not a sandbox. It is a measurable context optimizer for trusted development repositories.

## What It Does

- Counts tokens for plain text with provider-aware tokenizers when available.
- Marks OpenAI chat-message counts as estimated message-structure counts, not provider-exact counts.
- Indexes JS/TS repositories with AST symbols, imports, exports, calls, text chunks, and symbol chunks.
- Retrieves compact context bundles with token budgets and pinned rules.
- Caches file reads and omits unchanged file content by default.
- Runs commands through a summarizing proxy with output truncation, artifacts, timeout support, dangerous-command blocking, and allowlists.
- Reports benchmark metrics using real token counting: baseline tokens, optimized tokens, savings ratio, precision, recall, query time, index time, and index size.
- Exposes CLI, Node API, and MCP tools.

## What It Does Not Do

- It does not guarantee token savings if agents bypass the CLI/API/MCP and read files directly.
- It does not make arbitrary shell commands safe.
- It does not provide OS-level sandboxing or container isolation.
- It does not prove end-to-end agent success without an external evaluator.
- It does not make embeddings mandatory; lexical retrieval works without embeddings, while embeddings remain pluggable.
- It does not call estimated chat-message token counts exact.

## Installation

Install from GitHub:

```bash
npm install github:markyuxx/Codex-Token-Optimizer
```

Clone and run locally:

```bash
git clone https://github.com/markyuxx/Codex-Token-Optimizer.git
cd Codex-Token-Optimizer
npm install
npm test
npm run bench
```

Use without installing globally:

```bash
npx github:markyuxx/Codex-Token-Optimizer build
```

Requirements:

- Node.js 18 or newer
- npm 9 or newer recommended

Optional credentials:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- `OLLAMA_BASE_URL`
- `OLLAMA_EMBED_MODEL`

## Quick Start

Build the local index:

```bash
npm run build
```

Query relevant implementation context:

```bash
npm run query -- "createTokenCounterRegistry js-tiktoken countMessages inferProvider"
```

Read a file through the cache:

```bash
npm run read -- runtime.js
```

Force unchanged content to be returned:

```bash
npm run read -- runtime.js --includeContent true
```

Count tokens:

```bash
npm run tokens -- --model gpt-4o-mini --text "hello world"
```

Run a command through the proxy:

```bash
npm run exec -- "cmd /c echo optimizer-ok"
```

Run the benchmark:

```bash
npm run bench
```

## CLI Commands

- `npm run build`
- `npm run query -- "<query>"`
- `npm run read -- <path>`
- `npm run tokens -- --model <model> --text "<text>"`
- `npm run exec -- "<command>"`
- `npm run benchmark`
- `npm run bench`
- `npm run mcp`
- `npm run lint`
- `npm test`

If linked or installed globally:

```bash
token-optimizer build
token-optimizer query "token optimizer runtime cache retrieval"
token-optimizer read runtime.js
token-optimizer tokens --model gpt-4o-mini --text "hello world"
token-optimizer exec "cmd /c echo ok"
token-optimizer benchmark
```

## Token Counting

OpenAI-compatible plain text counting uses `js-tiktoken` and returns `accuracy: "exact-text"`.

OpenAI chat-message counting returns `accuracy: "estimated-chat-structure"` because local code can count content tokens and add known message overhead, but the provider is the final source of truth.

Anthropic and Gemini use provider token-count endpoints when credentials and network access are available. If a provider/model is unsupported, the result is explicit:

```json
{
  "status": "unsupported",
  "accuracy": "unsupported"
}
```

## Cache Behavior

Repeated unchanged reads do not return full content by default. They return metadata:

- path,
- hash,
- size,
- token estimate,
- first seen timestamp,
- last seen timestamp,
- cache reference.

Use `includeContent: true` or `force: true` from the API when the caller really needs the full unchanged content.

This is where real cache token savings come from. Returning full content and hoping an agent ignores it is not an optimizer.

## Command Safety

The command proxy includes:

- timeout support,
- max output buffer support,
- output truncation,
- full artifact persistence,
- dangerous command blocking by default,
- allowlist support,
- warning/error/path extraction.

It still uses a shell. Do not pass untrusted commands. For stricter workflows, run commands inside a container and configure an allowlist.

## MCP Tools

The MCP server exposes:

- `estimate_tokens`
- `retrieve_context`
- `read_file_context`
- `run_command`
- `get_rules`
- `benchmark_run`
- `staleness`
- `index_status`

Start it with:

```bash
npm run mcp
```

## API Usage

```js
const { createRuntime } = require("codex-token-optimizer");

async function main() {
  const runtime = createRuntime({ rootDir: process.cwd() });

  await runtime.buildIndex();

  const bundle = await runtime.retrieveContext("token optimizer runtime", {
    budget: 900,
    model: "gpt-4o-mini",
  });

  console.log(bundle.metrics);
}

main().catch(console.error);
```

## Benchmark

Run:

```bash
npm run bench
```

The benchmark reports:

- `tokensBaseline`
- `tokensOptimized`
- `tokensSaved`
- `savingsRatio`
- `averageRecallAtK`
- `averagePrecisionAtK`
- `embeddingCost`
- `indexTimeMs`
- `totalTimeMs`
- `indexBytes`

The benchmark is reproducible, but it is not a claim that every workflow saves tokens. It proves savings for the included tasks and shows where the savings come from.

## Project Structure

- `runtime.js`: top-level facade
- `api.js`: import surface
- `index.js`: CLI entry
- `mcp-server.js`: MCP surface
- `lib/tokenization.js`: token counter providers
- `lib/retrieval.js`: scanner, parser, chunker, BM25, embeddings
- `lib/cache.js`: file and command cache
- `lib/commands.js`: command proxy and structured summaries
- `lib/benchmark.js`: benchmark runner
- `tests/token-optimizer.test.js`: unit and integration coverage
- `AUDIT.md`: technical audit and remaining risks

## Current Status

Recommendation: beta.

It is a real optimizer now in the sense that it has measurable token-saving mechanisms and tests that prove them. It is not production-grade for hostile inputs or unsupervised command execution.
