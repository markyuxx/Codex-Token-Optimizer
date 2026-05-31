# Codex Token Optimizer

Hybrid context retrieval and token-reduction framework for coding agents.

Status: `0.4.0`, production partial. The project now has safe command execution, exact token counters where providers support them, cached file reads, AST/BM25 retrieval, command-output compaction, MCP tools, CLI commands, and local benchmarks. It is not a global OS hook and it does not claim exact token counts for unsupported models.

## Install

```bash
git clone https://github.com/markyuxx/Codex-Token-Optimizer.git
cd Codex-Token-Optimizer
npm install
npm run check
```

Use the CLI directly:

```bash
npx token-optimizer build
npx token-optimizer query "safe command runner"
npx token-optimizer read runtime.js
npx token-optimizer exec node --version
npx token-optimizer benchmark
```

Or from this checkout:

```bash
npm run build
npm run query -- "retrieveContext budget"
npm run read -- runtime.js --include-content
npm run exec -- node --version
npm run bench:smoke
```

## What It Does

The optimizer builds a `.token-optimizer/` state directory with an index, cache, staleness snapshot, command artifacts, rules and benchmark output. The runtime exposes three core operations:

```js
const { createRuntime } = require("codex-token-optimizer");
const runtime = createRuntime({ rootDir: process.cwd() });

await runtime.buildIndex();
await runtime.retrieveContext("runCommand safeMode allowlist", { budget: 800 });
await runtime.readFileContext("runtime.js");
await runtime.runCommand({ cmd: "node", args: ["--version"] });
```

Retrieval uses JavaScript/TypeScript AST parsing, symbols, imports, calls, BM25 chunk ranking, exact-match boosts, source/test weighting and lockfile/minified penalties. Embeddings remain pluggable through provider adapters, but local tests do not require network calls.

Pinned rules come from `AGENTS.md` and stay visible in context bundles. The optimizer does not replace critical instructions with a hidden original.

## Safe Command Execution

`runCommand` defaults to `safeMode: true`. Safe mode uses `spawn` without a shell and prefers structured input:

```js
await runtime.runCommand({ cmd: "npm", args: ["test"] });
```

Allowed by default:

- `npm test`
- `npm run test`
- `npm run lint`
- `npm run build`
- `npm run check`
- `npm run bench:smoke`
- `node --version`
- `npm --version`
- `git status`
- `git diff`
- `git log`
- `ls` / `dir` with a simple repo-local path

Blocked in safe mode:

- Shell syntax such as pipes, redirects, `&&`, `||`, `;`, backticks, `$()`, subshells.
- Shell wrappers such as `bash -c`, `sh -c`, `cmd /c`, `powershell -Command`, `pwsh -Command`.
- Inline interpreters such as `node -e`, `python -c`, `ruby -e`.
- Dangerous operations such as `rm`, `del`, `rmdir`, `git reset --hard`, `git clean`, `git push --force`, `sudo`, `curl | sh`, `wget | sh`.
- Obvious secret-file reads such as `.env`, SSH keys, `.pem`, `.key`, `.p12`, `.pfx`.
- Network/shell-adjacent commands such as `curl`, `wget`, `ssh`, `scp`, `env` and `printenv`.

`runCommand` responses include stable fields for agents: `command`, `args`, `cwd`, `safeMode`, `allowed`, `blockedReason`, `timedOut`, `stdoutPreview`, `stderrPreview`, `errors`, `warnings`, `failedTests`, `stackTraces`, `fileReferences`, `artifactPath`, `tokensBefore`, `tokensReturned` and `tokensSaved`.

Unsafe mode exists for trusted local use only:

```bash
npx token-optimizer exec "node scripts/local-only.js" --unsafe
```

Treat `--unsafe` as running a normal shell command. Review it first.

## Token Metrics

Token counters report their accuracy:

- OpenAI text: `exact: true`, `accuracy: "exact-text"`, counted locally with `js-tiktoken`.
- OpenAI messages: `exact: false`, `accuracy: "estimated-chat-structure"`, because chat wrappers can change by model revision.
- Anthropic and Gemini: `accuracy: "provider-api-count"` only when their official count APIs succeed.
- Unknown models: `unsupported` unless you pass `allowEstimateFallback: true`, which returns an explicit heuristic estimate.

Responses split savings by source where applicable:

- `retrieval`
- `cache`
- `commandCompaction`
- `pinnedRules`
- `embeddings`
- `baseline`
- `returned`

## CLI

```bash
token-optimizer build
token-optimizer query "query text" --budget 1200 --model gpt-4o-mini
token-optimizer bundle "query text" --max-tokens 900
token-optimizer read src/file.js --include-content --max-bytes 200000
token-optimizer exec node --version --safe-mode --timeout 30000
token-optimizer exec "custom command" --unsafe
token-optimizer tokens --text "hello world" --model gpt-4o-mini
token-optimizer benchmark --budget 600
token-optimizer rules
token-optimizer status
```

Useful flags:

- `--safe-mode` keeps the default safe runner behavior.
- `--unsafe` permits shell execution for trusted commands.
- `--allow-command` adds regex allowlist entries for safe mode.
- `--timeout`, `--max-stdout-bytes`, `--max-stderr-bytes`, `--max-lines`, `--max-artifact-bytes`, `--max-command-length`, `--max-args`, `--max-arg-length`.
- `--max-tokens`, `--max-bytes`, `--json`, `--include-content`, `--force`, `--cwd`, `--model`, `--provider`, `--excludes`.

## MCP

Start the MCP server:

```bash
npm run mcp
```

Tools:

- `estimate_tokens`
- `retrieve_context`
- `read_file_context`
- `run_command`
- `get_rules`
- `benchmark_run`
- `staleness`
- `index_status`

`run_command` uses safe mode by default in MCP too. Pass `{ "cmd": "node", "args": ["--version"] }` when possible.

## Benchmarks

Run:

```bash
npm run bench:smoke
npm run bench
npm run bench:full
```

The benchmark writes:

- `reports/benchmark-latest.json`
- `reports/benchmark-latest.md`
- `.token-optimizer/benchmark-last.json`

It checks retrieval hits, symbol lookup, class lookup, multi-file context, noisy queries, small budgets, lockfile confusion, budget compliance, cache savings and command compaction savings. If thresholds fail under `--fail-on-regression`, the process exits non-zero.

## Limitations

This project optimizes context only when agents use its CLI, MCP tools or Node API. It does not intercept arbitrary editor reads, OS file access, terminal output outside the proxy, or model provider internals.

Embeddings are pluggable, but remote embeddings require provider configuration. Local benchmarks rely on deterministic AST/BM25 retrieval so they can run without network access.

`production partial` means the dangerous defaults are locked down and the local gates pass. It does not mean security review is complete for every environment.
