# Token Optimizer Benchmark

Generated: 2026-05-31T15:13:17.827Z
Tasks: 5
Regressions: 0
Baseline tokens: 235255
Optimized tokens: 2286
Saved tokens: 232969
Savings ratio: 0.9903

| Task | Success | Saved | Recall | Precision | Paths |
| --- | --- | ---: | ---: | ---: | --- |
| find token optimizer runtime | pass | 46551 | 1 | 0.25 | mcp-server.js, runtime.js, lib/benchmark.js, lib/rules.js |
| find tokenization provider | pass | 46755 | 1 | 1 | lib/tokenization.js |
| find safe command runner | pass | 46553 | 1 | 0.3333 | lib/benchmark.js, lib/commands.js, benchmarks/suite.json |
| find cache repeated reads | pass | 46552 | 0.5 | 0.3333 | lib/cache.js, lib/benchmark.js, benchmarks/suite.json |
| avoid lockfile confusion | pass | 46558 | 1 | 0.3333 | lib/benchmark.js, lib/retrieval.js, benchmarks/suite.json |

## Savings By Source

- retrieval: 232969
- cache: 3546
- commandCompaction: 3509
- pinnedRules: 2286
- embeddings: 0
- baseline: 235255
- returned: 2286
