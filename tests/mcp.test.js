const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { makeTempRepo } = require("./helpers");

function sendLine(child, request) {
  child.stdin.write(`${JSON.stringify(request)}\n`);
}

function waitForJson(child) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("Timed out waiting for MCP response.")), 10_000);
    function onData(chunk) {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("{")) {
          clearTimeout(timer);
          child.stdout.off("data", onData);
          resolve(JSON.parse(trimmed));
          return;
        }
      }
    }
    child.stdout.on("data", onData);
  });
}

test("MCP initializes, lists tools, and rejects shell syntax in run_command", async () => {
  const root = makeTempRepo();
  const serverPath = path.join(__dirname, "..", "mcp-server.js");
  const child = spawn(process.execPath, [serverPath], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });

  try {
    sendLine(child, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const init = await waitForJson(child);
    assert.equal(init.result.serverInfo.name, "token-optimizer");

    sendLine(child, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const tools = await waitForJson(child);
    assert.ok(tools.result.tools.some((tool) => tool.name === "run_command"));

    sendLine(child, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "run_command", arguments: { command: "node --version | more" } },
    });
    const blocked = await waitForJson(child);
    const body = JSON.parse(blocked.result.content[0].text);
    assert.equal(body.status, "blocked");
    assert.match(body.reason, /shell syntax/i);
  } finally {
    child.kill();
  }
});
