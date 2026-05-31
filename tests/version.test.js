const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const packageJson = require("../package.json");

test("release version is consistent across package, docs, changelog, and MCP source", () => {
  const root = path.join(__dirname, "..");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const mcp = fs.readFileSync(path.join(root, "mcp-server.js"), "utf8");

  assert.match(readme, new RegExp(`Status: \`${packageJson.version}\``));
  assert.match(changelog, new RegExp(`## ${packageJson.version.replace(/\./g, "\\.")}`));
  assert.match(mcp, /version: packageJson\.version/);
  assert.equal(packageJson.version, "1.0.0-rc.1");
});
