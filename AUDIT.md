# Audit

Current target: `production partial` for `0.4.0`.

## Security Gate

Resolved:

- `runCommand` no longer uses shell-first execution in safe mode.
- Safe mode defaults to true across API, CLI and MCP.
- Safe mode rejects shell syntax, shell wrappers, inline interpreters and dangerous commands.
- Safe mode ships with a narrow allowlist for low-risk development commands.
- Runtime rejects command cwd values outside the configured repo root.
- Command outputs use byte caps, line caps, timeout handling, artifact truncation markers and secret redaction.
- Filesystem helpers resolve real paths, reject symlink escapes and skip common secret, binary, dependency, build, cache, lockfile and oversized files.

Residual risk:

- Unsafe mode can run arbitrary shell commands. Users must opt in with `unsafe:true` or `--unsafe`.
- Allowlist regexes come from trusted configuration. A broad regex can weaken safe mode.
- Secret redaction covers common patterns, not every possible secret format.

## Token Accounting Gate

Resolved:

- OpenAI text counts report `exact: true`, `accuracy: "exact-text"`.
- OpenAI messages report `exact: false`, `accuracy: "estimated-chat-structure"`.
- Anthropic and Gemini counts report `provider-api-count` only when provider APIs succeed.
- Unsupported models return `unsupported` unless callers request a heuristic fallback.
- Runtime metrics split retrieval, cache, command compaction, pinned rules, baseline and returned tokens.

Residual risk:

- Message token overhead can change when providers update chat framing.
- Provider API counts require network access and valid API keys.

## Retrieval Gate

Resolved:

- Indexing extracts JS/TS symbols, imports, exports and calls with a real parser.
- Retrieval combines BM25, symbols, exact-match boosts, source/test weighting and lockfile/minified penalties.
- Bundles enforce token budgets and report stale file warnings.

Residual risk:

- Non-JS languages still rely on chunk text and path signals.
- Embedding adapters require external configuration for real semantic vectors.

## Benchmark Gate

Resolved:

- Benchmarks now write JSON and Markdown reports under `reports/`.
- Benchmark probes cover retrieval, repeated-read cache savings and large command-output compaction.
- `bench:smoke`, `bench` and `check` run local gates with regression thresholds.

Residual risk:

- Local benchmarks measure deterministic fixture tasks, not full human task success.
- Model output quality still needs external evaluation for release claims beyond `production partial`.
