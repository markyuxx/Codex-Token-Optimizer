const fs = require("node:fs");
const path = require("node:path");
const { ensureDir, hashText, readJson, writeJson } = require("./fs-utils");

function createCacheStore(stateDir) {
  const cachePath = path.join(stateDir, "cache.json");
  const artifactDir = path.join(stateDir, "artifacts");
  const realStateDir = fs.realpathSync.native(path.resolve(stateDir));

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
    const now = new Date().toISOString();
    cache.fileReads[relPath] = {
      hash,
      ref,
      firstSeenAt: current?.firstSeenAt || now,
      lastSeenAt: now,
      payload,
    };
    save(cache);
    return {
      ref,
      status,
      firstSeenAt: cache.fileReads[relPath].firstSeenAt,
      lastSeenAt: cache.fileReads[relPath].lastSeenAt,
      previousSeenAt: current?.lastSeenAt || null,
    };
  }

  function rememberCommand(command, output) {
    const cache = load();
    const refHash = hashText(`${command}\n${output}`);
    const ref = `command:${refHash}`;
    ensureDir(artifactDir);
    const artifactPath = path.join(artifactDir, `${refHash}.log`);
    const resolvedArtifactDir = fs.realpathSync.native(artifactDir);
    const relativeDir = path.relative(realStateDir, resolvedArtifactDir);
    if (relativeDir.startsWith("..") || path.isAbsolute(relativeDir)) {
      throw new Error("Artifact directory escapes optimizer state directory.");
    }
    const relativeArtifact = path.relative(resolvedArtifactDir, path.resolve(artifactPath));
    if (relativeArtifact.startsWith("..") || path.isAbsolute(relativeArtifact)) {
      throw new Error("Artifact path escapes artifact directory.");
    }
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
