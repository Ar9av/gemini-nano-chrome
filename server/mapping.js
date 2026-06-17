// Translates between the OpenAI chat completions wire format and what
// Chrome's LanguageModel API accepts.

const MODEL_ID = "gemini-nano";

function randomId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
  }
  return "";
}

// The Prompt API takes a system/user/assistant history up front via
// initialPrompts, then a single new prompt() call for the turn you want a
// reply to. OpenAI's messages array bundles both, so the last message has to
// be split off and sent separately.
function parseMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new RequestError("messages must be a non-empty array");
  }
  const last = messages[messages.length - 1];
  if (last.role !== "user") {
    throw new RequestError("the last message must have role 'user'");
  }

  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => extractText(m.content))
    .join("\n\n");

  const history = messages
    .slice(0, -1)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: extractText(m.content) }));

  const initialPrompts = systemText
    ? [{ role: "system", content: systemText }, ...history]
    : history;

  return { initialPrompts, promptText: extractText(last.content) };
}

function mapResponseFormat(responseFormat) {
  if (!responseFormat) return undefined;
  if (responseFormat.type === "json_schema") {
    return responseFormat.json_schema?.schema;
  }
  if (responseFormat.type === "json_object") {
    return { type: "object" };
  }
  return undefined;
}

function normalizeStop(stop) {
  if (!stop) return [];
  return Array.isArray(stop) ? stop : [stop];
}

// Gemini Nano has no native stop-sequence support, so this is applied
// client-side after the fact: truncate at the first match.
function applyStop(text, stopSequences) {
  let cut = text.length;
  let hit = false;
  for (const seq of stopSequences) {
    const idx = text.indexOf(seq);
    if (idx !== -1 && idx < cut) {
      cut = idx;
      hit = true;
    }
  }
  return { text: text.slice(0, cut), hit };
}

class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function buildUsage({ promptTokens, completionTokens, totalTokens }) {
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  };
}

function buildChatCompletionResponse({ id, text, finishReason, usage }) {
  return {
    id,
    object: "chat.completion",
    created: nowSeconds(),
    model: MODEL_ID,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: finishReason,
      },
    ],
    usage: buildUsage(usage),
  };
}

function buildChunk(id, delta, finishReason) {
  return {
    id,
    object: "chat.completion.chunk",
    created: nowSeconds(),
    model: MODEL_ID,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function buildModelList() {
  return {
    object: "list",
    data: [{ id: MODEL_ID, object: "model", created: nowSeconds(), owned_by: "google" }],
  };
}

module.exports = {
  MODEL_ID,
  RequestError,
  randomId,
  parseMessages,
  mapResponseFormat,
  normalizeStop,
  applyStop,
  buildChatCompletionResponse,
  buildChunk,
  buildModelList,
};
