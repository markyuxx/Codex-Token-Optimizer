const path = require("path");

function resolveRoot(rootInput) {
  return path.resolve(rootInput || process.env.AGENT_INDEX_ROOT || process.cwd());
}

function getPaths(rootInput) {
  const root = resolveRoot(rootInput);
  const indexDir = path.join(root, ".agent-index");
  return {
    root,
    indexDir,
    agentsPath: path.join(root, "AGENTS.md"),
    fullAgentsPath: path.join(indexDir, "AGENTS.full.md"),
    indexPath: path.join(indexDir, "index.json"),
    filesPath: path.join(indexDir, "files.json"),
    symbolsPath: path.join(indexDir, "symbols.json"),
    stalenessPath: path.join(indexDir, "staleness.json")
  };
}

module.exports = { resolveRoot, getPaths };
