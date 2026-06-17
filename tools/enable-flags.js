#!/usr/bin/env node
// Enables the two flags Gemini Nano needs, in a throwaway Chrome profile, without
// touching your everyday Chrome install or profile.
//
// Usage:
//   node tools/enable-flags.js
//   CHROME_BIN=/path/to/chrome PROFILE_DIR=/tmp/my-profile node tools/enable-flags.js

const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const { listTargets, newTarget, evaluate, DEEP_QUERY_ALL_SOURCE, PORT } = require("./cdp-client");

const DEFAULT_CHROME_BIN = {
  darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  linux: "google-chrome",
  win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
}[os.platform()];

const CHROME_BIN = process.env.CHROME_BIN || DEFAULT_CHROME_BIN;
const PROFILE_DIR = process.env.PROFILE_DIR || path.join(os.tmpdir(), "gemini-nano-profile");

const FLAGS = [
  { internalName: "optimization-guide-on-device-model", option: "Enabled BypassPerfRequirement" },
  { internalName: "prompt-api-for-gemini-nano", option: "Enabled" },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCdp(retries = 40) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/json/version`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  throw new Error(`Chrome did not expose CDP on port ${PORT} in time`);
}

async function setFlagsAndRelaunch(targetId) {
  const setFlagsExpr = `
    ${DEEP_QUERY_ALL_SOURCE}
    (function() {
      const flags = ${JSON.stringify(FLAGS)};
      return flags.map(({ internalName, option }) => {
        const el = deepQueryAll(document, '#' + internalName)[0];
        if (!el) return 'missing: ' + internalName;
        const select = el.shadowRoot.querySelector('select');
        const opt = [...select.options].find((o) => o.text === option);
        if (!opt) return 'missing option "' + option + '" for ' + internalName;
        select.value = opt.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return internalName + ' -> ' + option;
      });
    })()
  `;
  const setResults = await evaluate(targetId, setFlagsExpr);
  console.log(setResults.join("\n"));

  const clickRestartExpr = `
    ${DEEP_QUERY_ALL_SOURCE}
    (function() {
      const app = deepQueryAll(document, 'flags-app')[0];
      const btn = app.shadowRoot.querySelector('#needs-restart cr-button');
      if (!btn) return false;
      btn.click();
      return true;
    })()
  `;
  const clicked = await evaluate(targetId, clickRestartExpr);
  if (!clicked) throw new Error("could not find the relaunch button on chrome://flags");
}

async function main() {
  console.log(`Launching Chrome with profile: ${PROFILE_DIR}`);
  spawn(
    CHROME_BIN,
    [
      `--user-data-dir=${PROFILE_DIR}`,
      `--remote-debugging-port=${PORT}`,
      "--no-first-run",
      "--no-default-browser-check",
      "chrome://flags/",
    ],
    { detached: true, stdio: "ignore" }
  ).unref();

  await waitForCdp();
  await sleep(1000);

  const targets = await listTargets();
  let flagsTarget = targets.find((t) => t.type === "page" && t.url.startsWith("chrome://flags"));
  if (!flagsTarget) flagsTarget = await newTarget("chrome://flags/");

  await sleep(500);
  await setFlagsAndRelaunch(flagsTarget.id);
  console.log("Relaunching Chrome to apply flags...");
  await sleep(2000);
  await waitForCdp();

  console.log(`\nDone. Chrome is running with CDP on port ${PORT} and the required flags set.`);
  console.log("Run tools/smoke-test.js next to download the model and run a real prompt.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
