const fs = require("node:fs");
const path = require("node:path");

function defaultSuite(index) {
  const hasRuntime = (index?.files || []).some((file) => file.path === "runtime.js" || file.path.endsWith("/runtime.js"));
  if (!hasRuntime) {
    return {
      tasks: [
        {
          name: "find server function",
          query: "startServer http createServer helper",
          expectedPaths: ["src/server.js"],
        },
        {
          name: "find helper dependency",
          query: "helper toUpperCase module exports",
          expectedPaths: ["src/util.js"],
        },
      ],
    };
  }
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
  const suitePath = options.suitePath || path.join(runtime.baseDir, "benchmarks", "suite.json");
  const startedAt = Date.now();
  const buildStartedAt = Date.now();
  await runtime.buildIndex();
  const indexTimeMs = Date.now() - buildStartedAt;
  const suite = fs.existsSync(suitePath) ? JSON.parse(fs.readFileSync(suitePath, "utf8")) : defaultSuite(runtime.currentIndex);

  const tasks = [];
  for (const task of suite.tasks) {
    const queryStartedAt = Date.now();
    const optimized = await runtime.retrieveContext(task.query, {
      budget: options.budget || 600,
      model: options.model || "gpt-4o-mini",
    });
    const queryTimeMs = Date.now() - queryStartedAt;
    const baselineText = runtime.currentIndex.chunks.map((chunk) => chunk.text).join("\n");
    const baselineTokenResult = await runtime.estimateTokens({
      model: options.model || "gpt-4o-mini",
      provider: options.provider || "openai",
      text: baselineText,
    });
    const optimizedText = optimized.items.map((item) => item.excerpt).join("\n");
    const optimizedTokenResult = await runtime.estimateTokens({
      model: options.model || "gpt-4o-mini",
      provider: options.provider || "openai",
      text: optimizedText,
    });

    const optimizedPaths = optimized.items.map((item) => item.path);
    const baselinePaths = runtime.currentIndex.files.map((item) => item.path);
    const expected = task.expectedPaths || [];
    const optimizedHit = expected.some((candidate) => optimizedPaths.some((entry) => entry === candidate || entry.endsWith(candidate)));
    const baselineHit = expected.some((candidate) => baselinePaths.some((entry) => entry === candidate || entry.endsWith(candidate)));
    const truePositiveCount = optimizedPaths.filter((entry) => expected.some((candidate) => entry === candidate || entry.endsWith(candidate))).length;
    const precisionAtK = optimizedPaths.length ? truePositiveCount / optimizedPaths.length : 0;
    const recallAtK = expected.length ? truePositiveCount / expected.length : 0;
    const tokensBaseline = baselineTokenResult.status === "supported" ? baselineTokenResult.tokenCount : 0;
    const tokensOptimized = optimizedTokenResult.status === "supported" ? optimizedTokenResult.tokenCount : optimized.tokenCost;

    tasks.push({
      name: task.name,
      query: task.query,
      optimized: {
        tokenCost: tokensOptimized,
        paths: optimizedPaths,
        hit: optimizedHit,
      },
      baseline: {
        tokenCost: tokensBaseline,
        paths: baselinePaths,
        hit: baselineHit,
      },
      tokensBaseline,
      tokensOptimized,
      tokensSaved: Math.max(tokensBaseline - tokensOptimized, 0),
      savingsRatio: tokensBaseline ? Number(((tokensBaseline - tokensOptimized) / tokensBaseline).toFixed(4)) : 0,
      precisionAtK: Number(precisionAtK.toFixed(4)),
      recallAtK: Number(recallAtK.toFixed(4)),
      queryTimeMs,
      embeddingCost: 0,
      success: optimizedHit ? "pass" : "regression",
      modelEvaluation: "unsupported-without-external-evaluator",
    });
  }

  const tokensBaseline = tasks.reduce((sum, task) => sum + task.tokensBaseline, 0);
  const tokensOptimized = tasks.reduce((sum, task) => sum + task.tokensOptimized, 0);
  const summary = {
    generatedAt: new Date().toISOString(),
    taskCount: tasks.length,
    regressions: tasks.filter((task) => task.success !== "pass").length,
    metrics: {
      tokenizer: "js-tiktoken",
      tokensBaseline,
      tokensOptimized,
      tokensSaved: Math.max(tokensBaseline - tokensOptimized, 0),
      savingsRatio: tokensBaseline ? Number(((tokensBaseline - tokensOptimized) / tokensBaseline).toFixed(4)) : 0,
      averageRecallAtK: tasks.length ? Number((tasks.reduce((sum, task) => sum + task.recallAtK, 0) / tasks.length).toFixed(4)) : 0,
      averagePrecisionAtK: tasks.length ? Number((tasks.reduce((sum, task) => sum + task.precisionAtK, 0) / tasks.length).toFixed(4)) : 0,
      embeddingCost: 0,
      indexTimeMs,
      totalTimeMs: Date.now() - startedAt,
      indexBytes: Buffer.byteLength(JSON.stringify(runtime.currentIndex.files)) + Buffer.byteLength(JSON.stringify(runtime.currentIndex.chunks)),
      savingsBy: {
        retrieval: Math.max(tokensBaseline - tokensOptimized, 0),
        cache: 0,
        commandCompaction: 0,
        pinnedRules: 0,
        embeddings: 0,
      },
    },
    tasks,
  };
  runtime.writeState("benchmark-last.json", summary);
  return summary;
}

module.exports = { runBenchmark };
