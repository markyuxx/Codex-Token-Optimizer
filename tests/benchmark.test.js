const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRuntime } = require("../runtime");
const { makeTempRepo } = require("./helpers");

test("benchmark writes JSON and Markdown reports with source-level savings", async () => {
  const root = makeTempRepo();
  const runtime = createRuntime({ rootDir: root, stateDirName: ".token-optimizer-test" });

  const result = await runtime.benchmark({ model: "gpt-4o-mini", budget: 500, smoke: true });

  assert.equal(result.regressions, 0);
  assert.ok(result.metrics.tokensBaseline > result.metrics.tokensOptimized);
  assert.ok(result.metrics.savingsBy.retrieval > 0);
  assert.ok(result.metrics.savingsBy.cache > 0);
  assert.ok(result.metrics.savingsBy.commandCompaction > 0);
  assert.ok(fs.existsSync(path.join(root, "reports", "benchmark-latest.json")));
  assert.ok(fs.existsSync(path.join(root, "reports", "benchmark-latest.md")));
});
