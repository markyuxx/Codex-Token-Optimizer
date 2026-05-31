const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function makeTempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-optimizer-"));
  fs.writeFileSync(
    path.join(root, "AGENTS.md"),
    [
      "# Demo Repo",
      "",
      "- Never commit secrets.",
      "- Validate all input paths.",
      "- Query the index before broad reads.",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "server.js"),
    [
      "const http = require('http');",
      "const { helper } = require('./util');",
      "",
      "function startServer() {",
      "  return http.createServer((req, res) => {",
      "    res.end(helper('ok'));",
      "  });",
      "}",
      "",
      "module.exports = { startServer };",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "src", "util.js"),
    [
      "function helper(value) {",
      "  return value.toUpperCase();",
      "}",
      "",
      "module.exports = { helper };",
      "",
    ].join("\n"),
    "utf8",
  );
  return root;
}

test("buildIndex captures symbols and readFileContext caches repeated reads", async () => {
  const root = makeTempRepo();
  const { createRuntime } = require("../runtime");
  const runtime = createRuntime({ rootDir: root, stateDirName: ".token-optimizer-test" });

  await runtime.buildIndex();

  const first = await runtime.readFileContext("src/server.js", { budget: 500, purpose: "inspect server startup" });
  const second = await runtime.readFileContext("src/server.js", { budget: 500, purpose: "inspect server startup" });

  assert.equal(first.file.path, "src/server.js");
  assert.match(first.file.content, /startServer/);
  assert.equal(second.cache.status, "unchanged");
  assert.equal(second.cache.ref, first.cache.ref);
});

test("retrieveContext returns a token-budgeted bundle with pinned rules", async () => {
  const root = makeTempRepo();
  const { createRuntime } = require("../runtime");
  const runtime = createRuntime({ rootDir: root, stateDirName: ".token-optimizer-test" });

  await runtime.buildIndex();
  const bundle = await runtime.retrieveContext("server helper startup", { budget: 120, model: "gpt-4o-mini" });

  assert.ok(bundle.rules.length >= 2);
  assert.equal(bundle.items[0].path, "src/server.js");
  assert.ok(bundle.tokenCost > 0);
  assert.equal(bundle.truncated, false);
});

test("runCommand summarizes oversized command output and stores an artifact reference", async () => {
  const root = makeTempRepo();
  const { createRuntime } = require("../runtime");
  const runtime = createRuntime({ rootDir: root, stateDirName: ".token-optimizer-test" });

  const summary = await runtime.runCommand(
    "node -e \"for (let i = 0; i < 220; i += 1) console.log('line-' + i)\"",
    { budget: 120, summarize: true, classify: true, cwd: root },
  );

  assert.equal(summary.exitCode, 0);
  assert.equal(summary.truncated, true);
  assert.ok(summary.artifactRef);
  assert.ok(summary.summary.length > 0);
});

test("token counter reports support for OpenAI models and unsupported models explicitly", async () => {
  const { createRuntime } = require("../runtime");
  const runtime = createRuntime({ rootDir: makeTempRepo(), stateDirName: ".token-optimizer-test" });

  const supported = await runtime.estimateTokens({
    model: "gpt-4o-mini",
    provider: "openai",
    text: "hello world",
  });
  const unsupported = await runtime.estimateTokens({
    model: "unknown-model",
    provider: "unknown",
    text: "hello world",
  });

  assert.equal(supported.provider, "openai");
  assert.ok(supported.tokenCount > 0);
  assert.equal(unsupported.status, "unsupported");
});
