const fs = require("node:fs");
const path = require("node:path");

function defaultSuite(index) {
  const hasRuntime = (index?.files || []).some((file) => file.path === "runtime.js" || file.path.endsWith("/runtime.js"));
  if (!hasRuntime) {
    return {
      tasks: [
        { name: "function lookup", query: "startServer http createServer helper", expectedPaths: ["src/server.js"] },
        { name: "dependency lookup", query: "helper toUpperCase module exports", expectedPaths: ["src/util.js"] },
        { name: "noisy query", query: "please ignore package lock noise and find helper implementation source", expectedPaths: ["src/util.js"] },
        { name: "multi-file context", query: "server imports util helper startServer", expectedPaths: ["src/server.js", "src/util.js"] },
      ],
    };
  }
  return {
    tasks: [
      { name: "runtime lookup", query: "createRuntime indexStatus staleness getPinnedRules", expectedPaths: ["runtime.js"] },
      { name: "tokenization provider", query: "createTokenCounterRegistry js-tiktoken countMessages inferProvider", expectedPaths: ["lib/tokenization.js"] },
      { name: "safe command runner", query: "safeMode spawn allowlist dangerous shell syntax runCommand", expectedPaths: ["lib/commands.js"] },
      { name: "cache repeated reads", query: "rememberFileRead metadata only unchanged cache tokensSaved", expectedPaths: ["lib/cache.js", "runtime.js"] },
      { name: "noisy lockfile confusion", query: "package lock should not dominate retrieval command symbols", expectedPaths: ["lib/retrieval.js"] },
    ],
  };
}

function tokenCount(result, fallback = 0) {
  return result.status === "supported" || result.status === "estimated" ? result.tokenCount : fallback;
}

function writeReports(runtime, summary) {
  const reportsDir = path.join(runtime.baseDir, "reports");
  fs.mkdirSync(reportsDir, { recursive: true });
  const jsonPath = path.join(reportsDir, "benchmark-latest.json");
  const mdPath = path.join(reportsDir, "benchmark-latest.md");
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), "utf8");
  fs.writeFileSync(
    mdPath,
    [
      "# Token Optimizer Benchmark",
      "",
      `Generated: ${summary.generatedAt}`,
      `Tasks: ${summary.taskCount}`,
      `Regressions: ${summary.regressions}`,
      `Baseline tokens: ${summary.metrics.tokensBaseline}`,
      `Optimized tokens: ${summary.metrics.tokensOptimized}`,
      `Saved tokens: ${summary.metrics.tokensSaved}`,
      `Savings ratio: ${summary.metrics.savingsRatio}`,
      "",
      "| Task | Success | Saved | Recall | Precision | Paths |",
      "| --- | --- | ---: | ---: | ---: | --- |",
      ...summary.tasks.map((task) => `| ${task.name} | ${task.success} | ${task.tokensSaved} | ${task.recallAtK} | ${task.precisionAtK} | ${task.optimized.paths.join(", ")} |`),
      "",
      "## Savings By Source",
      "",
      ...Object.entries(summary.metrics.savingsBy).map(([key, value]) => `- ${key}: ${value}`),
      "",
    ].join("\n"),
    "utf8",
  );
  return {
    jsonPath: path.relative(runtime.baseDir, jsonPath).replace(/\\/g, "/"),
    mdPath: path.relative(runtime.baseDir, mdPath).replace(/\\/g, "/"),
  };
}

async function measureCache(runtime, model, provider) {
  const candidate = runtime.currentIndex.files.find((file) => file.path === "runtime.js")
    || runtime.currentIndex.files.find((file) => /^src\//.test(file.path))
    || runtime.currentIndex.files[0];
  if (!candidate) return { tokensSaved: 0, path: null };
  await runtime.readFileContext(candidate.path, { model, provider, includeContent: true });
  const repeated = await runtime.readFileContext(candidate.path, { model, provider });
  return { tokensSaved: repeated.tokensSaved || 0, path: candidate.path };
}

async function measureCommandCompaction(runtime, model, provider) {
  const fixture = path.join(runtime.baseDir, "benchmarks", "fixtures", "long-log.js");
  if (!fs.existsSync(fixture)) return { tokensSaved: 0, status: "missing-fixture" };
  const result = await runtime.runCommand(
    { cmd: "node", args: ["benchmarks/fixtures/long-log.js"] },
    {
      model,
      provider,
      allowlist: [/^node benchmarks[\/\\]fixtures[\/\\]long-log\.js$/],
      maxBytes: 900,
      maxLines: 40,
    },
  );
  return {
    status: result.status,
    tokensSaved: result.metrics?.commandCompactionTokensSaved || 0,
    artifactRef: result.artifactRef,
  };
}

async function runBenchmark(runtime, options = {}) {
  const suitePath = options.suitePath || path.join(runtime.baseDir, "benchmarks", "suite.json");
  const startedAt = Date.now();
  const buildStartedAt = Date.now();
  await runtime.buildIndex({ scanOptions: { excludePatterns: options.excludes || [] } });
  const indexTimeMs = Date.now() - buildStartedAt;
  const suite = fs.existsSync(suitePath) ? JSON.parse(fs.readFileSync(suitePath, "utf8")) : defaultSuite(runtime.currentIndex);
  const model = options.model || "gpt-4o-mini";
  const provider = options.provider || "openai";
  const baselineText = runtime.currentIndex.chunks.map((chunk) => chunk.text).join("\n");
  const baselineTokenResult = await runtime.estimateTokens({ model, provider, text: baselineText });
  const baselineTokenCost = tokenCount(baselineTokenResult);

  const tasks = [];
  for (const task of suite.tasks) {
    const queryStartedAt = Date.now();
    const optimized = await runtime.retrieveContext(task.query, {
      budget: options.budget || 600,
      model,
      provider,
      skipMetrics: true,
    });
    const queryTimeMs = Date.now() - queryStartedAt;
    const optimizedText = optimized.items.map((item) => item.excerpt).join("\n");
    const optimizedTokenResult = await runtime.estimateTokens({ model, provider, text: optimizedText });

    const optimizedPaths = optimized.items.map((item) => item.path);
    const baselinePaths = runtime.currentIndex.files.map((item) => item.path);
    const expected = task.expectedPaths || [];
    const optimizedHit = expected.some((candidate) => optimizedPaths.some((entry) => entry === candidate || entry.endsWith(candidate)));
    const baselineHit = expected.some((candidate) => baselinePaths.some((entry) => entry === candidate || entry.endsWith(candidate)));
    const truePositiveCount = optimizedPaths.filter((entry) => expected.some((candidate) => entry === candidate || entry.endsWith(candidate))).length;
    const precisionAtK = optimizedPaths.length ? truePositiveCount / optimizedPaths.length : 0;
    const recallAtK = expected.length ? Math.min(truePositiveCount / expected.length, 1) : 0;
    const tokensBaseline = baselineTokenCost;
    const tokensOptimized = tokenCount(optimizedTokenResult, optimized.usedTokens || optimized.tokenCost || 0);

    tasks.push({
      name: task.name,
      query: task.query,
      optimized: {
        tokenCost: tokensOptimized,
        paths: optimizedPaths,
        hit: optimizedHit,
        overBudget: optimized.overBudget,
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
      success: optimizedHit && !optimized.overBudget ? "pass" : "regression",
      modelEvaluation: "unsupported-without-external-evaluator",
    });
  }

  const cacheProbe = await measureCache(runtime, model, provider);
  const commandProbe = await measureCommandCompaction(runtime, model, provider);
  const tokensBaseline = tasks.reduce((sum, task) => sum + task.tokensBaseline, 0);
  const retrievalOptimized = tasks.reduce((sum, task) => sum + task.tokensOptimized, 0);
  const tokensOptimized = retrievalOptimized;
  const retrievalSavings = Math.max(tokensBaseline - retrievalOptimized, 0);
  const failedThresholds = [];
  if (tasks.some((task) => task.success !== "pass")) failedThresholds.push("critical-retrieval-miss");
  if (retrievalSavings <= 0) failedThresholds.push("retrieval-savings-not-positive");
  if (cacheProbe.tokensSaved <= 0) failedThresholds.push("cache-savings-not-positive");
  if (commandProbe.tokensSaved <= 0) failedThresholds.push("command-compaction-savings-not-positive");

  const summary = {
    generatedAt: new Date().toISOString(),
    taskCount: tasks.length,
    regressions: tasks.filter((task) => task.success !== "pass").length,
    maturity: failedThresholds.length ? "beta tecnica" : "production partial",
    failedThresholds,
    probes: {
      cache: cacheProbe,
      commandCompaction: commandProbe,
    },
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
        retrieval: retrievalSavings,
        cache: cacheProbe.tokensSaved,
        commandCompaction: commandProbe.tokensSaved,
        pinnedRules: tasks.reduce((sum, task) => sum + (task.optimized.tokenCost || 0), 0),
        embeddings: 0,
        baseline: tokensBaseline,
        returned: tokensOptimized,
      },
    },
    tasks,
  };
  const reports = writeReports(runtime, summary);
  summary.reports = reports;
  runtime.writeState("benchmark-last.json", summary);
  if (options.failOnRegression && failedThresholds.length) {
    const error = new Error(`Benchmark thresholds failed: ${failedThresholds.join(", ")}`);
    error.summary = summary;
    throw error;
  }
  return summary;
}

module.exports = { runBenchmark };
