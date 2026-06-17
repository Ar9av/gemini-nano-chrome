// Minimal Chrome DevTools Protocol client. Needs Node 22+ for the built-in
// fetch and WebSocket globals. No dependencies.

const PORT = Number(process.env.CDP_PORT || 9333);

async function listTargets() {
  const res = await fetch(`http://localhost:${PORT}/json`);
  return res.json();
}

async function newTarget(url) {
  const res = await fetch(`http://localhost:${PORT}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT",
  });
  const target = await res.json();
  // The target exists as soon as this resolves, but the page hasn't finished
  // navigating yet. Evaluating against it immediately runs in a blank context.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return target;
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", reject);
  });
}

function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const handler = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === id) {
        ws.removeEventListener("message", handler);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(targetId, expression) {
  const ws = await connect(`ws://localhost:${PORT}/devtools/page/${targetId}`);
  await send(ws, "Runtime.enable");
  const result = await send(ws, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  ws.close();
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || "evaluate failed");
  }
  return result.result.value;
}

// Recurses through shadow roots. Chrome's internal pages (chrome://flags,
// chrome://on-device-internals) are built from custom elements whose content
// lives in shadow DOM and is invisible to a plain querySelector/innerText.
const DEEP_QUERY_ALL_SOURCE = `
  function deepQueryAll(root, sel) {
    let results = [...root.querySelectorAll(sel)];
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) results = results.concat(deepQueryAll(el.shadowRoot, sel));
    }
    return results;
  }
`;

const DEEP_TEXT_SOURCE = `
  function deepText(root) {
    let out = '';
    for (const node of root.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent.trim();
        if (t) out += t + ' ';
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.shadowRoot) out += deepText(node.shadowRoot);
        out += deepText(node);
      }
    }
    return out;
  }
`;

module.exports = {
  PORT,
  listTargets,
  newTarget,
  evaluate,
  DEEP_QUERY_ALL_SOURCE,
  DEEP_TEXT_SOURCE,
};
