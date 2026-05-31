# Token Optimizer Benchmark

Generated: 2026-05-31T17:55:04.351Z
Tasks: 5
Regressions: 0
Baseline tokens: 287585
Optimized tokens: 3937
Saved tokens: 283648
Savings ratio: 0.9863

| Task | Success | Saved | Recall | Precision | Budget | Paths |
| --- | --- | ---: | ---: | ---: | --- | --- |
| find token optimizer runtime | pass | 56387 | 1 | 0.5 | yes | runtime.js, mcp-server.js |
| find tokenization provider | pass | 57221 | 1 | 1 | yes | lib/tokenization.js |
| find safe command runner | pass | 56624 | 1 | 1 | yes | lib/commands.js |
| find cache repeated reads | pass | 56865 | 0.5 | 0.3333 | yes | lib/cache.js, lib/benchmark.js, CHANGELOG.md |
| avoid lockfile confusion | pass | 56551 | 1 | 0.3333 | yes | lib/retrieval.js, lib/benchmark.js, lib/commands.js |

## Savings By Source

- retrieval: 283648
- cache: 4679
- commandCompaction: 3509
- pinnedRules: 3937
- embeddings: 0
- baseline: 287585
- returned: 3937
