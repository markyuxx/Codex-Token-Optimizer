# Token Optimizer Benchmark

Generated: 2026-05-31T17:20:37.561Z
Tasks: 5
Regressions: 0
Baseline tokens: 264775
Optimized tokens: 2295
Saved tokens: 262480
Savings ratio: 0.9913

| Task | Success | Saved | Recall | Precision | Budget | Paths |
| --- | --- | ---: | ---: | ---: | --- | --- |
| find token optimizer runtime | pass | 52456 | 1 | 0.25 | yes | mcp-server.js, runtime.js, lib/benchmark.js, lib/rules.js |
| find tokenization provider | pass | 52659 | 1 | 1 | yes | lib/tokenization.js |
| find safe command runner | pass | 52455 | 1 | 0.25 | yes | benchmarks/suite.json, lib/benchmark.js, lib/commands.js, CHANGELOG.md |
| find cache repeated reads | pass | 52455 | 0.5 | 0.25 | yes | lib/cache.js, lib/benchmark.js, benchmarks/suite.json, CHANGELOG.md |
| avoid lockfile confusion | pass | 52455 | 1 | 0.25 | yes | lib/benchmark.js, lib/retrieval.js, benchmarks/suite.json, SECURITY.md |

## Savings By Source

- retrieval: 262480
- cache: 4109
- commandCompaction: 3509
- pinnedRules: 2295
- embeddings: 0
- baseline: 264775
- returned: 2295
