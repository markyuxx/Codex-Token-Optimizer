const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { safeRelPath } = require("../lib/fs-utils");

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
      ...Array.from({ length: 60 }, (_, index) => `// implementation detail ${index}: server startup context should not repeat in unchanged cache reads`),
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
  assert.equal(second.file.content, undefined);
  assert.ok(second.file.omitted);
  assert.ok(second.file.metadataTokenCost < first.file.tokenCost);
});

test("readFileContext can explicitly include unchanged content", async () => {
  const root = makeTempRepo();
  const { createRuntime } = require("../runtime");
  const runtime = createRuntime({ rootDir: root, stateDirName: ".token-optimizer-test" });

  await runtime.readFileContext("src/server.js");
  const repeated = await runtime.readFileContext("src/server.js", { includeContent: true });

  assert.equal(repeated.cache.status, "unchanged");
  assert.match(repeated.file.content, /startServer/);
});

test("safeRelPath rejects prefix, parent, absolute, and symlink escapes", () => {
  const root = makeTempRepo();
  const sibling = `${root}-sibling`;
  fs.mkdirSync(sibling, { recursive: true });
  fs.writeFileSync(path.join(sibling, "outside.js"), "module.exports = 1;", "utf8");

  assert.equal(safeRelPath(root, "src/server.js"), "src/server.js");
  assert.throws(() => safeRelPath(root, "..", "outside.js"), /escapes root/i);
  assert.throws(() => safeRelPath(root, path.join(sibling, "outside.js")), /escapes root/i);

  const linkPath = path.join(root, "linked-outside");
  try {
    fs.symlinkSync(sibling, linkPath, "dir");
    assert.throws(() => safeRelPath(root, "linked-outside/outside.js"), /escapes root/i);
  } catch (error) {
    if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
  }
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
    "node -e \"for (let i = 0; i < 220; i += 1) console.log('src/server.js:' + i + ' line-' + i)\"",
    { budget: 120, summarize: true, classify: true, cwd: root },
  );

  assert.equal(summary.exitCode, 0);
  assert.equal(summary.truncated, true);
  assert.ok(summary.artifactRef);
  assert.ok(summary.summary.length > 0);
  assert.ok(summary.tokensBefore > summary.tokenCost);
  assert.match(summary.filesMentioned.join("\n"), /src\/server\.js/);
});

test("runCommand blocks dangerous commands and enforces allowlists/timeouts", async () => {
  const root = makeTempRepo();
  const { createRuntime } = require("../runtime");
  const runtime = createRuntime({ rootDir: root, stateDirName: ".token-optimizer-test" });

  const blocked = await runtime.runCommand("git reset --hard", { cwd: root });
  assert.equal(blocked.status, "blocked");
  assert.match(blocked.reason, /dangerous/i);

  const denied = await runtime.runCommand("node -v", { cwd: root, allowlist: [/^npm\b/] });
  assert.equal(denied.status, "blocked");
  assert.match(denied.reason, /allowlist/i);

  const timedOut = await runtime.runCommand("node -e \"setTimeout(() => {}, 2000)\"", { cwd: root, timeoutMs: 50 });
  assert.equal(timedOut.status, "timeout");
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
  assert.equal(supported.accuracy, "exact-text");
  assert.equal(unsupported.status, "unsupported");
});

test("token counter marks OpenAI message counting as estimated structure, not exact text", async () => {
  const { createRuntime } = require("../runtime");
  const runtime = createRuntime({ rootDir: makeTempRepo(), stateDirName: ".token-optimizer-test" });

  const counted = await runtime.estimateTokens({
    model: "gpt-4o-mini",
    provider: "openai",
    messages: [
      { role: "system", content: "Be concise." },
      { role: "user", content: "hello" },
    ],
  });

  assert.equal(counted.provider, "openai");
  assert.equal(counted.accuracy, "estimated-chat-structure");
  assert.ok(counted.tokenCount > counted.contentTokenCount);
});

test("retrieveContext prefers symbol chunks over lockfiles and reports token savings", async () => {
  const root = makeTempRepo();
  fs.writeFileSync(path.join(root, "package-lock.json"), "helper helper helper ".repeat(200), "utf8");
  const { createRuntime } = require("../runtime");
  const runtime = createRuntime({ rootDir: root, stateDirName: ".token-optimizer-test" });

  await runtime.buildIndex();
  const bundle = await runtime.retrieveContext("function startServer helper", { budget: 300, model: "gpt-4o-mini" });

  assert.equal(bundle.items[0].path, "src/server.js");
  assert.ok(bundle.metrics.baselineTokens > bundle.metrics.optimizedTokens);
  assert.ok(bundle.metrics.tokensSaved > 0);
});

test("benchmark uses real token accounting and reports savings dimensions", async () => {
  const root = makeTempRepo();
  const { createRuntime } = require("../runtime");
  const runtime = createRuntime({ rootDir: root, stateDirName: ".token-optimizer-test" });

  const result = await runtime.benchmark({ model: "gpt-4o-mini", budget: 500 });

  assert.equal(result.regressions, 0);
  assert.ok(result.metrics.tokensBaseline > 0);
  assert.ok(result.metrics.tokensOptimized > 0);
  assert.equal(result.metrics.tokenizer, "js-tiktoken");
  assert.ok(result.tasks.every((task) => typeof task.recallAtK === "number"));
});
