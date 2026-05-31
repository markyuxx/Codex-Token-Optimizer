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
