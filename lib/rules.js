const fs = require("node:fs");
const path = require("node:path");

const RULE_HINTS = [
  /^rules:/i,
  /^- /,
  /^\* /,
  /never/i,
  /validate/i,
  /no secrets?/i,
  /query\/check the index/i,
  /before broad reads/i,
];

function collectRuleLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => RULE_HINTS.some((pattern) => pattern.test(line)))
    .map((line) => line.replace(/^[-*]\s*/, "").trim());
}

function normalizeRule(line) {
  return line.replace(/\s+/g, " ").replace(/\.$/, "").trim();
}

function getPinnedRules(rootDir) {
  const candidates = [
    path.join(rootDir, "AGENTS.md"),
    path.join(rootDir, ".agent-index", "AGENTS.full.md"),
  ];
  const seen = new Set();
  const rules = [];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const text = fs.readFileSync(filePath, "utf8");
    for (const raw of collectRuleLines(text)) {
      const normalized = normalizeRule(raw);
      if (!normalized || seen.has(normalized.toLowerCase())) continue;
      seen.add(normalized.toLowerCase());
      rules.push({
        text: normalized,
        source: path.relative(rootDir, filePath).replace(/\\/g, "/"),
        priority: /never|no secrets|validate/i.test(normalized) ? "critical" : "default",
      });
    }
  }

  return rules.slice(0, 16);
}

module.exports = { getPinnedRules };
