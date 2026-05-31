#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { createRuntime } = require("./runtime");

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      index += 1;
    }
  }
  return { positional, flags };
}

function truthy(value) {
  return value === true || value === "true" || value === "1" || value === "yes";
}

function parseList(value) {
  if (!value) return [];
  return String(value).split(",").map((entry) => entry.trim()).filter(Boolean);
}

function parseAllowlist(flags) {
  const entries = parseList(flags["allow-command"] || flags.allowlist);
  return entries.length ? entries.map((entry) => new RegExp(entry)) : undefined;
}

function printResult(value, flags = {}) {
  if (truthy(flags.json)) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (value && typeof value === "object" && "status" in value && "summary" in value) {
    if (value.safeMode === false) console.log("WARNING: UNSAFE MODE enabled. Command ran with shell semantics.");
    console.log(`status: ${value.status}`);
    if (value.blockedReason) console.log(`blockedReason: ${value.blockedReason}`);
    if (value.exitCode !== undefined) console.log(`exitCode: ${value.exitCode}`);
    if (value.durationMs !== undefined) console.log(`durationMs: ${value.durationMs}`);
    if (value.stdoutPreview) console.log(`stdout:\n${value.stdoutPreview}`);
    if (value.stderrPreview) console.log(`stderr:\n${value.stderrPreview}`);
    if (value.summary && !value.stdoutPreview && !value.stderrPreview) console.log(value.summary);
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

function parseExecArgs(argv) {
  const flags = {};
  const commandParts = [];
  const valueFlags = new Set([
    "cwd",
    "model",
    "provider",
    "allow-command",
    "allowlist",
    "max-tokens",
    "max-bytes",
    "max-lines",
    "max-stdout-bytes",
    "max-stderr-bytes",
    "max-artifact-bytes",
    "max-command-length",
    "max-args",
    "max-arg-length",
    "timeout",
  ]);
  const boolFlags = new Set(["safe-mode", "unsafe", "json"]);
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (valueFlags.has(value.replace(/^--/, ""))) {
      const key = value.slice(2);
      flags[key] = argv[index + 1];
      index += 1;
      continue;
    }
    if (boolFlags.has(value.replace(/^--/, ""))) {
      flags[value.slice(2)] = true;
      continue;
    }
    commandParts.push(value);
  }
  return { commandParts, flags };
}

async function main(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  const command = positional[0] || "build";
  const runtime = createRuntime({ rootDir: process.cwd() });

  if (command === "build") {
    const result = await runtime.buildIndex();
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "query" || command === "bundle") {
    const query = positional.slice(1).join(" ") || String(flags.query || "");
    const result = await runtime.retrieveContext(query, {
      budget: Number(flags.budget || 1200),
      maxTokens: Number(flags["max-tokens"] || flags.budget || 1200),
      model: flags.model || "gpt-4o-mini",
      provider: flags.provider || "openai",
      embedding: flags["embedding-provider"] ? { provider: flags["embedding-provider"], model: flags["embedding-model"] } : null,
      excludes: parseList(flags.excludes),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "read") {
    const targetPath = positional[1] || flags.path;
    const result = await runtime.readFileContext(targetPath, {
      model: flags.model || "gpt-4o-mini",
      provider: flags.provider || "openai",
      purpose: flags.purpose || "",
      includeContent: truthy(flags.includeContent) || truthy(flags["include-content"]),
      force: truthy(flags.force),
      maxBytes: flags["max-bytes"] ? Number(flags["max-bytes"]) : undefined,
      maxTokens: flags["max-tokens"] ? Number(flags["max-tokens"]) : undefined,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "exec") {
    const parsedExec = parseExecArgs(argv);
    const execFlags = { ...flags, ...parsedExec.flags };
    const execCommand = parsedExec.commandParts.join(" ");
    const result = await runtime.runCommand(execCommand, {
      cwd: execFlags.cwd || process.cwd(),
      model: execFlags.model || "gpt-4o-mini",
      provider: execFlags.provider || "openai",
      classify: execFlags.classify !== "false",
      safeMode: !truthy(execFlags.unsafe),
      unsafe: truthy(execFlags.unsafe),
      allowlist: parseAllowlist(execFlags),
      timeoutMs: execFlags.timeout ? Number(execFlags.timeout) : undefined,
      maxBytes: execFlags["max-bytes"] ? Number(execFlags["max-bytes"]) : undefined,
      maxStdoutBytes: execFlags["max-stdout-bytes"] ? Number(execFlags["max-stdout-bytes"]) : undefined,
      maxStderrBytes: execFlags["max-stderr-bytes"] ? Number(execFlags["max-stderr-bytes"]) : undefined,
      maxArtifactBytes: execFlags["max-artifact-bytes"] ? Number(execFlags["max-artifact-bytes"]) : undefined,
      maxCommandLength: execFlags["max-command-length"] ? Number(execFlags["max-command-length"]) : undefined,
      maxArgs: execFlags["max-args"] ? Number(execFlags["max-args"]) : undefined,
      maxArgLength: execFlags["max-arg-length"] ? Number(execFlags["max-arg-length"]) : undefined,
      maxLines: execFlags["max-lines"] ? Number(execFlags["max-lines"]) : undefined,
    });
    printResult(result, execFlags);
    return;
  }

  if (command === "tokens") {
    const filePath = flags.file ? path.resolve(process.cwd(), flags.file) : null;
    const text = filePath ? fs.readFileSync(filePath, "utf8") : positional.slice(1).join(" ") || String(flags.text || "");
    const result = await runtime.estimateTokens({
      model: flags.model || "gpt-4o-mini",
      provider: flags.provider || "openai",
      text,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "benchmark") {
    const result = await runtime.benchmark({
      budget: Number(flags.budget || 600),
      model: flags.model || "gpt-4o-mini",
      suitePath: flags.suite,
      smoke: truthy(flags.smoke),
      failOnRegression: truthy(flags["fail-on-regression"]),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "rules") {
    console.log(JSON.stringify(runtime.getPinnedRules(), null, 2));
    return;
  }

  if (command === "status") {
    console.log(JSON.stringify(runtime.indexStatus(), null, 2));
    return;
  }

  console.error(`Unknown command: ${command}`);
  process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = { main };
