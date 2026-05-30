const path = require("path");

const SIGNAL_PATTERNS = [
  ["import", /^\s*(import\s.+from\s|const\s+\w+.*=\s*require\(|require\()/],
  ["export", /^\s*(module\.exports|exports\.|export\s+)/],
  ["function", /^\s*(async\s+)?function\s+([A-Za-z0-9_$]+)|^\s*(const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(async\s*)?(\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/],
  ["class", /^\s*class\s+([A-Za-z0-9_$]+)/],
  ["route", /\b(app|router)\.(get|post|put|patch|delete|use)\s*\(/],
  ["server", /\b(createServer|listen)\s*\(/],
  ["api-call", /\b(fetch|axios|request|db\.query|execute|invoke|spawn|exec)\s*\(/],
  ["filesystem", /\bfs\.(readFileSync|writeFileSync|readdirSync|statSync|existsSync|mkdirSync)\s*\(/],
  ["security", /\b(API_KEY|SECRET|TOKEN|PASSWORD|process\.env|eval|Function|innerHTML)\b/i],
  ["mcp", /\b(mcpServers|tools\/call|tools\/list|jsonrpc|Content-Length)\b/]
];

function normalizeLine(line) {
  return line.trim().replace(/\s+/g, " ").slice(0, 220);
}

function symbolFrom(kind, line) {
  const patterns = [
    /function\s+([A-Za-z0-9_$]+)/,
    /class\s+([A-Za-z0-9_$]+)/,
    /(const|let|var)\s+([A-Za-z0-9_$]+)\s*=/,
    /exports\.([A-Za-z0-9_$]+)/,
    /module\.exports\s*=\s*([A-Za-z0-9_$]+)/
  ];
  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (!match) continue;
    return match[2] || match[1];
  }
  if (kind === "route") {
    const route = line.match(/\.(get|post|put|patch|delete|use)\s*\(\s*["'`]([^"'`]+)/);
    if (route) return `${route[1].toUpperCase()} ${route[2]}`;
  }
  return null;
}

function summarizePath(relPath) {
  const parts = relPath.split("/");
  if (relPath === "package.json") return "npm scripts and package metadata";
  if (relPath === ".mcp.json") return "MCP server configuration";
  if (parts.includes("src")) return "source file";
  if (parts.includes("docs")) return "documentation";
  if (parts.includes("tools")) return "tooling script";
  return `${path.extname(relPath).slice(1) || "text"} file`;
}

function extractFile(file) {
  const lines = file.text.split(/\r?\n/);
  const signals = [];

  lines.forEach((line, index) => {
    for (const [kind, pattern] of SIGNAL_PATTERNS) {
      if (!pattern.test(line)) continue;
      const text = normalizeLine(line);
      if (!text) continue;
      signals.push({ kind, line: index + 1, text, symbol: symbolFrom(kind, line) });
      break;
    }
  });

  if (file.path === "package.json") extractPackage(file, signals);
  if (file.path === ".mcp.json") extractMcp(file, signals);

  return {
    path: file.path,
    ext: file.ext,
    size: file.size,
    mtimeMs: file.mtimeMs,
    hash: file.hash,
    summary: summarizePath(file.path),
    signals: signals.slice(0, 40)
  };
}

function extractPackage(file, signals) {
  try {
    const pkg = JSON.parse(file.text);
    for (const [name, command] of Object.entries(pkg.scripts || {})) {
      signals.unshift({ kind: "script", line: 1, text: `npm run ${name}: ${command}`, symbol: `script:${name}` });
    }
  } catch (_) {}
}

function extractMcp(file, signals) {
  try {
    const config = JSON.parse(file.text);
    for (const [name, server] of Object.entries(config.mcpServers || {})) {
      signals.unshift({ kind: "mcp-server", line: 1, text: `${name}: ${server.command} ${(server.args || []).join(" ")}`, symbol: `mcp:${name}` });
    }
  } catch (_) {}
}

function buildSymbols(files) {
  const symbols = {};
  for (const file of files) {
    for (const signal of file.signals) {
      if (!signal.symbol) continue;
      if (!symbols[signal.symbol]) symbols[signal.symbol] = [];
      symbols[signal.symbol].push({ path: file.path, line: signal.line, kind: signal.kind, text: signal.text });
    }
  }
  return symbols;
}

module.exports = { extractFile, buildSymbols };
