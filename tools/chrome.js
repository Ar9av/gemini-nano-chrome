// Launches Chrome in a throwaway profile with the two flags Gemini Nano
// needs, or reuses an instance that's already running. Shared by the CLI
// entry point (enable-flags.js) and the OpenAI-compatible server.

const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const { listTargets, newTarget, evaluate, DEEP_QUERY_ALL_SOURCE, PORT } = require("./cdp-client");

const DEFAULT_CHROME_BIN = {
  darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  linux: "google-chrome",
  win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
}[os.platform()];

const FLAGS = [
  { internalName: "optimization-guide-on-device-model", option: "Enabled BypassPerfRequirement" },
  { internalName: "prompt-api-for-gemini-nano", option: "Enabled" },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isCdpUp() {
  try {
    const res = await fetch(`http://localhost:${PORT}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForCdp(retries = 40) {
  for (let i = 0; i < retries; i++) {
    if (await isCdpUp()) return;
    await sleep(250);
  }
  throw new Error(`Chrome did not expose CDP on port ${PORT} in time`);
}

async function setFlagsAndRelaunch(targetId, log) {
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
  log(setResults.join("\n"));

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

// Idempotent: if Chrome is already up on the configured CDP port (most
// likely because a previous run already set the flags in this profile),
// this returns immediately instead of relaunching.
async function ensureChromeReady({
  chromeBin = process.env.CHROME_BIN || DEFAULT_CHROME_BIN,
  profileDir = process.env.PROFILE_DIR || path.join(os.tmpdir(), "gemini-nano-profile"),
  log = () => {},
} = {}) {
  if (await isCdpUp()) {
    log(`Reusing Chrome already running on CDP port ${PORT}`);
    return;
  }

  log(`Launching Chrome with profile: ${profileDir}`);
  spawn(
    chromeBin,
    [
      `--user-data-dir=${profileDir}`,
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
  await setFlagsAndRelaunch(flagsTarget.id, log);
  log("Relaunching Chrome to apply flags...");
  await sleep(2000);
  await waitForCdp();
  log(`Chrome is running with CDP on port ${PORT} and the required flags set.`);
}

module.exports = { ensureChromeReady, isCdpUp, waitForCdp };
