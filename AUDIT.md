# Technical Audit

This audit is intentionally strict. The project is now more than an `AGENTS.md` compactor, but it is still not production-grade infrastructure for untrusted command execution or autonomous write access.

## Executive Summary

Before this pass, the repository was a real MVP token optimizer, not a mature optimizer. It had useful primitives: token counting, retrieval, command compaction, cache, benchmark scaffolding, and MCP. The weak parts were exactly where a serious agent tool gets judged: path safety, command execution controls, cache behavior, benchmark credibility, and README claims.

After this pass, it is closer to a defensible beta:

- repeated unchanged file reads omit full content by default,
- path containment uses real path boundaries instead of string prefixes,
- command execution has dangerous-command blocking, allowlists, timeouts, and output limits,
- token counting distinguishes exact text counts from estimated chat-message structure,
- retrieval adds symbol chunks and better filtering,
- benchmarks use real token counting and expose savings/quality metrics,
- CI runs lint, tests, and benchmark.

## What Works

- Plain-text OpenAI-compatible counting uses `js-tiktoken` and is marked `exact-text`.
- Anthropic and Gemini use provider count endpoints when credentials and network are available.
- Retrieval indexes JS/TS files with AST-derived symbols, imports, exports, calls, and chunks.
- Runtime bundles include pinned rules, retrieved excerpts, token cost, and savings metrics.
- Cache records stable file references and omits repeated unchanged content unless explicitly requested.
- Command output compaction persists full artifacts while returning a compact summary.
- Benchmark reports baseline tokens, optimized tokens, savings ratio, precision, recall, timing, index size, and regressions.
- MCP exposes the same core capabilities as the CLI/API.

## Fixed Issues

- `safeRelPath()` previously used `resolved.startsWith(root)`, which is vulnerable to false-prefix paths such as `/tmp/repo2` when the root is `/tmp/repo`.
- `readFileContext()` previously returned full content even when the cache status was `unchanged`, weakening the cache as a token-saving mechanism.
- `runCommand()` previously executed arbitrary shell commands without default blocking, timeout enforcement, or allowlist support.
- OpenAI message counting previously looked exact, but it was serialized local text counting rather than provider-exact message counting.
- Benchmarks previously used string lengths for baseline cost and had too few metrics to support strong claims.
- Retrieval had only simple text chunks; it now also emits symbol chunks and filters or penalizes more generated and low-signal files.

## Remaining Risks

- `runCommand()` still uses a shell. It is safer than before, but it is not a sandbox. Treat it as trusted-workspace tooling.
- Dangerous command detection is pattern-based. It reduces accidents, but it cannot prove command safety.
- Allowlist mode is available, but callers must opt into strict command policies.
- Provider-exact Anthropic and Gemini counting requires network access and credentials.
- Embedding quality is not benchmarked end to end without a configured embedding provider and evaluator.
- Benchmark tasks are local and reproducible, but they are still not a substitute for multi-repo agent success studies.
- MCP clients can still pass bad inputs; path and command guards now help, but deployment policy matters.

## Token Savings Proven By Tests

- Cache savings: repeated unchanged reads return metadata only unless `includeContent` or `force` is set.
- Retrieval savings: context bundles compare optimized excerpt tokens against full indexed baseline tokens.
- Command compaction savings: long command output records `tokensBefore` and compact `tokenCost`.
- Benchmark savings: `npm run bench` reports baseline tokens, optimized tokens, saved tokens, and savings ratio.

## Production Readiness

Recommendation: beta.

It is technically useful and measurably better than the previous MVP, but not production-grade for hostile inputs or unsupervised command execution. To call it production-ready, it still needs multi-repo benchmark suites, stricter policy configuration, stronger MCP auth/deployment guidance, and real-world agent outcome measurements.
