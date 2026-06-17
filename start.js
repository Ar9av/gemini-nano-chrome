#!/usr/bin/env node
// One command for the whole stack: launches Chrome with the required flags,
// starts the OpenAI-compatible API server, serves the chat UI, and opens it
// in a browser tab.
//
// Usage:
//   node start.js
//   npm start

const http = require("http");
const fs = require("fs");
const path = require("path");
const { ensureChromeReady } = require("./tools/chrome");
const { newTarget } = require("./tools/cdp-client");
const { start: startApiServer } = require("./server/index");

const WEB_PORT = Number(process.env.WEB_PORT || 8123);
const API_PORT = Number(process.env.PORT || 8788);

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
};

function startWebServer() {
  const webDir = path.join(__dirname, "web");
  const server = http.createServer((req, res) => {
    const requested = req.url === "/" ? "/index.html" : req.url;
    const filePath = path.resolve(webDir, "." + requested);
    if (!filePath.startsWith(webDir + path.sep) && filePath !== webDir) {
      res.writeHead(403);
      return res.end("forbidden");
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end("not found");
      }
      res.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(WEB_PORT, () => resolve(server));
  });
}

function explainPortConflict(err, port, label) {
  if (err.code === "EADDRINUSE") {
    console.error(`\nPort ${port} is already in use (${label}). Set a different port or stop whatever's using it.`);
  } else {
    console.error(err);
  }
  process.exit(1);
}

async function main() {
  console.log("Starting Gemini Nano...\n");
  await ensureChromeReady({ log: console.log });

  try {
    await startApiServer(API_PORT);
  } catch (err) {
    return explainPortConflict(err, API_PORT, "API server");
  }
  try {
    await startWebServer();
  } catch (err) {
    return explainPortConflict(err, WEB_PORT, "chat UI");
  }

  const chatUrl = `http://localhost:${WEB_PORT}/index.html`;
  console.log(`\nChat UI:    ${chatUrl}`);
  console.log(`API server: http://localhost:${API_PORT}/v1/chat/completions`);
  console.log("\nPress Ctrl+C to stop.");

  // Opened as a new tab inside the same flagged Chrome instance, not the
  // OS default browser, since that's the only instance with the right
  // flags and the downloaded model.
  await newTarget(chatUrl);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
