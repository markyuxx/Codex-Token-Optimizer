const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntime } = require("../runtime");
const { makeTempRepo } = require("./helpers");

test("safe mode executes preferred command objects without a shell", async () => {
  const root = makeTempRepo();
  const runtime = createRuntime({ rootDir: root, stateDirName: ".token-optimizer-test" });

  const result = await runtime.runCommand({ cmd: "node", args: ["--version"] }, { cwd: root });

  assert.equal(result.status, "ok");
  assert.equal(result.exitCode, 0);
  assert.equal(result.safeMode, true);
  assert.match(result.summary, /^v\d+\./);
});

test("safe mode rejects shell syntax and inline interpreters", async () => {
  const root = makeTempRepo();
  const runtime = createRuntime({ rootDir: root, stateDirName: ".token-optimizer-test" });

  const pipe = await runtime.runCommand("node --version | more", { cwd: root });
  const inlineNode = await runtime.runCommand({ cmd: "node", args: ["-e", "console.log(1)"] }, { cwd: root });
  const powershell = await runtime.runCommand({ cmd: "powershell", args: ["-Command", "Write-Output ok"] }, { cwd: root });

  assert.equal(pipe.status, "blocked");
  assert.match(pipe.reason, /shell syntax/i);
  assert.equal(inlineNode.status, "blocked");
  assert.match(inlineNode.reason, /inline interpreter/i);
  assert.equal(powershell.status, "blocked");
  assert.match(powershell.reason, /shell wrapper/i);
});

test("safe mode enforces default allowlist and dangerous command blocks", async () => {
  const root = makeTempRepo();
  const runtime = createRuntime({ rootDir: root, stateDirName: ".token-optimizer-test" });

  const dangerous = await runtime.runCommand({ cmd: "git", args: ["reset", "--hard"] }, { cwd: root });
  const denied = await runtime.runCommand({ cmd: "node", args: ["benchmarks/fixtures/long-log.js"] }, { cwd: root });

  assert.equal(dangerous.status, "blocked");
  assert.match(dangerous.reason, /dangerous/i);
  assert.equal(denied.status, "blocked");
  assert.match(denied.reason, /allowlist/i);
});

test("explicit allowlist enables benchmark fixture and compacts large output", async () => {
  const root = makeTempRepo();
  const runtime = createRuntime({ rootDir: root, stateDirName: ".token-optimizer-test" });

  const result = await runtime.runCommand(
    { cmd: "node", args: ["benchmarks/fixtures/long-log.js"] },
    {
      cwd: root,
      allowlist: [/^node benchmarks[\/\\]fixtures[\/\\]long-log\.js$/],
      maxBytes: 900,
      maxLines: 40,
    },
  );

  assert.equal(result.status, "ok");
  assert.equal(result.truncated, true);
  assert.equal(result.artifactTruncated, false);
  assert.ok(result.artifactRef);
  assert.ok(result.metrics.commandCompactionTokensSaved > 0);
  assert.doesNotMatch(result.summary, /SECRET_TOKEN=abc123/);
});

test("cwd outside root is rejected before execution", async () => {
  const root = makeTempRepo();
  const runtime = createRuntime({ rootDir: root, stateDirName: ".token-optimizer-test" });

  const result = await runtime.runCommand({ cmd: "node", args: ["--version"] }, { cwd: process.cwd() });

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /cwd escapes root/i);
});
