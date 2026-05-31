const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_SKIP_DIRS = new Set([
  ".git",
  ".agent-index",
  ".token-optimizer",
  ".token-optimizer-test",
  ".claude-flow",
  ".swarm",
  ".cache",
  ".next",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "tmp",
  "temp",
]);
const DEFAULT_SKIP_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".ico",
  ".mp4",
  ".mov",
  ".zip",
  ".db",
  ".sqlite",
  ".sqlite-shm",
  ".sqlite-wal",
  ".exe",
  ".dll",
]);

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function shouldSkip(relPath, stats, options = {}) {
  const normalized = toPosix(relPath);
  const parts = normalized.split("/");
  const skipDirs = options.skipDirs || DEFAULT_SKIP_DIRS;
  const skipExts = options.skipExts || DEFAULT_SKIP_EXTS;
  if (parts.some((part) => skipDirs.has(part))) return true;
  if (parts.some((part) => part.startsWith(".agents.backup-"))) return true;
  if (skipExts.has(path.extname(normalized).toLowerCase())) return true;
  if (stats.size > (options.maxBytes || DEFAULT_MAX_BYTES)) return true;
  return false;
}

function readRepoFiles(rootDir, options = {}) {
  const files = [];
  const skipped = [];

  function walk(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const absPath = path.join(currentDir, entry.name);
      const relPath = toPosix(path.relative(rootDir, absPath));
      if (entry.isDirectory()) {
        if (shouldSkip(relPath, { size: 0 }, options)) {
          skipped.push({ path: relPath, reason: "directory" });
          continue;
        }
        walk(absPath);
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
      } catch (error) {
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
        text,
      });
    }
  }

  walk(rootDir);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, skipped };
}

function safeRelPath(rootDir, targetPath) {
  const resolved = path.resolve(rootDir, targetPath);
  const root = path.resolve(rootDir);
  if (!resolved.startsWith(root)) {
    throw new Error(`Path escapes root: ${targetPath}`);
  }
  return toPosix(path.relative(rootDir, resolved));
}

module.exports = {
  DEFAULT_MAX_BYTES,
  ensureDir,
  hashText,
  readJson,
  readRepoFiles,
  safeRelPath,
  toPosix,
  writeJson,
};
