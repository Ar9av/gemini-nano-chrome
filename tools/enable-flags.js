#!/usr/bin/env node
// Enables the two flags Gemini Nano needs, in a throwaway Chrome profile, without
// touching your everyday Chrome install or profile.
//
// Usage:
//   node tools/enable-flags.js
//   CHROME_BIN=/path/to/chrome PROFILE_DIR=/tmp/my-profile node tools/enable-flags.js

const { ensureChromeReady } = require("./chrome");

ensureChromeReady({ log: console.log })
  .then(() => {
    console.log("\nRun tools/smoke-test.js next to download the model and run a real prompt.");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
