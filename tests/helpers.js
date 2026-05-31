const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function makeTempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-optimizer-"));
  fs.writeFileSync(
    path.join(root, "AGENTS.md"),
    [
      "# Demo Repo",
      "",
      "- Never commit secrets.",
      "- Validate all input paths.",
      "- Query the index before broad reads.",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: {
        "bench:smoke": "node benchmarks/fixtures/long-log.js",
      },
    }, null, 2),
    "utf8",
  );
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "test"), { recursive: true });
  fs.mkdirSync(path.join(root, "benchmarks", "fixtures"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "server.js"),
    [
      "const http = require('http');",
      "const { helper } = require('./util');",
      "",
      "function startServer() {",
      "  return http.createServer((req, res) => {",
      "    res.end(helper('ok'));",
      "  });",
      "}",
      "",
      ...Array.from({ length: 60 }, (_, index) => `// implementation detail ${index}: server startup context should not repeat in unchanged cache reads`),
      "",
      "module.exports = { startServer };",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "src", "util.js"),
    [
      "function helper(value) {",
      "  return value.toUpperCase();",
      "}",
      "",
      "module.exports = { helper };",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(path.join(root, "test", "server.test.js"), "const { startServer } = require('../src/server');\nstartServer;\n", "utf8");
  fs.writeFileSync(
    path.join(root, "benchmarks", "fixtures", "long-log.js"),
    "for (let i = 0; i < 220; i += 1) console.log(`src/server.js:${i} line-${i} SECRET_TOKEN=abc123`);\n",
    "utf8",
  );
  return root;
}

module.exports = { makeTempRepo };
