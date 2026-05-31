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
      model: flags.model || "gpt-4o-mini",
      provider: flags.provider || "openai",
      embedding: flags["embedding-provider"] ? { provider: flags["embedding-provider"], model: flags["embedding-model"] } : null,
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
      includeContent: flags.includeContent === true || flags.includeContent === "true" || flags["include-content"] === true || flags["include-content"] === "true",
      force: flags.force === true || flags.force === "true",
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "exec") {
    const execCommand = positional.slice(1).join(" ");
    const result = await runtime.runCommand(execCommand, {
      cwd: flags.cwd || process.cwd(),
      model: flags.model || "gpt-4o-mini",
      provider: flags.provider || "openai",
      classify: flags.classify !== "false",
    });
    console.log(JSON.stringify(result, null, 2));
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
