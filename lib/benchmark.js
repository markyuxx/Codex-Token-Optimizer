const fs = require("node:fs");
const path = require("node:path");

function defaultSuite() {
  return {
    tasks: [
      {
        name: "find token optimizer runtime",
        query: "createRuntime indexStatus staleness getPinnedRules",
        expectedPaths: ["runtime.js"],
      },
      {
        name: "find tokenization provider",
        query: "createTokenCounterRegistry js-tiktoken countMessages inferProvider",
        expectedPaths: ["lib/tokenization.js"],
      },
    ],
  };
}

async function runBenchmark(runtime, options = {}) {
  const suitePath = options.suitePath || path.join(runtime.baseDir, "tools", "token-optimizer", "benchmarks", "suite.json");
  const suite = fs.existsSync(suitePath) ? JSON.parse(fs.readFileSync(suitePath, "utf8")) : defaultSuite();
  await runtime.buildIndex();

  const tasks = [];
  for (const task of suite.tasks) {
    const optimized = await runtime.retrieveContext(task.query, {
      budget: options.budget || 600,
      model: options.model || "gpt-4o-mini",
    });
    const rawBaselineItems = runtime.currentIndex.files
      .filter((file) => JSON.stringify(file).toLowerCase().includes(task.query.toLowerCase().split(/\s+/)[0]))
      .slice(0, 8);

    const optimizedPaths = optimized.items.map((item) => item.path);
    const baselinePaths = rawBaselineItems.map((item) => item.path);
    const expected = task.expectedPaths || [];
    const optimizedHit = expected.some((candidate) => optimizedPaths.some((entry) => entry === candidate || entry.endsWith(candidate)));
    const baselineHit = expected.some((candidate) => baselinePaths.some((entry) => entry === candidate || entry.endsWith(candidate)));

    tasks.push({
      name: task.name,
      query: task.query,
      optimized: {
        tokenCost: optimized.tokenCost,
        paths: optimizedPaths,
        hit: optimizedHit,
      },
      baseline: {
        tokenCost: rawBaselineItems.reduce((sum, item) => sum + item.summary.length + item.path.length, 0),
        paths: baselinePaths,
        hit: baselineHit,
      },
      success: optimizedHit ? "pass" : "regression",
      modelEvaluation: "unsupported-without-external-evaluator",
    });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    taskCount: tasks.length,
    regressions: tasks.filter((task) => task.success !== "pass").length,
    tasks,
  };
  runtime.writeState("benchmark-last.json", summary);
  return summary;
}

module.exports = { runBenchmark };
