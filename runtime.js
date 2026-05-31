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

  function resolveCwdInsideRoot(cwd) {
    const root = fs.realpathSync.native(baseDir);
    const requested = path.resolve(cwd || baseDir);
    const realRequested = fs.realpathSync.native(requested);
    const relative = path.relative(root, realRequested);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`cwd escapes root: ${cwd}`);
    }
    return realRequested;
  }

  function countFromResult(result) {
    return result.status === "supported" || result.status === "estimated" ? result.tokenCount : null;
  }

  async function countText(text, optionsForCount = {}) {
    return runtime.estimateTokens({
      model: optionsForCount.model || "gpt-4o-mini",
      provider: optionsForCount.provider || "openai",
      text,
      allowEstimateFallback: optionsForCount.allowEstimateFallback,
    });
  }

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
      if (content.includes("\u0000")) {
        throw new Error(`File appears to be binary: ${relPath}`);
      }
      const hash = hashText(content);
      const byteLength = Buffer.byteLength(content, "utf8");
      const cacheState = cache.rememberFileRead(relPath, hash, {
        purpose: options.purpose || "",
        size: byteLength,
      });
      const tokenEstimate = await countText(content, options);
      const tokensIfFullContent = countFromResult(tokenEstimate);
      const metadata = {
        path: relPath,
        hash,
        sizeBytes: byteLength,
        tokenEstimate,
        firstSeenAt: cacheState.firstSeenAt,
        lastSeenAt: cacheState.lastSeenAt,
        previousSeenAt: cacheState.previousSeenAt,
      };
      const includeContent = options.includeContent === true || options.force === true || cacheState.status !== "unchanged";
      const returnedPayload = includeContent ? content : JSON.stringify(metadata);
      const returnedTokenEstimate = await countText(returnedPayload, options);
      const tokensReturned = countFromResult(returnedTokenEstimate);
      const tokensSaved = tokensIfFullContent !== null && tokensReturned !== null ? Math.max(tokensIfFullContent - tokensReturned, 0) : 0;
      const response = {
        path: relPath,
        hash,
        sizeBytes: byteLength,
        cacheStatus: cacheState.status,
        cacheHit: cacheState.status === "unchanged",
        changed: cacheState.status !== "unchanged",
        contentIncluded: includeContent,
        tokenEstimate,
        tokensIfFullContent,
        tokensReturned,
        tokensSaved,
        ref: cacheState.ref,
        firstSeenAt: cacheState.firstSeenAt,
        lastSeenAt: cacheState.lastSeenAt,
        previousSeenAt: cacheState.previousSeenAt,
        metrics: {
          cacheTokensSaved: tokensSaved,
          returnedTokens: tokensReturned,
          baselineTokens: tokensIfFullContent,
        },
        ...(includeContent ? { content } : {}),
      };
      return {
        ...response,
        file: {
          path: response.path,
          hash: response.hash,
          size: response.sizeBytes,
          sizeBytes: response.sizeBytes,
          tokenCost: response.tokensIfFullContent,
          metadataTokenCost: response.tokensReturned,
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
      const ruleCost = countFromResult(ruleCostEstimate) || 0;
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
      let truncatedChunks = 0;
      let skippedChunks = 0;

      for (const entry of rankedFiles) {
        const chunk = entry.bestChunk;
        let excerpt = chunk.text.trim();
        let estimate = await countText(excerpt, options);
        let chunkCost = countFromResult(estimate) || Math.ceil(excerpt.length / 4);
        let overBudget = false;
        if (chunkCost > remaining) {
          if (remaining <= 0) break;
          const originalExcerpt = excerpt;
          let charLimit = Math.max(40, Math.min(originalExcerpt.length, remaining * 3));
          while (charLimit > 0) {
            excerpt = `${originalExcerpt.slice(0, charLimit)}\n...[truncated to budget]`;
            estimate = await countText(excerpt, options);
            chunkCost = countFromResult(estimate) || Math.ceil(excerpt.length / 4);
            if (chunkCost <= remaining) break;
            charLimit = Math.floor(charLimit * 0.65);
          }
          overBudget = chunkCost > remaining;
          if (!overBudget) truncatedChunks += 1;
        }
        if (overBudget) {
          skippedChunks += 1;
          continue;
        }
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
          truncated: excerpt.includes("[truncated to budget]"),
        });
      }
      const staleSet = new Set(this.staleness().stale);
      const staleWarnings = items
        .filter((item) => staleSet.has(item.path))
        .map((item) => ({ path: item.path, warning: "File changed since the last index build; reindex is recommended." }));
      const usedTokens = budget - remaining;
      if (items.length < rankedFiles.length) skippedChunks += rankedFiles.length - items.length - skippedChunks;

      return {
        query,
        requestedBudget: budget,
        usedTokens,
        remainingTokens: remaining,
        overBudget: usedTokens > budget,
        items,
        rules,
        seenRefs,
        staleWarnings,
        truncatedChunks,
        skippedChunks: Math.max(skippedChunks, 0),
        truncated: items.length < rankedFiles.length,
        tokenCost: usedTokens,
        metrics: options.skipMetrics ? null : await this.contextMetrics({
          items,
          rules,
          model: options.model || "gpt-4o-mini",
          provider: options.provider || "openai",
        }),
      };
    },

    async runCommand(command, options = {}) {
      let cwd;
      try {
        cwd = resolveCwdInsideRoot(options.cwd || baseDir);
      } catch (error) {
        return {
          status: "blocked",
          reason: error.message,
          blockedReason: error.message,
          exitCode: null,
          durationMs: 0,
          timedOut: false,
          command: typeof command === "string" ? command : command?.cmd || "",
          args: Array.isArray(command?.args) ? command.args : [],
          cwd: options.cwd || baseDir,
          allowed: false,
          classification: null,
          tokenCost: 0,
          tokensBefore: 0,
          tokensReturned: 0,
          tokensSaved: 0,
          summary: "",
          stdoutPreview: "",
          stderrPreview: "",
          errors: [],
          warnings: [],
          failedTests: [],
          stackTraces: [],
          filesMentioned: [],
          fileReferences: [],
          truncated: false,
          artifactRef: null,
          artifactPath: null,
          artifactTruncated: false,
          safeMode: options.safeMode !== false && options.unsafe !== true,
          metrics: {
            baselineTokens: 0,
            returnedTokens: 0,
            totalTokensSaved: 0,
            commandCompactionTokensSaved: 0,
            netTokensSaved: 0,
            savingsPercent: 0,
          },
          nextActions: ["Use a cwd inside the optimizer root."],
        };
      }
      const result = await runCommandInternal(command, {
        cwd,
        classify: options.classify,
        allowlist: options.allowlist,
        dangerousPatterns: options.dangerousPatterns,
        safeMode: options.safeMode,
        unsafe: options.unsafe,
        timeoutMs: options.timeoutMs,
        maxBuffer: options.maxBuffer,
        maxLines: options.maxLines,
        maxBytes: options.maxBytes,
        maxStdoutBytes: options.maxStdoutBytes,
        maxStderrBytes: options.maxStderrBytes,
        maxArtifactBytes: options.maxArtifactBytes,
        maxCommandLength: options.maxCommandLength,
        maxArgs: options.maxArgs,
        maxArgLength: options.maxArgLength,
      });
      if (result.status === "blocked") {
        return {
          command: result.command,
          args: result.args,
          cwd,
          allowed: false,
          exitCode: null,
          classification: null,
          tokenCost: 0,
          tokensBefore: 0,
          tokensReturned: 0,
          tokensSaved: 0,
          summary: "",
          stdoutPreview: "",
          stderrPreview: "",
          errors: [],
          warnings: [],
          failedTests: [],
          stackTraces: [],
          filesMentioned: [],
          fileReferences: [],
          truncated: false,
          artifactRef: null,
          artifactPath: null,
          artifactTruncated: false,
          durationMs: result.durationMs || 0,
          timedOut: false,
          status: "blocked",
          reason: result.reason,
          blockedReason: result.blockedReason || result.reason,
          safeMode: true,
          metrics: {
            baselineTokens: 0,
            returnedTokens: 0,
            totalTokensSaved: 0,
            commandCompactionTokensSaved: 0,
            netTokensSaved: 0,
            savingsPercent: 0,
          },
          nextActions: ["Review the command allowlist or rerun with unsafe:true only if you trust the command."],
        };
      }
      const tokenEstimate = await countText(result.summary, options);
      const fullTokenEstimate = await countText(result.combined || result.artifact || "", options);
      const returnedTokens = countFromResult(tokenEstimate);
      const baselineTokens = countFromResult(fullTokenEstimate);
      const commandCompactionTokensSaved = baselineTokens !== null && returnedTokens !== null ? Math.max(baselineTokens - returnedTokens, 0) : 0;
      let artifactRef = null;
      let artifactPath = null;
      if (result.truncated || options.persistArtifact !== false) {
        const artifact = cache.rememberCommand(result.command || JSON.stringify(command), result.artifact || result.combined || "");
        artifactRef = artifact.ref;
        artifactPath = path.relative(baseDir, artifact.artifactPath).replace(/\\/g, "/");
      }
      return {
        command: result.command,
        args: result.args,
        cwd,
        allowed: result.allowed,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
        classification: result.classification,
        tokenCost: returnedTokens,
        tokensBefore: baselineTokens,
        tokensReturned: returnedTokens,
        tokensSaved: commandCompactionTokensSaved,
        summary: result.summary,
        stdoutPreview: result.stdoutPreview,
        stderrPreview: result.stderrPreview,
        errors: result.errors,
        warnings: result.warnings,
        failedTests: result.failedTests,
        stackTraces: result.stackTraces,
        filesMentioned: result.filesMentioned,
        fileReferences: result.fileReferences,
        truncated: result.truncated,
        artifactRef,
        artifactPath,
        artifactTruncated: result.artifactTruncated,
        status: result.status,
        safeMode: result.safeMode,
        metrics: {
          baselineTokens,
          returnedTokens,
          totalTokensSaved: commandCompactionTokensSaved,
          commandCompactionTokensSaved,
          netTokensSaved: commandCompactionTokensSaved,
          savingsPercent: baselineTokens ? Number(((commandCompactionTokensSaved / baselineTokens) * 100).toFixed(2)) : 0,
        },
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
        returnedTokens: optimizedTokens,
        optimizedTokens,
        totalTokensSaved: Math.max(baselineTokens - optimizedTokens, 0),
        tokensSaved: Math.max(baselineTokens - optimizedTokens, 0),
        savingsPercent: baselineTokens ? Number((((baselineTokens - optimizedTokens) / baselineTokens) * 100).toFixed(2)) : 0,
        savingsRatio: baselineTokens ? Number(((baselineTokens - optimizedTokens) / baselineTokens).toFixed(4)) : 0,
        retrievalTokensSaved: Math.max(baselineTokens - optimizedTokens, 0),
        cacheTokensSaved: 0,
        commandCompactionTokensSaved: 0,
        pinnedRulesTokenCost: rules.length ? optimizedTokens : 0,
        embeddingTokenCost: 0,
        indexingTokenCost: 0,
        netTokensSaved: Math.max(baselineTokens - optimizedTokens, 0),
        savingsBy: {
          retrieval: Math.max(baselineTokens - optimizedTokens, 0),
          cache: 0,
          commandCompaction: 0,
          pinnedRules: rules.length ? optimizedTokens : 0,
          embeddings: 0,
          returned: optimizedTokens,
          baseline: baselineTokens,
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
