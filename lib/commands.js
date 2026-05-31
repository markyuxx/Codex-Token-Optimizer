const { exec } = require("node:child_process");
const { promisify } = require("node:util");

const execAsync = promisify(exec);

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

async function runCommand(command, options = {}) {
  const result = await execAsync(command, {
    cwd: options.cwd,
    windowsHide: true,
    maxBuffer: options.maxBuffer || 4 * 1024 * 1024,
  }).then(
    (value) => ({ ...value, exitCode: 0 }),
    (error) => ({
      stdout: error.stdout || "",
      stderr: error.stderr || error.message || "",
      exitCode: typeof error.code === "number" ? error.code : 1,
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
    summary: sampleLines.join("\n"),
  };
}

module.exports = { runCommand };
