const { getEncoding } = require("js-tiktoken");

function inferProvider(model, provider) {
  if (provider) return provider;
  if (!model) return "unknown";
  if (/^(gpt|o1|o3|text-embedding)/i.test(model)) return "openai";
  if (/^claude/i.test(model)) return "anthropic";
  if (/gemini/i.test(model)) return "gemini";
  return "unknown";
}

function openAiEncodingName(model) {
  if (/^(gpt-4o|gpt-4\.1|o1|o3|text-embedding-3)/i.test(model)) return "o200k_base";
  return "cl100k_base";
}

function serializeMessages(messages) {
  return messages
    .map((message) => {
      const content = Array.isArray(message.content)
        ? message.content.map((item) => (typeof item === "string" ? item : item.text || JSON.stringify(item))).join("\n")
        : String(message.content || "");
      return `<${message.role || "user"}>\n${content}`;
    })
    .join("\n");
}

function createOpenAiProvider() {
  return {
    kind: "openai",
    supportsModel(model) {
      return /^(gpt|o1|o3|text-embedding)/i.test(model || "");
    },
    async countText({ model, text }) {
      const encoding = getEncoding(openAiEncodingName(model || "gpt-4o-mini"));
      return {
        status: "supported",
        provider: "openai",
        model,
        tokenCount: encoding.encode(String(text || "")).length,
        method: "js-tiktoken",
      };
    },
    async countMessages({ model, messages }) {
      const serialized = serializeMessages(messages || []);
      const textResult = await this.countText({ model, text: serialized });
      return {
        ...textResult,
        tokenCount: textResult.tokenCount,
        serialized,
      };
    },
  };
}

function createAnthropicProvider() {
  return {
    kind: "anthropic",
    supportsModel(model) {
      return /^claude/i.test(model || "");
    },
    async countText({ model, text }) {
      return this.countMessages({
        model,
        messages: [{ role: "user", content: String(text || "") }],
      });
    },
    async countMessages({ model, messages }) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return { status: "unsupported", provider: "anthropic", model, reason: "ANTHROPIC_API_KEY is not configured." };
      }
      const response = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          messages: messages || [],
        }),
      });
      if (!response.ok) {
        return { status: "unsupported", provider: "anthropic", model, reason: `Anthropic count_tokens failed: ${response.status}` };
      }
      const data = await response.json();
      return {
        status: "supported",
        provider: "anthropic",
        model,
        tokenCount: data.input_tokens || 0,
        method: "anthropic-count_tokens",
      };
    },
  };
}

function createGeminiProvider() {
  return {
    kind: "gemini",
    supportsModel(model) {
      return /gemini/i.test(model || "");
    },
    async countText({ model, text }) {
      return this.countMessages({
        model,
        messages: [{ role: "user", content: String(text || "") }],
      });
    },
    async countMessages({ model, messages }) {
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        return { status: "unsupported", provider: "gemini", model, reason: "GEMINI_API_KEY or GOOGLE_API_KEY is not configured." };
      }
      const contents = (messages || []).map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: Array.isArray(message.content) ? JSON.stringify(message.content) : String(message.content || "") }],
      }));
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:countTokens?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents }),
      });
      if (!response.ok) {
        return { status: "unsupported", provider: "gemini", model, reason: `Gemini countTokens failed: ${response.status}` };
      }
      const data = await response.json();
      return {
        status: "supported",
        provider: "gemini",
        model,
        tokenCount: data.totalTokens || 0,
        method: "gemini-countTokens",
      };
    },
  };
}

function createTokenCounterRegistry() {
  const providers = [
    createOpenAiProvider(),
    createAnthropicProvider(),
    createGeminiProvider(),
  ];

  function resolveProvider({ provider, model }) {
    const wanted = inferProvider(model, provider);
    return providers.find((entry) => entry.kind === wanted && entry.supportsModel(model || "")) || null;
  }

  async function estimate(input) {
    const provider = resolveProvider(input);
    if (!provider) {
      return {
        status: "unsupported",
        provider: inferProvider(input.model, input.provider),
        model: input.model,
        reason: "No exact token counter is configured for this provider/model.",
      };
    }
    if (input.messages) return provider.countMessages(input);
    return provider.countText(input);
  }

  return { estimate, providers };
}

module.exports = {
  createTokenCounterRegistry,
  inferProvider,
  serializeMessages,
};
