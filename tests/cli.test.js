const test = require("node:test");
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");
const { makeTempRepo } = require("./helpers");

const execFileAsync = promisify(execFile);
const cliPath = path.join(__dirname, "..", "index.js");

test("CLI exec uses safe mode by default", async () => {
  const root = makeTempRepo();
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "exec", "node", "--version", "--json"], { cwd: root });
  const result = JSON.parse(stdout);

  assert.equal(result.status, "ok");
  assert.equal(result.safeMode, true);
});

test("CLI exec blocks shell syntax in safe mode", async () => {
  const root = makeTempRepo();
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "exec", "node --version | more", "--json"], { cwd: root });
  const result = JSON.parse(stdout);

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /shell syntax/i);
});

test("CLI exec accepts security limit flags and keeps JSON stable", async () => {
  const root = makeTempRepo();
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "exec",
    "node",
    "--version",
    "--json",
    "--max-stdout-bytes",
    "100",
    "--max-stderr-bytes",
    "100",
    "--max-artifact-bytes",
    "200",
    "--max-lines",
    "5",
    "--timeout",
    "5000",
  ], { cwd: root });
  const result = JSON.parse(stdout);

  assert.equal(result.status, "ok");
  assert.equal(result.allowed, true);
  assert.equal(typeof result.stdoutPreview, "string");
  assert.equal(typeof result.metrics.netTokensSaved, "number");
});

test("CLI unsafe mode requires explicit flag and emits warning in human output", async () => {
  const root = makeTempRepo();
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "exec", "node --version", "--unsafe"], { cwd: root });

  assert.match(stdout, /UNSAFE MODE/i);
  assert.match(stdout, /status/i);
});
