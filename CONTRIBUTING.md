# Contributing

This project prefers security and honesty over feature breadth.

Before opening a PR:

```bash
npm run lint
npm test
npm run bench:smoke
```

Rules for changes:

- Do not weaken safe mode defaults.
- Do not add broad default allowlist entries.
- Keep docs aligned with implementation.
- Mark heuristic token counts as estimates.
- Add tests for every behavior change.
- Keep command artifacts inside `.token-optimizer/artifacts`.

If a benchmark or security gate fails, fix the root cause or document the limitation. Do not adjust the docs to claim more than the code proves.
