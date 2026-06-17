// Owns the single Chrome tab that all chat completion requests run against,
// and the JS expressions that drive LanguageModel from there.

const { newTarget, evaluate, evaluateStreaming } = require("../tools/cdp-client");
const { ensureChromeReady } = require("../tools/chrome");

let pageTargetId = null;

async function getPageTarget(log) {
  await ensureChromeReady({ log });
  if (!pageTargetId) {
    const target = await newTarget("https://example.com");
    pageTargetId = target.id;
  }
  return pageTargetId;
}

function buildCreateOptionsLiteral({ initialPrompts, temperature, topK }) {
  const opts = {};
  if (initialPrompts.length > 0) opts.initialPrompts = initialPrompts;
  if (temperature !== undefined && topK !== undefined) {
    opts.temperature = temperature;
    opts.topK = topK;
  }
  return JSON.stringify(opts);
}

// temperature/topK must be supplied as a pair, and may not be honored at all
// outside an Origin Trial or extension context. Falling back to a plain
// create() keeps the request working either way instead of failing it.
function buildExpression({ initialPrompts, promptText, responseConstraint, temperature, topK }, streamingBindingName) {
  const createOptsWithSampling = buildCreateOptionsLiteral({ initialPrompts, temperature, topK });
  const createOptsPlain = JSON.stringify(initialPrompts.length > 0 ? { initialPrompts } : {});
  const promptOpts = responseConstraint ? JSON.stringify({ responseConstraint }) : "{}";
  const promptLiteral = JSON.stringify(promptText);

  const generation = streamingBindingName
    ? `
      const stream = session.promptStreaming(${promptLiteral}, ${promptOpts});
      let text = '';
      for await (const chunk of stream) {
        text += chunk;
        window.${streamingBindingName}(chunk);
      }
    `
    : `
      const text = await session.prompt(${promptLiteral}, ${promptOpts});
    `;

  return `
    (async () => {
      let session;
      try {
        session = await LanguageModel.create(${createOptsWithSampling});
      } catch (e) {
        session = await LanguageModel.create(${createOptsPlain});
      }
      const before = session.contextUsage;
      ${generation}
      const after = session.contextUsage;
      session.destroy();
      return {
        text,
        promptTokens: before,
        completionTokens: Math.max(0, after - before),
        totalTokens: after,
      };
    })()
  `;
}

async function runChatCompletion(request, log) {
  const targetId = await getPageTarget(log);
  const expr = buildExpression(request, null);
  return evaluate(targetId, expr);
}

async function runChatCompletionStreaming(request, onChunk, log) {
  const targetId = await getPageTarget(log);
  const bindingName = "__ggn_emit_" + Math.random().toString(36).slice(2);
  const expr = buildExpression(request, bindingName);
  return evaluateStreaming(targetId, expr, bindingName, onChunk);
}

async function checkAvailability(log) {
  const targetId = await getPageTarget(log);
  return evaluate(targetId, "LanguageModel.availability()");
}

module.exports = { runChatCompletion, runChatCompletionStreaming, checkAvailability };
