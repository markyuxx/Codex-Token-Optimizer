# Codex-Token-Optimizer

`Codex-Token-Optimizer` is a local-only Node.js utility that turns a long `AGENTS.md` into a compact repo index and exposes deeper context through CLI and MCP tools.

The goal is simple: replace a heavy static instruction file with a short generated index plus on-demand retrieval of high-signal code context. In practice, that means dramatically lower prompt overhead while keeping deeper context one query away.

## Summary

This project is built for agentic coding workflows where you want:

- a compact `AGENTS.md` that is cheap to inject repeatedly
- deeper context available on demand instead of front-loading huge prompts
- repo-aware lookup for files, scripts, MCP config, routes, symbols, and staleness
- a local stdio MCP server with zero network dependency

The intended outcome is roughly the workflow described by the original spec:

- keep critical safety and project guidance in a short `AGENTS.md`
- move the full original file into `.agent-index/AGENTS.full.md`
- index the repo into bounded JSON sidecars
- query the details only when needed

## What it does

When you run `agent-index build` in a repository:

1. It reads the current `AGENTS.md`.
2. It stores the full original in `.agent-index/AGENTS.full.md`.
3. It scans the repo and extracts high-signal lines from code and config.
4. It writes a compact `AGENTS.md` with the most useful commands, contexts, and lookup instructions.
5. It writes sidecar files in `.agent-index/` for search, symbols, staleness, and summary data.

This creates a two-layer context system:

- `AGENTS.md`: tiny and cheap for repeated prompt injection
- `.agent-index/*`: dense local retrieval layer for detail on demand

## Implementation layout

The portable export keeps the implementation small and dependency-free:

- `scan.js`: walks the repo and skips obvious binary, cache, media, build, and generated folders
- `extract.js`: captures high-signal lines such as imports, exports, functions, classes, routes, scripts, MCP servers, and security-sensitive patterns
- `build.js`: writes the compact `AGENTS.md` plus `index.json`, `files.json`, `symbols.json`, `staleness.json`, and `AGENTS.full.md`
- `query.js`: returns compact Markdown for topic, file, symbol, and freshness queries
- `mcp-server.js`: exposes the local index over stdio as MCP tools only

## Repository layout

```text
.
├── bin/
│   └── agent-index.js
├── src/
│   ├── build.js
│   ├── config.js
│   ├── extract.js
│   ├── mcp-server.js
│   ├── query.js
│   └── scan.js
└── test/
    └── fixtures/
```

## Quick start

Clone the repo you want to index, then run the CLI from that repo root.

```bash
npm install
node ./bin/agent-index.js build
node ./bin/agent-index.js summary
node ./bin/agent-index.js search "auth routes"
```

You can also target another repo explicitly:

```bash
node ./bin/agent-index.js build --root ../my-project
node ./bin/agent-index.js search "payments webhook" --root ../my-project
```

## Commands

### `build`

Generate `.agent-index/` and replace `AGENTS.md` with a compact version.

```bash
node ./bin/agent-index.js build
```

### `check`

Fail if indexed files have changed since the last build.

```bash
node ./bin/agent-index.js check
```

### `benchmark`

Show original vs compact token counts.

```bash
node ./bin/agent-index.js benchmark
```

### `summary`

Return top-level stats for the current index.

```bash
node ./bin/agent-index.js summary
```

### `search`

Keyword search across indexed file summaries and signals.

```bash
node ./bin/agent-index.js search "event loop promise"
```

### `file`

Return the indexed high-signal lines for a specific file.

```bash
node ./bin/agent-index.js file src/server.js
```

### `symbol`

Find indexed references for a symbol.

```bash
node ./bin/agent-index.js symbol startServer
```

### `stale`

Check staleness for all indexed files or a subset.

```bash
node ./bin/agent-index.js stale
node ./bin/agent-index.js stale src/server.js package.json
```

### `mcp`

Run the MCP bridge over stdio so external clients can call the search tools.

```bash
node ./bin/agent-index.js mcp
```

## MCP interface

The MCP server exposes five local tools:

### `agent_index.search`

Input:

```json
{ "query": "auth routes", "limit": 8 }
```

Output:

- compact ranked context blocks
- file paths
- line numbers
- matched symbols and snippets

### `agent_index.file_context`

Input:

```json
{ "path": "src/server.js", "maxLines": 18 }
```

Output:

- imports
- exports
- functions and classes
- routes
- selected high-signal lines

### `agent_index.symbol_context`

Input:

```json
{ "symbol": "startServer" }
```

Output:

- indexed definitions and usages found by static scan

### `agent_index.staleness`

Input:

```json
{ "paths": ["src/server.js", "package.json"] }
```

Output:

- fresh or stale status from relative path, size, mtime, and sha256 hash

### `agent_index.summary`

Input:

```json
{}
```

Output:

- generated timestamp
- compression ratio
- stale count
- compact repo map

## Output files

After `build`, the target repository gets:

```text
.agent-index/
├── AGENTS.full.md
├── files.json
├── index.json
├── staleness.json
└── symbols.json
```

## Staleness and compression rules

- Staleness is computed from relative path, file size, `mtimeMs`, and `sha256` content hash.
- The index lives under `.agent-index/`.
- The full original instruction set is preserved before replacement.
- The compact file is intentionally biased toward critical rules, commands, repo map, and query instructions instead of exhaustive prose.

This export does not depend on AST parsers or external indexing services. The first version is deliberately regex-driven and built with Node.js built-ins only so it can be cloned and run with minimal setup churn.

## MCP integration

Example `.mcp.json` entry in the target repository:

```json
{
  "mcpServers": {
    "agent-index": {
      "command": "node",
      "args": [
        "path/to/agent-index/bin/agent-index.js",
        "mcp"
      ]
    }
  }
}
```

Run the MCP server from the repository you want to index, or set `AGENT_INDEX_ROOT`.

## Local-only design

- No network calls
- No hosted index
- No external database
- No dependency on proprietary services

The MCP bridge is stdio-only and meant to run next to the repo you are indexing.

## Recommended workflow

1. Keep your full human-written guidance in `AGENTS.md` while drafting.
2. Run `agent-index build` when the guidance becomes too large.
3. Commit the compact `AGENTS.md`.
4. Regenerate the index whenever the repo changes substantially.
5. Use `search`, `file`, `symbol`, and `summary` instead of stuffing large files into prompts.

## Caveats

- `build` rewrites `AGENTS.md` in the target repository.
- The search is intentionally simple and fast; it is not semantic retrieval.
- Large binary files and oversized files are skipped on purpose.
- The current version is optimized for local repos and agent workflows, not for hosted indexing.

## Development

```bash
npm test
```

The smoke test builds an index from a small fixture repo and verifies search, file lookup, symbol lookup, benchmark, and freshness.
