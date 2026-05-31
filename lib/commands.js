const { exec } = require("node:child_process");
const { promisify } = require("node:util");

const execAsync = promisify(exec);

const DEFAULT_DANGEROUS_PATTERNS = [
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\b/i,
  /\brm\s+-rf\b/i,
  /\bRemove-Item\b.*\s-Recurse\b/i,
  /\bdel\s+\/[sq]\b/i,
  /\bformat\b/i,
  /\bshutdown\b/i,
];

function classifyCommand(command) {
  if (/\b(test|jest|vitest|mocha|node --test|npm run check)\b/i.test(command)) return "test-output";
  if (/\b(build|compile)\b/i.test(command)) return "build-output";
  return "generic-output";
}

function extractWarnings(lines) {
  return lines.filter((line) => /\bwarn(ing)?\b/i.test(line)).slice(0, 8);
}

function extractErrors(lines) {
  return lines.filter((line) => /\berror\b|\bfail(ed|ure)?\b|exception/i.test(line)).slice(0, 12);
}

function extractFilesMentioned(lines) {
  const matches = [];
  const pattern = /(?:[A-Za-z]:\\[^\s:"<>|]+|(?:\.{1,2}\/)?[\w.-]+(?:\/[\w.-]+)+)(?::\d+)?/g;
  for (const line of lines) {
    for (const match of line.matchAll(pattern)) {
      matches.push(match[0]);
    }
  }
  return [...new Set(matches)].slice(0, 20);
}

function isDangerous(command, patterns = DEFAULT_DANGEROUS_PATTERNS) {
  return patterns.some((pattern) => pattern.test(command));
}

function isAllowed(command, allowlist) {
  if (!allowlist || !allowlist.length) return true;
  return allowlist.some((entry) => {
    if (entry instanceof RegExp) return entry.test(command);
    return String(command).startsWith(String(entry));
  });
}

async function runCommand(command, options = {}) {
  if (options.safeMode !== false && isDangerous(command, options.dangerousPatterns || DEFAULT_DANGEROUS_PATTERNS)) {
    return {
      status: "blocked",
      reason: "Command matched a dangerous command pattern.",
      command,
      exitCode: null,
      stdout: "",
      stderr: "",
      combined: "",
      lines: [],
      byteLength: 0,
      truncated: false,
      errors: [],
      warnings: [],
      filesMentioned: [],
      summary: "",
    };
  }
  if (!isAllowed(command, options.allowlist)) {
    return {
      status: "blocked",
      reason: "Command is not allowed by the configured allowlist.",
      command,
      exitCode: null,
      stdout: "",
      stderr: "",
      combined: "",
      lines: [],
      byteLength: 0,
      truncated: false,
      errors: [],
      warnings: [],
      filesMentioned: [],
      summary: "",
    };
  }

  const result = await execAsync(command, {
    cwd: options.cwd,
    windowsHide: true,
    maxBuffer: options.maxBuffer || 4 * 1024 * 1024,
    timeout: options.timeoutMs || 30_000,
  }).then(
    (value) => ({ ...value, exitCode: 0 }),
    (error) => ({
      stdout: error.stdout || "",
      stderr: error.stderr || error.message || "",
      exitCode: typeof error.code === "number" ? error.code : 1,
      timedOut: Boolean(error.killed || error.signal === "SIGTERM" || /timed out|SIGTERM|ETIMEDOUT/i.test(error.message || "")),
    }),
  );

  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  const combined = [stdout, stderr].filter(Boolean).join("\n");
  const lines = combined.split(/\r?\n/).filter(Boolean);
  const byteLength = Buffer.byteLength(combined, "utf8");
  const maxLines = options.maxLines || 80;
  const maxBytes = options.maxBytes || 6 * 1024;
  const truncated = lines.length > maxLines || byteLength > maxBytes;
  const sampleLines = truncated ? [...lines.slice(0, 30), "...", ...lines.slice(-15)] : lines;

  return {
    status: result.timedOut ? "timeout" : result.exitCode === 0 ? "ok" : "error",
    exitCode: result.exitCode,
    command,
    classification: options.classify === false ? null : classifyCommand(command),
    stdout,
    stderr,
    combined,
    lines,
    byteLength,
    truncated,
    errors: extractErrors(lines),
    warnings: extractWarnings(lines),
    filesMentioned: extractFilesMentioned(lines),
    summary: sampleLines.join("\n"),
  };
}

module.exports = { runCommand, isDangerous, extractFilesMentioned };
