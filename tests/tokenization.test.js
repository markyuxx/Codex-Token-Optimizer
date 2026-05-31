const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntime } = require("../runtime");
const { makeTempRepo } = require("./helpers");

test("OpenAI text counts include exact metadata", async () => {
  const runtime = createRuntime({ rootDir: makeTempRepo(), stateDirName: ".token-optimizer-test" });

  const result = await runtime.estimateTokens({
    model: "gpt-4o-mini",
    provider: "openai",
    text: "hello world",
  });

  assert.equal(result.status, "supported");
  assert.equal(result.exact, true);
  assert.equal(result.accuracy, "exact-text");
  assert.equal(result.provider, "openai");
  assert.ok(result.tokenCount > 0);
});

test("OpenAI message counts are explicit structural estimates", async () => {
  const runtime = createRuntime({ rootDir: makeTempRepo(), stateDirName: ".token-optimizer-test" });

  const result = await runtime.estimateTokens({
    model: "gpt-4o-mini",
    provider: "openai",
    messages: [
      { role: "system", content: "Be concise." },
      { role: "user", content: "hello" },
    ],
  });

  assert.equal(result.status, "supported");
  assert.equal(result.exact, false);
  assert.equal(result.accuracy, "estimated-chat-structure");
  assert.match(result.warning, /provider-side counts may differ/i);
});

test("unknown model returns unsupported unless explicit fallback estimate is requested", async () => {
  const runtime = createRuntime({ rootDir: makeTempRepo(), stateDirName: ".token-optimizer-test" });

  const unsupported = await runtime.estimateTokens({
    model: "unknown-model",
    provider: "unknown",
    text: "hello world",
  });
  const fallback = await runtime.estimateTokens({
    model: "unknown-model",
    provider: "unknown",
    text: "hello world",
    allowEstimateFallback: true,
  });

  assert.equal(unsupported.status, "unsupported");
  assert.equal(unsupported.exact, false);
  assert.equal(fallback.status, "estimated");
  assert.equal(fallback.exact, false);
  assert.match(fallback.warning, /heuristic/i);
});
