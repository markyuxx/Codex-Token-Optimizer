const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_MAX_BYTES = 350 * 1024;

const SKIP_DIRS = new Set([
  ".git", ".agent-index", ".claude-flow", ".swarm", "node_modules",
  "dist", "build", "coverage", ".cache", ".next", "tmp", "temp"
]);

const SKIP_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".mp4", ".mov",
  ".zip", ".db", ".sqlite", ".sqlite-shm", ".sqlite-wal", ".exe", ".dll"
]);

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function shouldSkip(relPath, stats, options = {}) {
  const parts = toPosix(relPath).split("/");
  if (relPath === "AGENTS.md") return true;
  if (parts.some((part) => SKIP_DIRS.has(part))) return true;
  if (SKIP_EXTS.has(path.extname(relPath).toLowerCase())) return true;
  if (stats.size > (options.maxBytes || DEFAULT_MAX_BYTES)) return true;
  return false;
}

function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function scanRepo(root, options = {}) {
  const files = [];
  const skipped = [];

  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absPath = path.join(current, entry.name);
      const relPath = toPosix(path.relative(root, absPath));

      if (entry.isDirectory()) {
        if (!shouldSkip(relPath, { size: 0 }, options)) walk(absPath);
        else skipped.push({ path: relPath, reason: "directory" });
        continue;
      }

      if (!entry.isFile()) continue;
      const stats = fs.statSync(absPath);
      if (shouldSkip(relPath, stats, options)) {
        skipped.push({ path: relPath, reason: "file" });
        continue;
      }

      let text;
      try {
        text = fs.readFileSync(absPath, "utf8");
      } catch (_) {
        skipped.push({ path: relPath, reason: "read" });
        continue;
      }

      if (text.includes("\u0000")) {
        skipped.push({ path: relPath, reason: "binary" });
        continue;
      }

      files.push({
        path: relPath,
        absPath,
        ext: path.extname(relPath).toLowerCase(),
        size: stats.size,
        mtimeMs: Math.round(stats.mtimeMs),
        hash: hashText(text),
        text
      });
    }
  }

  walk(root);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, skipped };
}

module.exports = { scanRepo, hashText, toPosix };
