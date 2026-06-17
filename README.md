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
