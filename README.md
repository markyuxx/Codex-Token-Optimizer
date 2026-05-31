# Codex Token Optimizer

Codex Token Optimizer is a practical hybrid framework for reducing agent context cost without pretending that a static prompt compactor is enough.

It combines:

- exact token counting when the provider supports it,
- code indexing with AST metadata,
- lexical retrieval plus pluggable embeddings,
- cached file reads with stable references,
- command execution through a summarizing proxy,
- pinned rules that stay visible in every context bundle,
- benchmark runs that compare optimized retrieval against a baseline.

## Why this exists

Most so-called token optimizers only do one shallow thing:

- shorten a static prompt,
- build a naive grep index,
- or summarize a giant blob after the damage is already done.

That does not solve the real problem.

Real token waste usually comes from:

- reading the same files again and again,
- dumping giant logs into context,
- over-fetching irrelevant code,
- losing critical instructions between turns,
- pretending rough estimates are real token counts.

This package targets those failure modes directly.

## What it does

### 1. Exact token counting by provider

Supported behavior today:

- OpenAI-compatible model counting with `js-tiktoken`
- Anthropic official `count_tokens` path when credentials are available
- Gemini official `countTokens` path when credentials are available

If a model does not have an exact counter configured, the framework returns `unsupported`.
It does not fake precision with a heuristic and call it real.

### 2. Hybrid code retrieval

The indexer scans the repository and builds:

- file metadata,
- AST-derived symbols,
- imports,
- exports,
- call references,
- chunked file excerpts,
- BM25 lexical ranking data.

Embeddings are pluggable.
The current implementation supports:

- `openai` embeddings with `OPENAI_API_KEY`
- `ollama` embeddings with a local server

If embeddings are not configured, lexical retrieval still works.

### 3. Cached reads

`readFileContext()` stores stable cache references per file hash.

That means a repeated read can come back as:

- `new`
- `changed`
- `unchanged`

instead of blindly rehydrating the same file into agent context every time.

### 4. Command proxy

`runCommand()` executes commands and decides whether to:

- return the full output,
- return a compact structured summary,
- or persist the full artifact and return a reference.

This is the difference between:

- "here are 900 noisy lines of test output"

and:

- "exit code 1, these are the 3 important failures, full log stored as artifact X"

### 5. Pinned rules

Critical rules are read from `AGENTS.md` and related sources, normalized, and attached to context bundles so the agent keeps seeing the high-priority constraints.

### 6. Benchmarking

The benchmark runner compares optimized retrieval against a baseline and reports:

- task count,
- regressions,
- token cost,
- hit quality,
- selected files.

## Installation

### Option A: install from GitHub

```bash
npm install github:markyuxx/Codex-Token-Optimizer
```

### Option B: clone and install locally

```bash
git clone https://github.com/markyuxx/Codex-Token-Optimizer.git
cd Codex-Token-Optimizer
npm install
```

### Option C: use it without global install

```bash
npx github:markyuxx/Codex-Token-Optimizer build
```

## Requirements

- Node.js 18 or newer
- npm 9 or newer recommended

Optional credentials:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- `OLLAMA_BASE_URL`
- `OLLAMA_EMBED_MODEL`

## Quick start

### 1. Build the index

```bash
npm run build
```

This creates `.token-optimizer/` with:

- `index.json`
- `rules.json`
- `staleness.json`
- `cache.json`
- `artifacts/`
- `benchmark-last.json`

### 2. Query relevant code

```bash
npm run query -- "openai token counting provider"
```

This returns a context bundle with:

- ranked items,
- token cost,
- pinned rules,
- stable references,
- truncation signal.

### 3. Read a file through the cache

```bash
npm run read -- runtime.js
```

### 4. Estimate tokens before you send context

```bash
npm run tokens -- --model gpt-4o-mini --text "hello world"
```

### 5. Run a command through the optimizer

```bash
npm run exec -- "cmd /c echo optimizer-ok"
```

### 6. Run the benchmark

```bash
npm run benchmark
```

## CLI commands

- `npm run build`
- `npm run query -- "<query>"`
- `npm run read -- <path>`
- `npm run tokens -- --model <model> --text "<text>"`
- `npm run exec -- "<command>"`
- `npm run benchmark`
- `npm run mcp`
- `npm test`

If the package is installed globally or linked:

```bash
token-optimizer build
token-optimizer query "token optimizer runtime cache retrieval"
token-optimizer read src/index.js
token-optimizer tokens --model gpt-4o-mini --text "hello world"
token-optimizer exec "cmd /c echo ok"
token-optimizer benchmark
```

## MCP tools

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

## API usage

```js
const { createRuntime } = require("codex-token-optimizer");

async function main() {
  const runtime = createRuntime({ rootDir: process.cwd() });

  await runtime.buildIndex();

  const bundle = await runtime.retrieveContext("token optimizer runtime", {
    budget: 900,
    model: "gpt-4o-mini",
  });

  console.log(bundle.items.map((item) => item.path));
}

main().catch(console.error);
```

## Project structure

- `runtime.js`: top-level facade
- `api.js`: import surface
- `index.js`: CLI entry
- `mcp-server.js`: MCP surface
- `lib/tokenization.js`: exact token counter providers
- `lib/retrieval.js`: scanner, parser, chunker, BM25, embeddings
- `lib/cache.js`: file and command cache
- `lib/commands.js`: command proxy and structured summaries
- `lib/benchmark.js`: benchmark runner
- `tests/token-optimizer.test.js`: runtime verification

## How to think about installation in a real project

If you want to use this seriously, the safest path is:

1. install it in the repo where the agent works,
2. build the local index once,
3. call the CLI or API instead of raw file dumps,
4. route noisy shell output through `exec`,
5. wire the MCP server into your local tool stack.

The package is most useful when it becomes the default path for:

- reading code,
- estimating token budgets,
- retrieving context,
- handling test logs,
- preserving critical instructions.

If you only install it and keep reading files manually with raw shell commands, you lose most of the value.

## Current limitations

- Exact OpenAI token counting is local and robust; Anthropic and Gemini exact counting need valid credentials and network access.
- Embeddings are pluggable, but lexical retrieval remains the fallback when no embedding provider is configured.
- The benchmark currently measures retrieval quality and token cost, not end-to-end model success with an external judge.
- The command proxy is only as global as your workflow; if your team bypasses it, the optimizer cannot save those tokens for you.

## Testing

```bash
npm test
```

The test suite validates:

- index build behavior,
- repeated file-read caching,
- token-budgeted retrieval bundles,
- command summarization with stored artifacts,
- supported vs unsupported token counting.

## Philosophy

This project is intentionally honest.

If something is exact, it says exact.
If something is unsupported, it says unsupported.
If a workflow still depends on user discipline, it does not pretend to be magic.

That honesty is the whole point.
