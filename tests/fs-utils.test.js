const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readRepoFiles, safeRelPath } = require("../lib/fs-utils");
const { makeTempRepo } = require("./helpers");

test("safeRelPath rejects prefix, parent, absolute, and symlink escapes", () => {
  const root = makeTempRepo();
  const sibling = `${root}-sibling`;
  fs.mkdirSync(sibling, { recursive: true });
  fs.writeFileSync(path.join(sibling, "outside.js"), "module.exports = 1;", "utf8");

  assert.equal(safeRelPath(root, "src\\server.js"), "src/server.js");
  assert.throws(() => safeRelPath(root, "..", "outside.js"), /escapes root/i);
  assert.throws(() => safeRelPath(root, path.join(sibling, "outside.js")), /escapes root/i);

  const linkPath = path.join(root, "linked-outside");
  try {
    fs.symlinkSync(sibling, linkPath, "dir");
    assert.throws(() => safeRelPath(root, "linked-outside/outside.js"), /escapes root/i);
  } catch (error) {
    if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
  }
});

test("repo scan skips secret files, binaries, oversized files, excluded dirs, and lockfiles", () => {
  const root = makeTempRepo();
  fs.writeFileSync(path.join(root, ".env"), "TOKEN=secret", "utf8");
  fs.writeFileSync(path.join(root, "id_rsa"), "PRIVATE KEY", "utf8");
  fs.writeFileSync(path.join(root, "binary.bin"), Buffer.from([0, 1, 2, 3]));
  fs.writeFileSync(path.join(root, "large.txt"), "x".repeat(16000), "utf8");
  fs.writeFileSync(path.join(root, "package-lock.json"), "{}", "utf8");
  fs.mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", "pkg", "index.js"), "module.exports = 1;", "utf8");

  const scanned = readRepoFiles(root, { maxBytes: 12000 });
  const paths = scanned.files.map((file) => file.path);
  const skipped = scanned.skipped.map((entry) => entry.path);

  assert.ok(paths.includes("src/server.js"));
  assert.ok(!paths.includes(".env"));
  assert.ok(!paths.includes("id_rsa"));
  assert.ok(!paths.includes("binary.bin"));
  assert.ok(!paths.includes("large.txt"));
  assert.ok(!paths.includes("package-lock.json"));
  assert.ok(skipped.includes("node_modules"));
});
