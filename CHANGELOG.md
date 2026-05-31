# Changelog

## 0.4.0

- Replaced shell-first command execution with safe-mode `spawn` execution.
- Added default command allowlist and blocks for shell syntax, shell wrappers, inline interpreters and dangerous commands.
- Added cwd containment, output byte caps, argument caps, timeout handling, structured command summaries and secret redaction.
- Added stable command response fields for `allowed`, `blockedReason`, previews, artifact path and token savings.
- Added CLI/MCP support for stdout/stderr/artifact/argument limits and package-version-aligned MCP server info.
- Added metadata-only unchanged file reads with explicit cache token savings.
- Added exact/estimated token metadata, unsupported model handling and explicit heuristic fallback.
- Improved retrieval with symbol chunks, import context, exact-match boosts, lockfile/minified penalties, stale warnings, truncated/skipped chunk reporting and strict budget enforcement.
- Expanded benchmarks to measure retrieval, symbol/class lookup, noisy queries, small budgets, cache savings and command compaction savings, with JSON and Markdown reports.
- Added focused tests for commands, filesystem, runtime, tokenization, CLI, MCP and benchmark behavior.
- Added `SECURITY.md`, stronger audit notes, `bench:smoke`, `bench:full`, CI smoke benchmark and `check`.

## 0.3.0

- Added the first hybrid runtime with AST/BM25 retrieval, token counting, cache, command summaries, MCP and CLI surfaces.
- Marked the project as beta while command execution and benchmarks still needed hardening.
