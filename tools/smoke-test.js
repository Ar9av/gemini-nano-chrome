#!/usr/bin/env node
// Creates a LanguageModel session and runs a real prompt against it. On first
// run this downloads the ~4GB model, which is what calling LanguageModel.create()
// triggers. LanguageModel.availability() on its own does not move the
// download forward, it only reports state.
//
// Launches Chrome with the required flags if it isn't already running.
//
// Usage:
//   node tools/smoke-test.js

const {
  newTarget,
  evaluate,
  DEEP_QUERY_ALL_SOURCE,
  DEEP_TEXT_SOURCE,
} = require("./cdp-client");
const { ensureChromeReady } = require("./chrome");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function enableDebugPages() {
  const target = await newTarget("chrome://chrome-urls/");
  const expr = `
    ${DEEP_QUERY_ALL_SOURCE}
    (function() {
      const btn = deepQueryAll(document, 'button, a, cr-button')
        .find((b) => /enable/i.test(b.textContent));
      if (btn) { btn.click(); return true; }
      return false;
    })()
  `;
  await evaluate(target.id, expr);
}

async function getInstallState(internalsTargetId) {
  const expr = `
    ${DEEP_TEXT_SOURCE}
    (function() {
      const txt = deepText(document.body);
      const marker = 'Foundational model state:';
      const idx = txt.indexOf(marker);
      if (idx === -1) return 'unknown';
      const rest = txt.slice(idx + marker.length);
      const end = rest.indexOf('Uninstall Model');
      return (end !== -1 ? rest.slice(0, end) : rest.slice(0, 80)).trim();
    })()
  `;
  return evaluate(internalsTargetId, expr);
}

async function watchProgress(internalsTargetId, isDone) {
  let last = "";
  while (!isDone()) {
    const state = await getInstallState(internalsTargetId).catch(() => null);
    if (state && state !== last) {
      console.log(`  model state: ${state}`);
      last = state;
    }
    await sleep(3000);
  }
}

async function main() {
  await ensureChromeReady({ log: console.log });
  await enableDebugPages();
  const internals = await newTarget("chrome://on-device-internals/");

  const pageTarget = await newTarget("https://example.com");

  console.log("Checking availability...");
  const availability = await evaluate(pageTarget.id, "LanguageModel.availability()");
  console.log(`availability: ${availability}`);

  console.log("Creating session (this triggers the model download on first run)...");
  let done = false;
  watchProgress(internals.id, () => done);

  const promptExpr = `
    (async () => {
      const t0 = performance.now();
      const session = await LanguageModel.create();
      const answer = await session.prompt("What are you, in one sentence?");
      const elapsedMs = Math.round(performance.now() - t0);
      session.destroy();
      return { answer, elapsedMs };
    })()
  `;
  const result = await evaluate(pageTarget.id, promptExpr);
  done = true;

  console.log(`\nanswer: ${result.answer}`);
  console.log(`elapsed: ${result.elapsedMs}ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
