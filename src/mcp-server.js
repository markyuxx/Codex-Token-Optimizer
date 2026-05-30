const { search, fileContext, symbolContext, staleness, summary } = require("./query");

let buffer = "";

const tools = [
  { name: "agent_index.search", description: "Search compact repo context.", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
  { name: "agent_index.file_context", description: "Get indexed high-signal lines for a file.", inputSchema: { type: "object", properties: { path: { type: "string" }, maxLines: { type: "number" } }, required: ["path"] } },
  { name: "agent_index.symbol_context", description: "Find indexed definitions/usages for a symbol.", inputSchema: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] } },
  { name: "agent_index.staleness", description: "Check whether indexed files are stale.", inputSchema: { type: "object", properties: { paths: { type: "array", items: { type: "string" } } } } },
  { name: "agent_index.summary", description: "Summarize current index.", inputSchema: { type: "object", properties: {} } }
];

function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function content(text) {
  return { content: [{ type: "text", text: typeof text === "string" ? text : JSON.stringify(text, null, 2) }] };
}

function callTool(params) {
  const args = params.arguments || {};
  if (params.name === "agent_index.search") return content(search(process.cwd(), args.query, args.limit));
  if (params.name === "agent_index.file_context") return content(fileContext(process.cwd(), args.path, args.maxLines));
  if (params.name === "agent_index.symbol_context") return content(symbolContext(process.cwd(), args.symbol));
  if (params.name === "agent_index.staleness") return content(staleness(process.cwd(), args.paths));
  if (params.name === "agent_index.summary") return content(summary(process.cwd()));
  throw new Error(`Unknown tool: ${params.name}`);
}

function handle(request) {
  try {
    if (request.method === "initialize") {
      send({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "agent-index", version: "0.1.0" } } });
    } else if (request.method === "tools/list") {
      send({ jsonrpc: "2.0", id: request.id, result: { tools } });
    } else if (request.method === "tools/call") {
      send({ jsonrpc: "2.0", id: request.id, result: callTool(request.params || {}) });
    } else if (request.id) {
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
