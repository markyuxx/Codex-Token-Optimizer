const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRuntime } = require("../runtime");
const { makeTempRepo } = require("./helpers");

test("readFileContext returns metadata-only unchanged reads with explicit savings", async () => {
  const root = makeTempRepo();
  const runtime = createRuntime({ rootDir: root, stateDirName: ".token-optimizer-test" });

  const first = await runtime.readFileContext("src/server.js", { purpose: "inspect server startup" });
  const second = await runtime.readFileContext("src/server.js", { purpose: "inspect server startup" });
  const forced = await runtime.readFileContext("src/server.js", { includeContent: true });

  assert.equal(first.path, "src/server.js");
  assert.equal(first.cacheStatus, "new");
  assert.equal(first.contentIncluded, true);
  assert.match(first.content, /startServer/);
  assert.equal(second.cacheHit, true);
  assert.equal(second.changed, false);
  assert.equal(second.contentIncluded, false);
  assert.equal(second.content, undefined);
  assert.ok(second.tokensSaved > 0);
  assert.equal(forced.contentIncluded, true);
});

test("retrieveContext enforces requested budget and reports stale warnings", async () => {
  const root = makeTempRepo();
  const runtime = createRuntime({ rootDir: root, stateDirName: ".token-optimizer-test" });

  await runtime.buildIndex();
  fs.appendFileSync(path.join(root, "src", "server.js"), "\n// stale mutation\n", "utf8");
  const bundle = await runtime.retrieveContext("function startServer helper", { budget: 160, model: "gpt-4o-mini" });

  assert.equal(bundle.requestedBudget, 160);
  assert.ok(bundle.usedTokens <= 160);
  assert.equal(bundle.overBudget, false);
  assert.ok(bundle.staleWarnings.some((warning) => warning.path === "src/server.js"));
  assert.ok(bundle.truncatedChunks >= 0);
  assert.ok(bundle.skippedChunks >= 0);
  assert.ok(bundle.metrics.retrievalTokensSaved > 0);
  assert.ok(bundle.metrics.pinnedRulesTokenCost > 0);
  assert.ok(bundle.metrics.totalTokensSaved >= bundle.metrics.retrievalTokensSaved);
  assert.ok(bundle.metrics.savingsPercent > 0);
});

test("retrieveContext prefers source symbol chunks over tests and lockfiles", async () => {
  const root = makeTempRepo();
  fs.writeFileSync(path.join(root, "package-lock.json"), "startServer helper ".repeat(300), "utf8");
  const runtime = createRuntime({ rootDir: root, stateDirName: ".token-optimizer-test" });

  await runtime.buildIndex();
  const bundle = await runtime.retrieveContext("startServer function helper", { budget: 300, model: "gpt-4o-mini" });

  assert.equal(bundle.items[0].path, "src/server.js");
  assert.notEqual(bundle.items[0].path, "package-lock.json");
});

test("retrieveContext tiny budgets terminate and mark truncation without hanging", async () => {
  const root = makeTempRepo();
  const runtime = createRuntime({ rootDir: root, stateDirName: ".token-optimizer-test" });

  await runtime.buildIndex();
  const bundle = await Promise.race([
    runtime.retrieveContext("startServer helper implementation detail", { budget: 45, model: "gpt-4o-mini" }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("retrieveContext timed out")), 3000)),
  ]);

  assert.ok(bundle.usedTokens <= 45);
  assert.equal(bundle.overBudget, false);
  assert.ok(bundle.truncatedChunks + bundle.skippedChunks > 0);
});

test("retrieveContext accounts for pinned rules and skips when rules exhaust budget", async () => {
  const root = makeTempRepo();
  const runtime = createRuntime({ rootDir: root, stateDirName: ".token-optimizer-test" });

  await runtime.buildIndex();
  const bundle = await runtime.retrieveContext("startServer helper implementation detail", { budget: 5, model: "gpt-4o-mini" });

  assert.equal(bundle.requestedBudget, 5);
  assert.ok(bundle.usedTokens <= 5);
  assert.equal(bundle.items.length, 0);
  assert.ok(bundle.skippedChunks > 0);
  assert.equal(bundle.overBudget, false);
});
