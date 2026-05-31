const { createRuntime } = require("./runtime");
const packageJson = require("./package.json");

const runtime = createRuntime({ rootDir: process.cwd() });
let buffer = "";

const tools = [
  { name: "estimate_tokens", description: "Estimate tokens for text/messages with exact providers when available.", inputSchema: { type: "object", properties: { provider: { type: "string" }, model: { type: "string" }, text: { type: "string" }, messages: { type: "array" }, allowEstimateFallback: { type: "boolean" } }, required: ["model"] } },
  { name: "retrieve_context", description: "Retrieve a token-budgeted context bundle.", inputSchema: { type: "object", properties: { query: { type: "string" }, budget: { type: "number" }, model: { type: "string" }, provider: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
  { name: "read_file_context", description: "Read a file via the optimizer cache.", inputSchema: { type: "object", properties: { path: { type: "string" }, model: { type: "string" }, provider: { type: "string" }, purpose: { type: "string" }, includeContent: { type: "boolean" }, force: { type: "boolean" }, maxBytes: { type: "number" }, maxTokens: { type: "number" } }, required: ["path"] } },
  { name: "run_command", description: "Execute a command through the optimizer command proxy with safeMode enabled by default.", inputSchema: { type: "object", properties: { command: { type: "string" }, cmd: { type: "string" }, args: { type: "array", items: { type: "string" } }, cwd: { type: "string" }, model: { type: "string" }, provider: { type: "string" }, safeMode: { type: "boolean" }, unsafe: { type: "boolean" }, allowlist: { type: "array", items: { type: "string" } }, allowCommand: { type: "array", items: { type: "string" } }, timeoutMs: { type: "number" }, maxStdoutBytes: { type: "number" }, maxStderrBytes: { type: "number" }, maxBytes: { type: "number" }, maxLines: { type: "number" }, maxArtifactBytes: { type: "number" }, maxCommandLength: { type: "number" }, maxArgs: { type: "number" }, maxArgLength: { type: "number" } } } },
  { name: "get_rules", description: "Return the pinned rules kept visible in bundles.", inputSchema: { type: "object", properties: {} } },
  { name: "benchmark_run", description: "Run the optimizer benchmark suite.", inputSchema: { type: "object", properties: { budget: { type: "number" }, model: { type: "string" } } } },
  { name: "staleness", description: "Return stale files since the last build.", inputSchema: { type: "object", properties: {} } },
  { name: "index_status", description: "Return current optimizer index status.", inputSchema: { type: "object", properties: {} } },
];

function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function content(value) {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

async function callTool(params) {
  const args = params.arguments || {};
  if (params.name === "estimate_tokens") return content(await runtime.estimateTokens(args));
  if (params.name === "retrieve_context") return content(await runtime.retrieveContext(args.query, args));
  if (params.name === "read_file_context") return content(await runtime.readFileContext(args.path, args));
  if (params.name === "run_command") {
    const command = args.command || { cmd: args.cmd, args: args.args || [] };
    const allowlistEntries = Array.isArray(args.allowlist) ? args.allowlist : args.allowCommand;
    const allowlist = Array.isArray(allowlistEntries) ? allowlistEntries.map((entry) => new RegExp(entry)) : undefined;
    return content(await runtime.runCommand(command, { ...args, allowlist }));
  }
  if (params.name === "get_rules") return content(runtime.getPinnedRules());
  if (params.name === "benchmark_run") return content(await runtime.benchmark(args));
  if (params.name === "staleness") return content(runtime.staleness());
  if (params.name === "index_status") return content(runtime.indexStatus());
  throw new Error(`Unknown tool: ${params.name}`);
}

async function handle(request) {
  try {
    if (request.method === "initialize") {
      send({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "token-optimizer", version: packageJson.version } } });
      return;
    }
    if (request.method === "tools/list") {
      send({ jsonrpc: "2.0", id: request.id, result: { tools } });
      return;
    }
    if (request.method === "tools/call") {
      send({ jsonrpc: "2.0", id: request.id, result: await callTool(request.params || {}) });
      return;
    }
    if (request.id) {
      send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: `Unknown method: ${request.method}` } });
    }
  } catch (error) {
    send({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: error.message } });
  }
}

function parseBuffer() {
  while (buffer.length) {
    if (buffer.startsWith("Content-Length:")) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = buffer.slice(0, headerEnd);
      const length = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1]);
      const start = headerEnd + 4;
      if (!length || buffer.length < start + length) return;
      const body = buffer.slice(start, start + length);
      buffer = buffer.slice(start + length);
      handle(JSON.parse(body));
    } else {
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) handle(JSON.parse(line));
    }
  }
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  parseBuffer();
});
