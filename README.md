# Gemini Nano in Chrome

Chrome ships a small local language model, Gemini Nano, built into the browser. It's exposed through a JavaScript API called the Prompt API (`LanguageModel`). No API key, no server, no network calls once the model is downloaded. Everything runs on the user's machine.

This repo covers how to turn it on and what the API can do. It also includes scripts that automate setup and verification end to end.

## Requirements

| | |
|---|---|
| Chrome | 138+ (Dev or Canary channel recommended; this repo was verified on 149) |
| OS | Windows 10/11, macOS 13+, Linux, or ChromeOS on a Chromebook Plus |
| Storage | 22 GB free |
| GPU | 4 GB+ VRAM, **or** |
| CPU | 16 GB+ RAM and 4+ cores |
| Network | Unmetered connection for the one-time ~4 GB model download |

## Enabling it

1. Open `chrome://flags/#optimization-guide-on-device-model` and set it to **Enabled BypassPerfRequirement**
2. Open `chrome://flags/#prompt-api-for-gemini-nano` and set it to **Enabled**
3. Relaunch Chrome (the flags page has a button for this)

That's the whole setup. Everything else happens through JavaScript.

## Quick start

Open DevTools on any page and run:

```js
const availability = await LanguageModel.availability();
console.log(availability); // "unavailable" | "downloadable" | "downloading" | "available"

const session = await LanguageModel.create();
const answer = await session.prompt("What are you, in one sentence?");
console.log(answer);

session.destroy();
```

The first `create()` call starts the model download. `availability()` only reports state; it doesn't advance the download on its own. See [`examples/basic-prompt.js`](examples/basic-prompt.js) for a version that also reports download progress.

## Structured output

Constrain the response to a JSON Schema with `responseConstraint`, and you get back parseable JSON instead of free-form prose:

```js
const session = await LanguageModel.create();

const schema = {
  type: "object",
  properties: {
    sentiment: { type: "string", enum: ["positive", "negative", "neutral"] },
    confidence: { type: "number" },
  },
  required: ["sentiment", "confidence"],
};

const result = await session.prompt(
  'Classify the sentiment of: "This new on-device AI is shockingly fast and works offline."',
  { responseConstraint: schema }
);

JSON.parse(result); // { sentiment: "positive", confidence: 0.95 }
```

Full example: [`examples/structured-output.js`](examples/structured-output.js).

## Streaming

```js
const session = await LanguageModel.create();
const stream = session.promptStreaming("List 3 advantages of on-device AI.");
for await (const chunk of stream) console.log(chunk);
```

Full example: [`examples/streaming.js`](examples/streaming.js).

## OpenAI-compatible API server

Gemini Nano only runs inside a browser tab, so a Python script or an existing OpenAI client can't call it directly. `server/index.js` bridges that gap: a small HTTP server that speaks the OpenAI chat completions format on one side and drives a real Chrome tab over CDP on the other.

```bash
node server/index.js          # listens on http://localhost:8788
PORT=8080 node server/index.js
```

It launches Chrome itself on the first request if nothing is running yet, the same way `tools/enable-flags.js` does.

| Endpoint | Behavior |
|---|---|
| `POST /v1/chat/completions` | Standard request/response shape, `stream: true` for SSE |
| `GET /v1/models` | Lists a single model, `gemini-nano` |
| `GET /health` | Reports `LanguageModel.availability()` |

```bash
curl http://localhost:8788/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "What are you, in one sentence?"}]
  }'
```

That also means it works with the official OpenAI SDKs, by pointing them at the local server instead of api.openai.com:

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:8788/v1", api_key="not-needed")
response = client.chat.completions.create(
    model="gemini-nano",
    messages=[{"role": "user", "content": "What are you, in one sentence?"}],
)
print(response.choices[0].message.content)
```

A plain-fetch version with streaming is in [`examples/openai-client.js`](examples/openai-client.js).

`response_format` with a `json_schema` maps to `responseConstraint`, so the structured-output example above works the same way through the server:

```bash
curl http://localhost:8788/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Classify the sentiment of: \"This works great.\""}],
    "response_format": {
      "type": "json_schema",
      "json_schema": { "name": "sentiment", "schema": {
        "type": "object",
        "properties": { "sentiment": {"type": "string"}, "confidence": {"type": "number"} },
        "required": ["sentiment", "confidence"]
      }}
    }
  }'
```

### What's supported and what isn't

The full message history (`system`/`user`/`assistant`) maps to a real Prompt API session via `initialPrompts`, so multi-turn conversations carry context correctly. Beyond that:

- `temperature` and `top_k` are honored only when both are set together, and only take effect outside flags-only dev mode (Origin Trial or extension context). In plain flags mode the request still succeeds, with the default sampling instead.
- `stop` sequences are matched client-side against the streamed text. Once matched, the server stops forwarding further tokens to you, but Chrome keeps generating internally until it finishes.
- `usage` numbers come from `session.contextUsage` before and after the call, which is an estimate, not an exact token count from Gemini Nano's own tokenizer.
- No image input, no `max_tokens`, no `n` (multiple completions), no `/v1/completions` or `/v1/embeddings`. Gemini Nano's Prompt API doesn't expose the hooks those need.
- Each request creates a fresh session built from the messages you sent. The server itself holds no conversation state between requests.

### A note on the profile directory

If you already ran `tools/enable-flags.js` or `tools/smoke-test.js` with a custom `PROFILE_DIR`, set the same value when starting the server, or it launches a separate Chrome profile and downloads the model again:

```bash
PROFILE_DIR=/tmp/my-profile node server/index.js
```

## Automating setup and testing

Clicking through `chrome://flags` by hand works fine once, but it gets old if you're testing repeatedly or want a reproducible setup. `tools/` has two Node scripts that drive a real Chrome instance over the Chrome DevTools Protocol (CDP) instead:

```bash
node tools/enable-flags.js   # launches Chrome in a throwaway profile with both flags set
node tools/smoke-test.js     # triggers the download, waits for it, and runs a real prompt
```

`enable-flags.js` launches Chrome with `--user-data-dir` pointed at a fresh profile, so it never touches your normal browser session or settings, plus `--remote-debugging-port`. It then sets the flags by clicking the same dropdowns you'd click by hand, driven through `Runtime.evaluate`. Chrome's internal pages like `chrome://flags` and `chrome://on-device-internals` are built from web components whose content lives in shadow DOM, so the script walks shadow roots recursively to find the controls.

`smoke-test.js` connects to that instance, calls `LanguageModel.create()`, and polls `chrome://on-device-internals` for the install progress while it waits. That confirms the ~4 GB download completes instead of watching a `"downloading"` status with no further detail.

Both scripts need Node 22+ (for the built-in `fetch` and `WebSocket` globals) and no dependencies.

```bash
# defaults to /Applications/Google Chrome.app on macOS, google-chrome on Linux
CHROME_BIN=/path/to/chrome PROFILE_DIR=/tmp/my-profile node tools/enable-flags.js
```

## What's installed

Once installed, `chrome://on-device-internals` (enable internal debug pages first via `chrome://chrome-urls`) shows the model in use:

```
Model Name: v3Nano
Backend Type: GPU (highest quality)
Folder size: ~4,072 MiB
```

Session limits in this build: a 9216-token context window, with `session.contextUsage` / `session.contextWindow` to track consumption as you go.

## Other built-in APIs

The same on-device model backs several task-specific APIs, each scoped to a narrower job than the general-purpose Prompt API:

| API | Purpose |
|---|---|
| [Summarizer](https://developer.chrome.com/docs/ai/summarizer-api) | Condense text into headlines, summaries, or key points |
| [Writer](https://developer.chrome.com/docs/ai/writer-api) | Generate new text from a prompt |
| [Rewriter](https://developer.chrome.com/docs/ai/rewriter-api) | Revise existing text per instructions |
| [Proofreader](https://developer.chrome.com/docs/ai/proofreader-api) | Check spelling/grammar and suggest corrections |
| [Translator](https://developer.chrome.com/docs/ai/translator-api) | Translate between languages |
| [Language Detector](https://developer.chrome.com/docs/ai/language-detection) | Identify the language of a string |

Translator and Language Detector are desktop-only; the rest share the Prompt API's platform requirements above.

## Shipping this to real users

Flags only work for you, locally. For a production site, you need either:

- An [Origin Trial](https://developer.chrome.com/origintrials) token registered for your origin, or
- Distribution as a Chrome Extension, which gets stable access without a trial

Either way, treat the API as progressive enhancement: check `availability()` and provide a fallback for browsers or devices where it returns `"unavailable"`.

## Troubleshooting

**`LanguageModel is not defined`**: one of the two flags isn't set, or Chrome wasn't relaunched after setting them. Check `chrome://version` to confirm which flags are active.

**`availability()` stays on `"downloading"` forever**: expected if you never called `create()`. The model downloads only in response to a `create()` call from a JavaScript context.

**`LanguageModel.params is not a function`**: some Chrome builds don't expose this method yet, despite it appearing in the docs. Check `Object.getOwnPropertyNames(LanguageModel)` for what your version supports before relying on it.

**`chrome://on-device-internals` says debugging pages are disabled**: visit `chrome://chrome-urls` first and click "Enable internal debugging pages."

## License

MIT, see [LICENSE](LICENSE).
