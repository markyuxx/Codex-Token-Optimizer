const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { build, check, benchmark } = require("../src/build");
const { search, fileContext, symbolContext, summary } = require("../src/query");

const fixtureRoot = path.join(__dirname, "fixtures", "sample-repo");
const indexDir = path.join(fixtureRoot, ".agent-index");

if (fs.existsSync(indexDir)) {
  fs.rmSync(indexDir, { recursive: true, force: true });
}

const buildResult = build(fixtureRoot);
assert.ok(buildResult.files >= 3, "expected indexed fixture files");

const searchOutput = search(fixtureRoot, "hello route");
assert.ok(searchOutput.includes("src/server.js"), "expected search to include server file");

const fileOutput = fileContext(fixtureRoot, "src/server.js");
assert.ok(fileOutput.includes("app.get"), "expected file context to show route");

const symbolOutput = symbolContext(fixtureRoot, "startServer");
assert.ok(symbolOutput.includes("startServer"), "expected symbol lookup to find function");

const benchmarkOutput = benchmark(fixtureRoot);
assert.ok(typeof benchmarkOutput.compactTokens === "number", "expected benchmark output");

const checkOutput = check(fixtureRoot);
assert.equal(checkOutput.staleCount, 0, "expected fresh index");

const summaryOutput = summary(fixtureRoot);
assert.equal(summaryOutput.staleCount, 0, "expected summary to report fresh index");

console.log("agent-index smoke tests passed");
