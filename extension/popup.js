const statusEl = document.getElementById("status");
const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const clearBtn = document.getElementById("clearBtn");
const progressWrap = document.getElementById("progressWrap");
const progressFill = document.getElementById("progressFill");
const progressLabel = document.getElementById("progressLabel");

let session = null;
let starting = false;
let generating = null; // AbortController while a reply streams

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = kind || "";
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderInline(text) {
  // Split out `code` spans first so their contents aren't formatted.
  return text
    .split(/(`[^`\n]+`)/)
    .map((part, i) =>
      i % 2
        ? "<code>" + part.slice(1, -1) + "</code>"
        : part
            .replace(/\*\*(?!\s)(.+?)\*\*/g, "<strong>$1</strong>")
            .replace(/(^|[\s(])\*(?![\s*])([^*]+?)\*(?=[\s.,;:!?)]|$)/g, "$1<em>$2</em>")
    )
    .join("");
}

// Gemini Nano replies in Markdown (headings, bold, lists, paragraphs). This
// renders just enough of it, line by line, so raw "**" / "*" / "##" never
// show up in the chat. Nested lists are flattened.
function renderMarkdown(raw) {
  let html = "";
  let open = null; // "p" | "ul" | "ol"
  const close = () => { if (open) html += `</${open}>`; open = null; };
  const ensure = (tag, attrs = "") => { if (open !== tag) { close(); html += `<${tag}${attrs}>`; open = tag; } };
  for (const line of escapeHtml(raw).split("\n")) {
    const t = line.trim();
    let m;
    if (!t) close();
    else if ((m = t.match(/^#{1,6}\s+(.*)/))) { close(); html += `<p><strong>${renderInline(m[1])}</strong></p>`; }
    else if ((m = t.match(/^[*-]\s+(.*)/))) { ensure("ul"); html += `<li>${renderInline(m[1])}</li>`; }
    else if ((m = t.match(/^(\d+)[.)]\s+(.*)/))) { ensure("ol", ` start="${m[1]}"`); html += `<li>${renderInline(m[2])}</li>`; }
    else if (open === "p") html += "<br>" + renderInline(t);
    else { close(); html += "<p>" + renderInline(t); open = "p"; }
  }
  close();
  return html;
}

function addBubble(role, text) {
  const row = document.createElement("div");
  row.className = "bubble-row" + (role === "user" ? " user" : "");
  const bubble = document.createElement("div");
  bubble.className = "bubble " + role;
  bubble.textContent = text;
  row.appendChild(bubble);
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

function addNote(text, isError) {
  addBubble(isError ? "error" : "system-note", text);
}

// Without the dev flags, create() requires an active user gesture the first
// time a device hasn't downloaded the model yet. A popup losing focus tears
// the whole document down, so session creation happens lazily on the first
// real click of Send rather than eagerly on load, which would either fail
// outside a gesture or race the popup being closed mid-download.
async function checkAvailability() {
  if (typeof LanguageModel === "undefined") {
    setStatus("API not found", "error");
    addNote("LanguageModel isn't available in this Chrome version. Update Chrome and try again.", true);
    return;
  }

  const availability = await LanguageModel.availability();
  if (availability === "unavailable") {
    setStatus("unavailable", "error");
    addNote("This device doesn't meet Gemini Nano's hardware requirements.", true);
    return;
  }

  if (availability === "available") {
    setStatus("ready", "ready");
  } else {
    setStatus("ready", "ready");
    addNote("First message downloads the model (~4GB). Keep this popup open until it finishes.");
  }
  inputEl.disabled = false;
  sendBtn.disabled = false;
  inputEl.focus();
}

async function ensureSession() {
  if (session) return session;
  starting = true;
  progressWrap.style.display = "block";
  try {
    session = await LanguageModel.create({
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          const pct = Math.round(e.loaded * 100);
          progressFill.style.width = pct + "%";
          progressLabel.textContent = `Downloading model: ${pct}%`;
        });
      },
    });
    progressWrap.style.display = "none";
    return session;
  } finally {
    starting = false;
  }
}

async function send() {
  const text = inputEl.value.trim();
  if (!text || starting) return;

  addBubble("user", text);
  inputEl.value = "";
  inputEl.style.height = "auto";
  sendBtn.disabled = true;
  inputEl.disabled = true;
  setStatus("thinking...", "busy");

  try {
    await ensureSession();
  } catch (err) {
    setStatus("error", "error");
    addNote("Could not start a session: " + err.message, true);
    sendBtn.disabled = false;
    inputEl.disabled = false;
    return;
  }

  const assistantBubble = addBubble("assistant", "");
  assistantBubble.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
  generating = new AbortController();
  sendBtn.textContent = "Stop";
  sendBtn.classList.add("stop");
  sendBtn.disabled = false;
  let raw = "";
  try {
    const stream = session.promptStreaming(text, { signal: generating.signal });
    for await (const chunk of stream) {
      const stick = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 60;
      raw += chunk;
      assistantBubble.innerHTML = renderMarkdown(raw);
      if (stick) messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  } catch (err) {
    if (err.name === "AbortError") {
      assistantBubble.innerHTML = renderMarkdown(raw) + '<div class="stopped">Stopped</div>';
    } else {
      assistantBubble.classList.add("error");
      assistantBubble.textContent = "Error: " + err.message;
    }
  } finally {
    generating = null;
    sendBtn.textContent = "Send";
    sendBtn.classList.remove("stop");
    setStatus("ready", "ready");
    sendBtn.disabled = false;
    inputEl.disabled = false;
    inputEl.focus();
  }
}

sendBtn.addEventListener("click", () => (generating ? generating.abort() : send()));
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  } else if (e.key === "Escape" && generating) {
    generating.abort();
  }
});
inputEl.addEventListener("input", () => {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + "px";
});

clearBtn.addEventListener("click", () => {
  if (starting) return;
  generating?.abort();
  if (session) { session.destroy(); session = null; }
  messagesEl.innerHTML = "";
  checkAvailability();
});

checkAvailability();
