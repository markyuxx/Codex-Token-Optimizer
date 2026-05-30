const assert = require("assert");
const path = require("path");
const { spawn } = require("child_process");
const { build } = require("../src/build");

const fixtureRoot = path.join(__dirname, "fixtures", "sample-repo");
const serverPath = path.join(__dirname, "..", "src", "mcp-server.js");

build(fixtureRoot);

function encodeMessage(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

function createClient(child) {
  let buffer = "";
  const pending = new Map();

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.length) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = buffer.slice(0, headerEnd);
      const length = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1]);
      const start = headerEnd + 4;
      if (!length || buffer.length < start + length) return;
      const body = buffer.slice(start, start + length);
      buffer = buffer.slice(start + length);
      const message = JSON.parse(body);
      const resolver = pending.get(message.id);
      if (resolver) {
        pending.delete(message.id);
        resolver(message);
      }
    }
  });

  return {
    request(id, method, params) {
      return new Promise((resolve, reject) => {
        pending.set(id, resolve);
        child.stdin.write(encodeMessage({ jsonrpc: "2.0", id, method, params }));
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`Timed out waiting for ${method}`));
          }
        }, 3000);
      });
    }
  };
}

async function main() {
  const child = spawn(process.execPath, [serverPath], {
    cwd: fixtureRoot,
    stdio: ["pipe", "pipe", "pipe"]
  });

  const stderr = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => stderr.push(chunk));

  const client = createClient(child);

  try {
    const init = await client.request(1, "initialize", {});
    assert.equal(init.result.serverInfo.name, "agent-index");

    const tools = await client.request(2, "tools/list", {});
    assert.equal(tools.result.tools.length, 5);

    const summary = await client.request(3, "tools/call", {
      name: "agent_index.summary",
      arguments: {}
    });
    const summaryText = summary.result.content[0].text;
    assert.ok(summaryText.includes("\"staleCount\": 0"));

    const search = await client.request(4, "tools/call", {
      name: "agent_index.search",
      arguments: { query: "hello route" }
    });
    const searchText = search.result.content[0].text;
    assert.ok(searchText.includes("src/server.js"));
  } finally {
    child.kill();
  }

  if (stderr.join("").trim()) {
    throw new Error(stderr.join(""));
  }

  console.log("agent-index MCP smoke tests passed");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
