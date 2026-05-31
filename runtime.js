const fs = require("node:fs");
const path = require("node:path");
const { createCacheStore } = require("./lib/cache");
const { runCommand: runCommandInternal } = require("./lib/commands");
const { runBenchmark } = require("./lib/benchmark");
const { ensureDir, hashText, readJson, readRepoFiles, safeRelPath, writeJson } = require("./lib/fs-utils");
const { createIndex, loadIndexFromDisk, queryIndex } = require("./lib/retrieval");
const { getPinnedRules } = require("./lib/rules");
const { createTokenCounterRegistry } = require("./lib/tokenization");

function inferProviderFromModel(model) {
  if (/^(gpt|o1|o3|text-embedding)/i.test(model || "")) return "openai";
  if (/^claude/i.test(model || "")) return "anthropic";
  if (/gemini/i.test(model || "")) return "gemini";
  return "unknown";
}

function createRuntime(options = {}) {
  const baseDir = path.resolve(options.rootDir || process.cwd());
  const stateDirName = options.stateDirName || ".token-optimizer";
  const stateDir = path.join(baseDir, stateDirName);
  ensureDir(stateDir);
  const cache = createCacheStore(stateDir);
  const tokenCounters = createTokenCounterRegistry();

  const runtime = {
    baseDir,
    stateDir,
    currentIndex: null,

    writeState(name, value) {
      writeJson(path.join(stateDir, name), value);
    },

    readState(name, fallback) {
      return readJson(path.join(stateDir, name), fallback);
    },

    async buildIndex(buildOptions = {}) {
      const index = await createIndex(baseDir, buildOptions);
      const persisted = {
        generatedAt: index.generatedAt,
        rootDir: index.rootDir,
        skipped: index.skipped,
        files: index.files,
        chunks: index.chunks,
        symbols: index.symbols,
      };
      this.currentIndex = index;
      this.writeState("index.json", persisted);
      this.writeState("rules.json", { generatedAt: new Date().toISOString(), rules: getPinnedRules(baseDir) });
      this.writeState(
        "staleness.json",
        {
          generatedAt: new Date().toISOString(),
          files: Object.fromEntries(index.files.map((file) => [file.path, { hash: file.hash, size: file.size, mtimeMs: file.mtimeMs }])),
        },
      );
      return {
        generatedAt: persisted.generatedAt,
        fileCount: persisted.files.length,
        chunkCount: persisted.chunks.length,
        symbolCount: Object.keys(persisted.symbols).length,
        skipped: persisted.skipped.length,
      };
    },

    ensureIndex() {
      if (this.currentIndex) return this.currentIndex;
      const loaded = loadIndexFromDisk(stateDir);
      if (!loaded) throw new Error("Token optimizer index is missing. Run build first.");
      this.currentIndex = loaded;
      return loaded;
    },

    getPinnedRules() {
      const stored = this.readState("rules.json", null);
      return stored?.rules || getPinnedRules(baseDir);
    },

    async estimateTokens(input) {
      const provider = input.provider || inferProviderFromModel(input.model);
      return tokenCounters.estimate({ ...input, provider });
    },

    async readFileContext(targetPath, options = {}) {
      const relPath = safeRelPath(baseDir, targetPath);
      const absPath = path.join(baseDir, relPath);
      const stats = fs.statSync(absPath);
      const maxBytes = options.maxBytes || 512 * 1024;
      if (stats.size > maxBytes) {
        throw new Error(`File exceeds maxBytes limit: ${relPath}`);
      }
      const content = fs.readFileSync(absPath, "utf8");
      const hash = hashText(content);
      const byteLength = Buffer.byteLength(content, "utf8");
      const cacheState = cache.rememberFileRead(relPath, hash, {
        purpose: options.purpose || "",
        size: byteLength,
      });
      const tokenEstimate = await this.estimateTokens({
        model: options.model || "gpt-4o-mini",
        provider: options.provider || "openai",
        text: content,
      });
      const tokenCost = tokenEstimate.status === "supported" ? tokenEstimate.tokenCount : null;
      const metadata = {
        path: relPath,
        hash,
        size: byteLength,
        tokenCost,
        firstSeenAt: cacheState.firstSeenAt,
        lastSeenAt: cacheState.lastSeenAt,
        previousSeenAt: cacheState.previousSeenAt,
      };
      const includeContent = options.includeContent === true || options.force === true || cacheState.status !== "unchanged";
      const metadataTokenEstimate = await this.estimateTokens({
        model: options.model || "gpt-4o-mini",
        provider: options.provider || "openai",
        text: JSON.stringify(metadata),
      });
      return {
        file: {
          ...metadata,
          metadataTokenCost: metadataTokenEstimate.status === "supported" ? metadataTokenEstimate.tokenCount : null,
          omitted: !includeContent,
          ...(includeContent ? { content } : {}),
        },
        cache: cacheState,
      };
    },

    async retrieveContext(query, options = {}) {
      const index = this.ensureIndex();
      const budget = options.budget || 1200;
      const rules = this.getPinnedRules();
      const ruleText = rules.map((rule) => `- ${rule.text}`).join("\n");
      const ruleCostEstimate = await this.estimateTokens({
        model: options.model || "gpt-4o-mini",
        provider: options.provider || "openai",
        text: ruleText,
      });
      const ruleCost = ruleCostEstimate.status === "supported" ? ruleCostEstimate.tokenCount : 0;
      const ranked = await queryIndex(index, query, {
        limit: options.limit || 10,
        embedding: options.embedding,
      });
      const grouped = new Map();
      for (const chunk of ranked) {
        const current = grouped.get(chunk.path) || {
          path: chunk.path,
          totalScore: 0,
          bestChunk: chunk,
        };
        current.totalScore += chunk.score;
        if (chunk.score > current.bestChunk.score) current.bestChunk = chunk;
        grouped.set(chunk.path, current);
      }
      const rankedFiles = [...grouped.values()]
        .sort((a, b) => b.totalScore - a.totalScore || b.bestChunk.score - a.bestChunk.score)
        .slice(0, options.limit || 10);

      let remaining = Math.max(budget - ruleCost, 0);
      const items = [];
      const seenRefs = [];

      for (const entry of rankedFiles) {
        const chunk = entry.bestChunk;
        const excerpt = chunk.text.trim();
        const estimate = await this.estimateTokens({
          model: options.model || "gpt-4o-mini",
          provider: options.provider || "openai",
          text: excerpt,
        });
        const chunkCost = estimate.status === "supported" ? estimate.tokenCount : Math.ceil(excerpt.length / 4);
        if (chunkCost > remaining && items.length) break;
        remaining -= chunkCost;
        const ref = `chunk:${chunk.id}`;
        seenRefs.push(ref);
        items.push({
          ref,
          path: chunk.path,
          score: Number(entry.totalScore.toFixed(4)),
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          excerpt,
          tokenCost: chunkCost,
        });
      }

      return {
        query,
        items,
        rules,
        seenRefs,
        staleWarnings: [],
        truncated: items.length < rankedFiles.length,
        tokenCost: budget - remaining,
        metrics: await this.contextMetrics({
          items,
          rules,
          model: options.model || "gpt-4o-mini",
          provider: options.provider || "openai",
        }),
      };
    },

    async runCommand(command, options = {}) {
      const result = await runCommandInternal(command, {
        cwd: options.cwd || baseDir,
        classify: options.classify,
        allowlist: options.allowlist,
        dangerousPatterns: options.dangerousPatterns,
        safeMode: options.safeMode,
        timeoutMs: options.timeoutMs,
        maxBuffer: options.maxBuffer,
        maxLines: options.maxLines,
        maxBytes: options.maxBytes,
      });
      if (result.status === "blocked") {
        return {
          exitCode: null,
          classification: null,
          tokenCost: 0,
          tokensBefore: 0,
          summary: "",
          errors: [],
          warnings: [],
          filesMentioned: [],
          truncated: false,
          artifactRef: null,
          status: "blocked",
          reason: result.reason,
          nextActions: ["Review the command allowlist or rerun with safeMode disabled only if you trust the command."],
        };
      }
      const tokenEstimate = await this.estimateTokens({
        model: options.model || "gpt-4o-mini",
        provider: options.provider || "openai",
        text: result.summary,
      });
      const fullTokenEstimate = await this.estimateTokens({
        model: options.model || "gpt-4o-mini",
        provider: options.provider || "openai",
        text: result.combined,
      });
      let artifactRef = null;
      if (result.truncated || options.persistArtifact !== false) {
        const artifact = cache.rememberCommand(command, result.combined);
        artifactRef = artifact.ref;
      }
      return {
        exitCode: result.exitCode,
        classification: result.classification,
        tokenCost: tokenEstimate.status === "supported" ? tokenEstimate.tokenCount : null,
        tokensBefore: fullTokenEstimate.status === "supported" ? fullTokenEstimate.tokenCount : null,
        summary: result.summary,
        errors: result.errors,
        warnings: result.warnings,
        filesMentioned: result.filesMentioned,
        truncated: result.truncated,
        artifactRef,
        status: result.status,
        nextActions: result.errors.length ? ["Inspect the stored artifact or rerun the command with narrower scope."] : [],
      };
    },

    async contextMetrics({ items, rules, model, provider }) {
      const optimizedText = [
        ...rules.map((rule) => rule.text),
        ...items.map((item) => item.excerpt),
      ].join("\n");
      const baselineText = this.ensureIndex().chunks.map((chunk) => chunk.text).join("\n");
      const optimized = await this.estimateTokens({ model, provider, text: optimizedText });
      const baseline = await this.estimateTokens({ model, provider, text: baselineText });
      const optimizedTokens = optimized.status === "supported" ? optimized.tokenCount : 0;
      const baselineTokens = baseline.status === "supported" ? baseline.tokenCount : 0;
      return {
        baselineTokens,
        optimizedTokens,
        tokensSaved: Math.max(baselineTokens - optimizedTokens, 0),
        savingsRatio: baselineTokens ? Number(((baselineTokens - optimizedTokens) / baselineTokens).toFixed(4)) : 0,
        savingsBy: {
          retrieval: Math.max(baselineTokens - optimizedTokens, 0),
          cache: 0,
          commandCompaction: 0,
          pinnedRules: optimizedTokens,
          embeddings: 0,
        },
      };
    },

    async benchmark(options = {}) {
      return runBenchmark(this, options);
    },

    staleness() {
      const snapshot = this.readState("staleness.json", { files: {} });
      const current = readRepoFiles(baseDir);
      const stale = [];
      for (const file of current.files) {
        const previous = snapshot.files[file.path];
        if (!previous || previous.hash !== file.hash || previous.size !== file.size || previous.mtimeMs !== file.mtimeMs) {
          stale.push(file.path);
        }
      }
      return {
        generatedAt: snapshot.generatedAt || null,
        staleCount: stale.length,
        stale: stale.slice(0, 50),
      };
    },

    indexStatus() {
      const index = this.ensureIndex();
      return {
        generatedAt: index.generatedAt,
        fileCount: index.files.length,
        chunkCount: index.chunks.length,
        symbolCount: Object.keys(index.symbols).length,
        staleCount: this.staleness().staleCount,
      };
    },
  };

  return runtime;
}

module.exports = { createRuntime };
