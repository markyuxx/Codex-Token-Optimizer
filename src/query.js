const fs = require("fs");
const path = require("path");
const { getPaths } = require("./config");
const { scanRepo } = require("./scan");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadIndex(rootInput) {
  const paths = getPaths(rootInput);
  if (!fs.existsSync(paths.indexPath)) {
    throw new Error(`Index not found for ${paths.root}. Run "agent-index build" first.`);
  }
  return {
    paths,
    index: readJson(paths.indexPath),
    files: readJson(paths.filesPath),
    symbols: readJson(paths.symbolsPath),
    staleness: readJson(paths.stalenessPath)
  };
}

function scoreFile(file, terms) {
  const haystack = [
    file.path,
    file.summary,
    ...file.signals.map((signal) => `${signal.kind} ${signal.symbol || ""} ${signal.text}`)
  ].join(" ").toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function renderResults(title, files) {
  const output = [`# ${title}`, ""];
  for (const file of files) {
    output.push(`## ${file.path}`, `_${file.summary}_`);
    const signals = file.signals.slice(0, 12);
    if (!signals.length) output.push("- No high-signal lines indexed.");
    for (const signal of signals) {
      output.push(`- L${signal.line} [${signal.kind}] ${signal.text}`);
    }
    output.push("");
  }
  return output.join("\n").trim();
}

function search(rootInput, query, limit = 8) {
  const data = loadIndex(rootInput);
  const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  const ranked = data.files
    .map((file) => ({ file, score: scoreFile(file, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
    .slice(0, limit);
  return renderResults(`Search: ${query}`, ranked.map((entry) => entry.file));
}

function fileContext(rootInput, relPath, maxLines = 18) {
  const data = loadIndex(rootInput);
  const normalized = String(relPath || "").replace(/\\/g, "/");
  const file = data.files.find((entry) => entry.path === normalized)
    || data.files.find((entry) => entry.path.endsWith(normalized));
  if (!file) return `No indexed file matched ${relPath}`;
  return renderResults(`File context: ${file.path}`, [{ ...file, signals: file.signals.slice(0, maxLines) }]);
}

function symbolContext(rootInput, symbol) {
  const data = loadIndex(rootInput);
  const key = Object.keys(data.symbols).find((name) => name.toLowerCase() === String(symbol || "").toLowerCase());
  if (!key) return `No indexed symbol matched ${symbol}`;
  const refs = data.symbols[key].slice(0, 20);
  return [`# Symbol: ${key}`, "", ...refs.map((ref) => `- ${ref.path}:${ref.line} [${ref.kind}] ${ref.text}`)].join("\n");
}

function staleness(rootInput, pathsToCheck) {
  const data = loadIndex(rootInput);
  const current = scanRepo(data.paths.root).files;
  const currentMap = new Map(current.map((file) => [file.path, file]));
  const wanted = pathsToCheck && pathsToCheck.length
    ? pathsToCheck.map((item) => item.replace(/\\/g, "/"))
    : [...new Set([...Object.keys(data.staleness.files), ...current.map((file) => file.path)])];
  const stale = [];
  const fresh = [];

  for (const relPath of wanted) {
    const oldFile = data.staleness.files[relPath];
    const newFile = currentMap.get(relPath);
    if (!oldFile || !newFile || oldFile.hash !== newFile.hash || oldFile.size !== newFile.size) stale.push(relPath);
    else fresh.push(relPath);
  }

  return {
    generatedAt: data.staleness.generatedAt,
    freshCount: fresh.length,
    staleCount: stale.length,
    stale: stale.slice(0, 50)
  };
}

function summary(rootInput) {
  const data = loadIndex(rootInput);
  const stale = staleness(rootInput);
  return {
    root: data.paths.root,
    generatedAt: data.index.generatedAt,
    files: data.files.length,
    symbols: Object.keys(data.symbols).length,
    compression: data.index.compression,
    staleCount: stale.staleCount,
    contexts: data.index.contexts
  };
}

module.exports = { search, fileContext, symbolContext, staleness, summary, loadIndex };
