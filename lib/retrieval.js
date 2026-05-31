const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("@babel/parser");
const { readRepoFiles } = require("./fs-utils");

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9_]+/i)
    .filter(Boolean);
}

function summarizePath(relPath) {
  const parts = relPath.split("/");
  if (relPath === "package.json") return "npm metadata";
  if (relPath === ".mcp.json") return "mcp configuration";
  if (parts.includes("tools")) return "tooling";
  if (parts.includes("web")) return "web surface";
  if (parts.includes("src")) return "source module";
  return "repository file";
}

function extensionBoost(ext) {
  if ([".js", ".cjs", ".mjs", ".ts", ".tsx", ".jsx"].includes(ext)) return 0.75;
  if ([".md", ".json"].includes(ext)) return -0.35;
  return 0;
}

function pathBoost(relPath) {
  const normalized = String(relPath || "").replace(/\\/g, "/");
  let score = 0;
  if (/^(src|lib)\//.test(normalized)) score += 1.2;
  if (/(^|\/)(runtime|index|tokenization|cache|commands|benchmark)\.js$/i.test(normalized)) score += 0.8;
  if (/(^|\/)README\.md$/i.test(normalized)) score -= 2.2;
  if (/(^|\/)(tests?|benchmarks)\//i.test(normalized)) score -= 1.6;
  if (/(^|\/)benchmarks\/suite\.json$/i.test(normalized)) score -= 8;
  if (/(^|\/)reports\//i.test(normalized)) score -= 8;
  if (/(^|\/)package(-lock)?\.json$/i.test(normalized)) score -= 2.4;
  if (/lock|\.min\./i.test(normalized)) score -= 3.5;
  return score;
}

function intentPathBoost(chunk, query) {
  const normalized = String(chunk.path || "").replace(/\\/g, "/").toLowerCase();
  const terms = new Set(tokenize(query));
  let score = 0;
  if (normalized.endsWith("lib/commands.js") && ["command", "commands", "runcommand", "safemode", "spawn", "shell"].some((term) => terms.has(term))) score += 8;
  if (normalized.endsWith("runtime.js") && ["runtime", "createruntime", "readfilecontext", "retrievecontext", "indexstatus"].some((term) => terms.has(term))) score += 6;
  if (normalized.endsWith("lib/retrieval.js") && ["retrieval", "queryindex", "stale", "stalewarnings", "bm25"].some((term) => terms.has(term))) score += 6;
  if (normalized.endsWith("lib/cache.js") && ["cache", "rememberfileread", "remembercommand"].some((term) => terms.has(term))) score += 6;
  return score;
}

function kindBoost(kind) {
  if (kind === "symbol") return 3.5;
  return 0;
}

function exactMatchBoost(chunk, query) {
  const haystack = `${chunk.path} ${chunk.symbol || ""} ${chunk.text}`.toLowerCase();
  const terms = tokenize(query);
  let score = 0;
  for (const term of terms) {
    if (term.length >= 3 && haystack.includes(term)) score += 0.35;
  }
  if (chunk.symbol && terms.includes(String(chunk.symbol).toLowerCase())) score += 4;
  return score;
}

function chunkText(text, maxChars = 700) {
  const lines = String(text || "").split(/\r?\n/);
  const chunks = [];
  let current = [];
  let currentLength = 0;
  let startLine = 1;

  lines.forEach((line, index) => {
    const lineLength = line.length + 1;
    if (currentLength + lineLength > maxChars && current.length) {
      chunks.push({
        startLine,
        endLine: index,
        text: current.join("\n"),
      });
      current = [];
      currentLength = 0;
      startLine = index + 1;
    }
    current.push(line);
    currentLength += lineLength;
  });

  if (current.length) {
    chunks.push({
      startLine,
      endLine: lines.length,
      text: current.join("\n"),
    });
  }

  return chunks;
}

function guessSourceType(ext) {
  return [".mjs", ".jsx", ".ts", ".tsx"].includes(ext) ? "module" : "unambiguous";
}

function parseJavaScript(file) {
  const ast = parse(file.text, {
    sourceType: guessSourceType(file.ext),
    plugins: [
      "jsx",
      "typescript",
      "classProperties",
      "objectRestSpread",
      "topLevelAwait",
      "optionalChaining",
      "dynamicImport",
    ],
    errorRecovery: true,
  });

  const imports = [];
  const exports = [];
  const symbols = [];
  const calls = [];

  function visit(node) {
    if (!node || typeof node !== "object") return;
    switch (node.type) {
      case "ImportDeclaration":
        imports.push(node.source.value);
        break;
      case "ExportNamedDeclaration":
      case "ExportDefaultDeclaration":
        exports.push(file.text.slice(node.start, Math.min(node.end, node.start + 120)).replace(/\s+/g, " "));
        break;
      case "FunctionDeclaration":
      case "ClassDeclaration":
        if (node.id && node.id.name) {
          symbols.push({
            name: node.id.name,
            kind: node.type === "ClassDeclaration" ? "class" : "function",
            line: node.loc?.start.line || 1,
            startLine: node.loc?.start.line || 1,
            endLine: node.loc?.end.line || node.loc?.start.line || 1,
          });
        }
        break;
      case "VariableDeclarator":
        if (node.id && node.id.type === "Identifier" && node.init && ["ArrowFunctionExpression", "FunctionExpression"].includes(node.init.type)) {
          symbols.push({
            name: node.id.name,
            kind: "function",
            line: node.loc?.start.line || 1,
            startLine: node.loc?.start.line || 1,
            endLine: node.loc?.end.line || node.loc?.start.line || 1,
          });
        }
        break;
      case "CallExpression":
        if (node.callee.type === "Identifier") calls.push(node.callee.name);
        if (node.callee.type === "MemberExpression" && node.callee.property && node.callee.property.type === "Identifier") {
          calls.push(node.callee.property.name);
        }
        break;
      default:
        break;
    }
    for (const value of Object.values(node)) {
      if (!value) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object" && value.type) visit(value);
    }
  }

  visit(ast.program);
  return { imports, exports, symbols, calls };
}

function createEmbeddingProviders() {
  return {
    openai: {
      kind: "openai",
      supports() {
        return Boolean(process.env.OPENAI_API_KEY);
      },
      async embed(texts, options = {}) {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error("OPENAI_API_KEY is required for OpenAI embeddings.");
        const response = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: options.model || "text-embedding-3-small",
            input: texts,
          }),
        });
        if (!response.ok) {
          throw new Error(`OpenAI embeddings failed with status ${response.status}`);
        }
        const data = await response.json();
        return data.data.map((item) => item.embedding);
      },
    },
    ollama: {
      kind: "ollama",
      supports() {
        return true;
      },
      async embed(texts, options = {}) {
        const baseUrl = options.baseUrl || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
        const model = options.model || process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
        const embeddings = [];
        for (const text of texts) {
          const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/embed`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model, input: text }),
          });
          if (!response.ok) {
            throw new Error(`Ollama embeddings failed with status ${response.status}`);
          }
          const data = await response.json();
          embeddings.push(Array.isArray(data.embeddings) ? data.embeddings[0] : data.embedding);
        }
        return embeddings;
      },
    },
  };
}

function dot(a, b) {
  let sum = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) sum += a[index] * b[index];
  return sum;
}

function magnitude(vector) {
  return Math.sqrt(dot(vector, vector));
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) return 0;
  const denominator = magnitude(a) * magnitude(b);
  return denominator ? dot(a, b) / denominator : 0;
}

function buildBm25(chunks) {
  const docs = chunks.map((chunk) => tokenize(`${chunk.path} ${chunk.keywords || ""} ${chunk.text}`));
  const docCount = docs.length || 1;
  const avgDocLength = docs.reduce((sum, doc) => sum + doc.length, 0) / docCount || 1;
  const documentFrequency = new Map();

  docs.forEach((doc) => {
    for (const term of new Set(doc)) {
      documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    }
  });

  function scoreChunk(chunk, query) {
    const terms = tokenize(query);
    const doc = chunk._tokens;
    const frequencies = new Map();
    doc.forEach((term) => frequencies.set(term, (frequencies.get(term) || 0) + 1));
    let score = 0;
    for (const term of terms) {
      const tf = frequencies.get(term) || 0;
      if (!tf) continue;
      const df = documentFrequency.get(term) || 0;
      const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
      const k1 = 1.5;
      const b = 0.75;
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + (b * doc.length) / avgDocLength);
      score += idf * (numerator / denominator);
    }
    return score;
  }

  chunks.forEach((chunk, index) => {
    chunk._tokens = docs[index];
  });

  return { scoreChunk };
}

async function createIndex(rootDir, options = {}) {
  const scanned = readRepoFiles(rootDir, options.scanOptions);
  const embeddingProviders = createEmbeddingProviders();
  const files = [];
  const chunks = [];
  const symbols = {};

  for (const file of scanned.files) {
    let parsed = { imports: [], exports: [], symbols: [], calls: [] };
    if ([".js", ".cjs", ".mjs", ".jsx", ".ts", ".tsx"].includes(file.ext)) {
      try {
        parsed = parseJavaScript(file);
      } catch (error) {
        parsed = { imports: [], exports: [], symbols: [], calls: [] };
      }
    }
    const keywords = [
      file.path,
      ...parsed.imports,
      ...parsed.calls,
      ...parsed.symbols.map((symbol) => symbol.name),
    ].join(" ");
    const fileChunks = chunkText(file.text).map((chunk, index) => ({
      id: `${file.path}#${index}`,
      path: file.path,
      ext: file.ext,
      kind: "text",
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      text: chunk.text,
      keywords,
    }));
    const lines = file.text.split(/\r?\n/);
    const importContext = parsed.imports.length ? `// imports: ${parsed.imports.join(", ")}\n` : "";
    const symbolChunks = parsed.symbols.map((symbol) => {
      const startLine = Math.max(symbol.startLine || symbol.line || 1, 1);
      const endLine = Math.max(symbol.endLine || startLine, startLine);
      return {
        id: `${file.path}#symbol:${symbol.name}`,
        path: file.path,
        ext: file.ext,
        kind: "symbol",
        symbol: symbol.name,
        startLine,
        endLine,
        text: `${importContext}${lines.slice(startLine - 1, endLine).join("\n")}`,
        keywords: `${keywords} ${symbol.name} ${symbol.kind}`,
      };
    });
    parsed.symbols.forEach((symbol) => {
      if (!symbols[symbol.name]) symbols[symbol.name] = [];
      symbols[symbol.name].push({ path: file.path, line: symbol.line, kind: symbol.kind });
    });
    files.push({
      path: file.path,
      hash: file.hash,
      size: file.size,
      mtimeMs: file.mtimeMs,
      ext: file.ext,
      summary: summarizePath(file.path),
      imports: parsed.imports,
      exports: parsed.exports,
      symbols: parsed.symbols,
      calls: parsed.calls,
      chunkIds: [...fileChunks, ...symbolChunks].map((chunk) => chunk.id),
    });
    chunks.push(...symbolChunks, ...fileChunks);
  }

  const bm25 = buildBm25(chunks);

  return {
    generatedAt: new Date().toISOString(),
    rootDir,
    skipped: scanned.skipped,
    files,
    chunks,
    symbols,
    bm25,
    embeddingProviders,
  };
}

async function maybeEmbedTexts(texts, embeddingConfig, embeddingProviders) {
  if (!embeddingConfig || !embeddingConfig.provider) return null;
  const provider = embeddingProviders[embeddingConfig.provider];
  if (!provider || !provider.supports(embeddingConfig)) return null;
  return provider.embed(texts, embeddingConfig);
}

async function queryIndex(index, query, options = {}) {
  const scoredChunks = index.chunks.map((chunk) => ({
    ...chunk,
    lexicalScore: index.bm25.scoreChunk(chunk, query),
  }));

  const embeddingConfig = options.embedding || null;
  if (embeddingConfig?.provider) {
    try {
      const [queryVector] = await maybeEmbedTexts([query], embeddingConfig, index.embeddingProviders) || [];
      if (queryVector) {
        const chunkVectors = await maybeEmbedTexts(scoredChunks.map((chunk) => chunk.text), embeddingConfig, index.embeddingProviders);
        scoredChunks.forEach((chunk, indexValue) => {
          chunk.embeddingScore = cosineSimilarity(queryVector, chunkVectors[indexValue]);
        });
      }
    } catch (error) {
      scoredChunks.forEach((chunk) => {
        chunk.embeddingError = error.message;
      });
    }
  }

  scoredChunks.forEach((chunk) => {
    chunk.score = chunk.lexicalScore + (chunk.embeddingScore || 0) + extensionBoost(chunk.ext) + pathBoost(chunk.path) + kindBoost(chunk.kind) + exactMatchBoost(chunk, query) + intentPathBoost(chunk, query);
  });

  return scoredChunks
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit || 12);
}

function loadIndexFromDisk(stateDir) {
  const filePath = path.join(stateDir, "index.json");
  if (!fs.existsSync(filePath)) return null;
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  data.embeddingProviders = createEmbeddingProviders();
  data.bm25 = buildBm25(data.chunks || []);
  return data;
}

module.exports = {
  createEmbeddingProviders,
  createIndex,
  loadIndexFromDisk,
  queryIndex,
  tokenize,
};
