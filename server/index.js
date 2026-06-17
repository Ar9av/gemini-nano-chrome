#!/usr/bin/env node
// OpenAI-compatible HTTP server in front of Chrome's Gemini Nano. Implements
// the subset of the API surface that a single on-device text model can
// back: chat completions (streaming and non-streaming) and model listing.
// No dependencies beyond Node's built-in http module.
//
// Usage:
//   node server/index.js
//   PORT=8080 node server/index.js

const http = require("http");
const page = require("./page");
const {
  RequestError,
  randomId,
  parseMessages,
  mapResponseFormat,
  normalizeStop,
  applyStop,
  buildChatCompletionResponse,
  buildChunk,
  buildModelList,
} = require("./mapping");

const PORT = Number(process.env.PORT || 8788);

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        return reject(new RequestError("request body too large", 413));
      }
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new RequestError("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(data);
}

function sendError(res, err) {
  const status = err instanceof RequestError ? err.status : 500;
  if (!(err instanceof RequestError)) console.error(err);
  sendJson(res, status, { error: { message: err.message, type: status === 400 ? "invalid_request_error" : "server_error" } });
}

function buildChatRequest(body) {
  const { initialPrompts, promptText } = parseMessages(body.messages);
  const responseConstraint = mapResponseFormat(body.response_format);
  const stopSequences = normalizeStop(body.stop);
  const hasSampling = body.temperature !== undefined && body.top_k !== undefined;
  return {
    initialPrompts,
    promptText,
    responseConstraint,
    temperature: hasSampling ? body.temperature : undefined,
    topK: hasSampling ? body.top_k : undefined,
    stopSequences,
  };
}

async function handleChatCompletionsNonStreaming(body, res) {
  const request = buildChatRequest(body);
  const result = await page.runChatCompletion(request, () => {});
  const { text } = applyStop(result.text, request.stopSequences);

  sendJson(
    res,
    200,
    buildChatCompletionResponse({
      id: randomId("chatcmpl"),
      text,
      finishReason: "stop",
      usage: {
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
      },
    })
  );
}

async function handleChatCompletionsStreaming(body, res) {
  const request = buildChatRequest(body);
  const id = randomId("chatcmpl");

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  const write = (chunk) => res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  write(buildChunk(id, { role: "assistant", content: "" }, null));

  let sent = "";
  let stopped = false;

  const result = await page.runChatCompletionStreaming(
    request,
    (rawChunk) => {
      if (stopped) return;
      // rawChunk from promptStreaming is cumulative (each chunk contains all
      // text so far), not a delta. Extract only the new portion before
      // applying stop sequences.
      const delta = rawChunk.slice(sent.length);
      const { text: truncated, hit } = applyStop(sent + delta, request.stopSequences);
      const newPortion = truncated.slice(sent.length);
      if (newPortion) write(buildChunk(id, { content: newPortion }, null));
      sent = truncated;
      if (hit) stopped = true;
    },
    () => {}
  );

  write(buildChunk(id, {}, "stop"));
  if (body.stream_options?.include_usage) {
    res.write(
      `data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: "gemini-nano",
        choices: [],
        usage: {
          prompt_tokens: result.promptTokens,
          completion_tokens: result.completionTokens,
          total_tokens: result.totalTokens,
        },
      })}\n\n`
    );
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

async function handleChatCompletions(req, res) {
  const body = await readJsonBody(req);
  if (body.stream) {
    await handleChatCompletionsStreaming(body, res);
  } else {
    await handleChatCompletionsNonStreaming(body, res);
  }
}

async function handleHealth(req, res) {
  let availability = "unknown";
  try {
    availability = await page.checkAvailability(() => {});
  } catch (err) {
    availability = `error: ${err.message}`;
  }
  sendJson(res, 200, { status: "ok", model: "gemini-nano", availability });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    });
    return res.end();
  }

  try {
    if (req.method === "GET" && req.url === "/health") {
      return await handleHealth(req, res);
    }
    if (req.method === "GET" && req.url === "/v1/models") {
      return sendJson(res, 200, buildModelList());
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      return await handleChatCompletions(req, res);
    }
    sendJson(res, 404, { error: { message: `no route for ${req.method} ${req.url}`, type: "invalid_request_error" } });
  } catch (err) {
    sendError(res, err);
  }
});

function start(port = PORT) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.removeListener("error", reject);
      console.log(`Gemini Nano OpenAI-compatible server listening on http://localhost:${port}`);
      console.log("Endpoints: GET /health, GET /v1/models, POST /v1/chat/completions");
      resolve(server);
    });
  });
}

if (require.main === module) {
  start().catch((err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is already in use. Set PORT to something else or stop whatever's using it.`);
    } else {
      console.error(err);
    }
    process.exit(1);
  });
}

module.exports = { server, start };
