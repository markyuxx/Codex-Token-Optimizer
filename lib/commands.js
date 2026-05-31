const { spawn } = require("node:child_process");

const DEFAULT_MAX_COMMAND_LENGTH = 1_000;
const DEFAULT_MAX_ARGS = 20;
const DEFAULT_MAX_ARG_LENGTH = 300;
const DEFAULT_MAX_STDIO_BYTES = 256 * 1024;
const DEFAULT_MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;

const DEFAULT_DANGEROUS_PATTERNS = [
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\b/i,
  /\bgit\s+push\b.*\s--force(?:-with-lease)?\b/i,
  /\brm\b/i,
  /\bdel\b/i,
  /\brmdir\b/i,
  /\bRemove-Item\b/i,
  /\bsudo\b/i,
  /\bformat\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bmkfs\b/i,
  /\bdd\b/i,
  /\bchmod\s+-R\b/i,
  /\bchown\s+-R\b/i,
  /\b(?:ssh|scp)\b/i,
  /^(?:env|printenv)(?:\s|$)/i,
  /^curl(?:\s|$)/i,
  /^wget(?:\s|$)/i,
  /\bcurl\b[\s\S]*\|\s*(?:sh|bash)\b/i,
  /\bwget\b[\s\S]*\|\s*(?:sh|bash)\b/i,
  /(?:^|[\\/\s])\.env(?:$|[\\/\s])/i,
  /(?:^|[\\/\s])(?:id_rsa|id_dsa|id_ed25519|\.ssh)(?:$|[\\/\s])/i,
  /\.(?:pem|key|p12|pfx)(?:\s|$)/i,
];

const DEFAULT_ALLOWLIST = [
  /^npm test$/,
  /^npm run test$/,
  /^npm run lint$/,
  /^npm run build$/,
  /^npm run check$/,
  /^npm run bench:smoke$/,
  /^node --version$/,
  /^npm --version$/,
  /^git status(?: --short)?$/,
  /^git diff(?: .*)?$/,
  /^git log(?: .*)?$/,
  /^ls(?: [A-Za-z0-9_./:@%+=,-]+)?$/,
  /^dir(?: [A-Za-z0-9_./:@%+=,-]+)?$/i,
];

const SHELL_SYNTAX_PATTERN = /(?:\|\||&&|[|<>;&`]|[$]\(|\r|\n|\(|\))/;

function shellQuote(arg) {
  const text = String(arg);
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function commandToString(parsed) {
  return [parsed.cmd, ...(parsed.args || [])].map(shellQuote).join(" ");
}

function splitCommand(command) {
  const input = String(command || "").trim();
  const parts = [];
  let current = "";
  let quote = null;
  let escaping = false;
  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (quote) throw new Error("Unclosed quote in command string.");
  if (escaping) current += "\\";
  if (current) parts.push(current);
  return parts;
}

function parseCommandInput(command) {
  if (typeof command === "object" && command && !Array.isArray(command)) {
    if (!command.cmd || typeof command.cmd !== "string") throw new Error("Command object must include a string cmd.");
    return {
      cmd: command.cmd,
      args: Array.isArray(command.args) ? command.args.map(String) : [],
      raw: commandToString({ cmd: command.cmd, args: command.args || [] }),
      inputKind: "object",
    };
  }
  const raw = String(command || "").trim();
  const parts = splitCommand(raw);
  if (!parts.length) throw new Error("Command is empty.");
  return { cmd: parts[0], args: parts.slice(1), raw, inputKind: "string" };
}

function hasShellSyntax(raw) {
  return SHELL_SYNTAX_PATTERN.test(String(raw || ""));
}

function isDangerous(parsed, patterns = DEFAULT_DANGEROUS_PATTERNS) {
  const raw = commandToString(parsed);
  return patterns.some((pattern) => pattern.test(raw));
}

function isShellWrapper(parsed) {
  const cmd = parsed.cmd.toLowerCase().replace(/\.exe$/i, "");
  const first = (parsed.args[0] || "").toLowerCase();
  return (
    ((cmd === "sh" || cmd === "bash" || cmd === "cmd") && ["/c", "-c"].includes(first)) ||
    ((cmd === "powershell" || cmd === "pwsh") && ["-command", "-c", "/c"].includes(first))
  );
}

function isInlineInterpreter(parsed) {
  const cmd = parsed.cmd.toLowerCase().replace(/\.exe$/i, "");
  if (!["node", "python", "python3", "py", "ruby", "perl"].includes(cmd)) return false;
  return parsed.args.some((arg) => arg === "-e" || arg === "-c");
}

function isAllowed(parsed, allowlist = DEFAULT_ALLOWLIST) {
  const raw = commandToString(parsed);
  return allowlist.some((entry) => {
    if (entry instanceof RegExp) return entry.test(raw);
    if (typeof entry === "function") return entry(parsed);
    return raw === String(entry);
  });
}

function buildSafeEnv(options = {}) {
  const base = {};
  const source = process.env;
  for (const key of ["PATH", "Path", "SystemRoot", "ComSpec", "PATHEXT", "HOME", "USERPROFILE", "TMP", "TEMP"]) {
    if (source[key]) base[key] = source[key];
  }
  return {
    ...base,
    ...(options.safeEnv || {}),
    ...(options.allowedEnv || {}),
  };
}

function validateSafePathArgs(parsed, options = {}) {
  const command = parsed.cmd.toLowerCase().replace(/\.exe$/i, "");
  const pathArgCommands = new Set(["ls", "dir"]);
  if (!pathArgCommands.has(command)) return null;
  const rootDir = options.rootDir || options.cwd;
  if (!rootDir) return null;
  const fs = require("node:fs");
  const path = require("node:path");
  const root = fs.realpathSync.native(path.resolve(rootDir));
  for (const arg of parsed.args || []) {
    if (String(arg).startsWith("-")) continue;
    const resolved = path.resolve(root, String(arg));
    let realTarget;
    try {
      realTarget = fs.realpathSync.native(resolved);
    } catch (error) {
      const parent = fs.realpathSync.native(path.dirname(resolved));
      realTarget = path.join(parent, path.basename(resolved));
    }
    const relative = path.relative(root, realTarget);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
      return `Command path argument escapes root: ${arg}`;
    }
  }
  return null;
}

function classifyCommand(parsed) {
  const command = commandToString(parsed);
  if (/\b(test|jest|vitest|mocha|node --test|npm run check)\b/i.test(command)) return "test-output";
  if (/\b(build|compile)\b/i.test(command)) return "build-output";
  if (/\bbench(mark)?\b/i.test(command)) return "benchmark-output";
  return "generic-output";
}

function sanitizeSecrets(text) {
  return String(text || "")
    .replace(/\b(SECRET(?:[_-]?TOKEN)?|TOKEN|API[_-]?KEY|PASSWORD|AUTHORIZATION|PRIVATE[_-]?KEY)\b\s*[:=]\s*[^\s]+/gi, "$1=[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9]{12,}\b/g, "sk-[REDACTED]");
}

function extractWarnings(lines) {
  return lines.filter((line) => /\bwarn(ing)?\b/i.test(line)).slice(0, 8);
}

function extractErrors(lines) {
  return lines.filter((line) => /\berror\b|\bfail(ed|ure)?\b|exception/i.test(line)).slice(0, 12);
}

function extractFailedTests(lines) {
  return lines.filter((line) => /(?:not ok|FAIL|✖|failed test|AssertionError)/i.test(line)).slice(0, 12);
}

function extractStackTraces(lines) {
  return lines.filter((line) => /^\s+at\s+|Traceback \(most recent call last\):/i.test(line)).slice(0, 12);
}

function extractFilesMentioned(lines) {
  const matches = [];
  const pattern = /(?:[A-Za-z]:\\[^\s:"<>|]+|(?:\.{1,2}[\\/])?[\w.-]+(?:[\\/][\w.-]+)+)(?::\d+)?/g;
  for (const line of lines) {
    for (const match of line.matchAll(pattern)) {
      matches.push(match[0].replace(/\\/g, "/"));
    }
  }
  return [...new Set(matches)].slice(0, 20);
}

function blockedResult(parsed, reason) {
  return {
    status: "blocked",
    reason,
    blockedReason: reason,
    command: parsed ? commandToString(parsed) : "",
    args: parsed?.args || [],
    parsed,
    exitCode: null,
    durationMs: 0,
    timedOut: false,
    allowed: false,
    stdout: "",
    stderr: "",
    stdoutPreview: "",
    stderrPreview: "",
    combined: "",
    lines: [],
    byteLength: 0,
    truncated: false,
    artifactTruncated: false,
    errors: [],
    warnings: [],
    failedTests: [],
    stackTraces: [],
    filesMentioned: [],
    fileReferences: [],
    summary: "",
    safeMode: true,
  };
}

function appendCapped(current, chunk, cap) {
  const next = current + chunk;
  if (Buffer.byteLength(next, "utf8") <= cap) return { value: next, truncated: false };
  const allowed = Math.max(cap - Buffer.byteLength(current, "utf8"), 0);
  return { value: current + Buffer.from(chunk).subarray(0, allowed).toString("utf8"), truncated: true };
}

async function runCommand(command, options = {}) {
  let parsed;
  try {
    parsed = parseCommandInput(command);
  } catch (error) {
    return blockedResult(null, error.message);
  }

  const safeMode = options.safeMode !== false && options.unsafe !== true;
  const raw = commandToString(parsed);
  const maxCommandLength = options.maxCommandLength || DEFAULT_MAX_COMMAND_LENGTH;
  const maxArgs = options.maxArgs || DEFAULT_MAX_ARGS;
  const maxArgLength = options.maxArgLength || DEFAULT_MAX_ARG_LENGTH;
  if (raw.length > maxCommandLength) return blockedResult(parsed, `Command exceeds max length of ${maxCommandLength}.`);
  if ((parsed.args || []).length > maxArgs) return blockedResult(parsed, `Command has too many arguments; maxArgs is ${maxArgs}.`);
  const longArg = (parsed.args || []).find((arg) => String(arg).length > maxArgLength);
  if (longArg) return blockedResult(parsed, `Command argument exceeds maxArgLength of ${maxArgLength}.`);

  if (safeMode) {
    if (parsed.inputKind === "string" && hasShellSyntax(parsed.raw)) return blockedResult(parsed, "Command rejected in safe mode because it contains shell syntax.");
    if (isShellWrapper(parsed)) return blockedResult(parsed, "Command rejected in safe mode because it uses a shell wrapper.");
    if (isInlineInterpreter(parsed)) return blockedResult(parsed, "Command rejected in safe mode because inline interpreter execution is blocked.");
    if (isDangerous(parsed, options.dangerousPatterns || DEFAULT_DANGEROUS_PATTERNS)) return blockedResult(parsed, "Command matched a dangerous command pattern.");
    if (!isAllowed(parsed, options.allowlist || DEFAULT_ALLOWLIST)) return blockedResult(parsed, "Command is not allowed by the safe-mode allowlist.");
    const pathArgError = validateSafePathArgs(parsed, options);
    if (pathArgError) return blockedResult(parsed, pathArgError);
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const maxStdoutBytes = options.maxStdoutBytes || options.maxBuffer || DEFAULT_MAX_STDIO_BYTES;
    const maxStderrBytes = options.maxStderrBytes || options.maxBuffer || DEFAULT_MAX_STDIO_BYTES;
    const maxArtifactBytes = options.maxArtifactBytes || DEFAULT_MAX_ARTIFACT_BYTES;
    const timeoutMs = options.timeoutMs || 30_000;
    let stdout = "";
    let stderr = "";
    let artifact = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let artifactTruncated = false;
    let timedOut = false;

    const child = spawn(parsed.cmd, parsed.args, {
      cwd: options.cwd,
      shell: !safeMode,
      windowsHide: true,
      env: safeMode ? buildSafeEnv(options) : options.env || process.env,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (data) => {
      const text = sanitizeSecrets(data.toString("utf8"));
      const out = appendCapped(stdout, text, maxStdoutBytes);
      stdout = out.value;
      stdoutTruncated ||= out.truncated;
      const art = appendCapped(artifact, text, maxArtifactBytes);
      artifact = art.value;
      artifactTruncated ||= art.truncated;
    });

    child.stderr.on("data", (data) => {
      const text = sanitizeSecrets(data.toString("utf8"));
      const out = appendCapped(stderr, text, maxStderrBytes);
      stderr = out.value;
      stderrTruncated ||= out.truncated;
      const art = appendCapped(artifact, text, maxArtifactBytes);
      artifact = art.value;
      artifactTruncated ||= art.truncated;
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      const sanitized = sanitizeSecrets(error.message);
      const lines = sanitized.split(/\r?\n/).filter(Boolean);
      resolve({
        status: "error",
        exitCode: 1,
        durationMs: Date.now() - startedAt,
        timedOut: false,
        allowed: !safeMode || isAllowed(parsed, options.allowlist || DEFAULT_ALLOWLIST),
        command: raw,
        args: parsed.args,
        parsed,
        classification: options.classify === false ? null : classifyCommand(parsed),
        stdout: "",
        stderr: sanitized,
        stdoutPreview: "",
        stderrPreview: sanitized,
        combined: sanitized,
        artifact: sanitized,
        lines,
        byteLength: Buffer.byteLength(sanitized, "utf8"),
        truncated: false,
        artifactTruncated: false,
        errors: extractErrors(lines),
        warnings: extractWarnings(lines),
        failedTests: extractFailedTests(lines),
        stackTraces: extractStackTraces(lines),
        filesMentioned: extractFilesMentioned(lines),
        fileReferences: extractFilesMentioned(lines),
        summary: sanitized,
        safeMode,
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const combined = [stdout, stderr].filter(Boolean).join("\n");
      const lines = combined.split(/\r?\n/).filter(Boolean);
      const byteLength = Buffer.byteLength(combined, "utf8");
      const maxLines = options.maxLines || 80;
      const maxBytes = options.maxBytes || 6 * 1024;
      const truncated = stdoutTruncated || stderrTruncated || lines.length > maxLines || byteLength > maxBytes;
      const sampleLines = truncated ? [...lines.slice(0, 30), "...", ...lines.slice(-15)] : lines;
      resolve({
        status: timedOut ? "timeout" : code === 0 ? "ok" : "error",
        exitCode: timedOut ? null : code,
        signal,
        durationMs: Date.now() - startedAt,
        timedOut,
        allowed: true,
        command: raw,
        args: parsed.args,
        parsed,
        classification: options.classify === false ? null : classifyCommand(parsed),
        stdout,
        stderr,
        stdoutPreview: sampleLines.filter((line) => stdout.includes(line)).join("\n") || stdout.slice(0, maxBytes),
        stderrPreview: stderr.split(/\r?\n/).filter(Boolean).slice(0, Math.min(maxLines, 20)).join("\n"),
        combined,
        artifact,
        lines,
        byteLength,
        truncated,
        artifactTruncated,
        errors: extractErrors(lines),
        warnings: extractWarnings(lines),
        failedTests: extractFailedTests(lines),
        stackTraces: extractStackTraces(lines),
        filesMentioned: extractFilesMentioned(lines),
        fileReferences: extractFilesMentioned(lines),
        summary: sampleLines.join("\n"),
        safeMode,
      });
    });
  });
}

module.exports = {
  DEFAULT_ALLOWLIST,
  DEFAULT_DANGEROUS_PATTERNS,
  commandToString,
  extractFilesMentioned,
  hasShellSyntax,
  isAllowed,
  isDangerous,
  parseCommandInput,
  runCommand,
  buildSafeEnv,
  sanitizeSecrets,
};
