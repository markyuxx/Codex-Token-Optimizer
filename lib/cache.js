const fs = require("node:fs");
const path = require("node:path");
const { ensureDir, hashText, readJson, writeJson } = require("./fs-utils");

function createCacheStore(stateDir) {
  const cachePath = path.join(stateDir, "cache.json");
  const artifactDir = path.join(stateDir, "artifacts");

  function load() {
    return readJson(cachePath, { fileReads: {}, commandRuns: {} });
  }

  function save(data) {
    writeJson(cachePath, data);
  }

  function rememberFileRead(relPath, hash, payload) {
    const cache = load();
    const current = cache.fileReads[relPath];
    const ref = `file:${hash}`;
    const status = current && current.hash === hash ? "unchanged" : current ? "changed" : "new";
    cache.fileReads[relPath] = {
      hash,
      ref,
      updatedAt: new Date().toISOString(),
      payload,
    };
    save(cache);
    return { ref, status };
  }

  function rememberCommand(command, output) {
    const cache = load();
    const refHash = hashText(`${command}\n${output}`);
    const ref = `command:${refHash}`;
    ensureDir(artifactDir);
    const artifactPath = path.join(artifactDir, `${refHash}.log`);
    fs.writeFileSync(artifactPath, output, "utf8");
    cache.commandRuns[ref] = {
      command,
      artifactPath,
      hash: refHash,
      updatedAt: new Date().toISOString(),
    };
    save(cache);
    return { ref, artifactPath };
  }

  return {
    load,
    rememberCommand,
    rememberFileRead,
  };
}

module.exports = { createCacheStore };
