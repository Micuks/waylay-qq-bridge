"use strict";

/**
 * Entry point: Standalone mode.
 *
 * Loads wrapper.node directly, handles engine init, login, and session
 * ourselves. No QQ GUI is loaded.
 */

module.paths.push("/app/qq-bridge/node_modules");

const { app } = require("electron");

app.disableHardwareAcceleration();

console.log("[hook] Starting bridge in standalone mode...");
app.on("ready", () => {
  console.log("[hook] App ready, loading bridge...");
  require("/app/qq-bridge/src/index.js");
});
