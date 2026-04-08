"use strict";

/**
 * Entry point when running inside QQ's Electron process.
 *
 * QQ's package.json is patched to set "main" to this file.
 * This gives us access to all native symbols (qq_magic_napi_register, etc.)
 * that wrapper.node requires.
 */

// Make sure we can find our npm modules (ws, etc.)
module.paths.push("/app/qq-bridge/node_modules");

// Prevent Electron from opening any BrowserWindow
const { app } = require("electron");
app.on("window-all-closed", (e) => e.preventDefault());
app.disableHardwareAcceleration();

app.whenReady().then(() => {
  console.log("[electron-entry] Electron ready, starting qq-bridge...");
  require("/app/qq-bridge/src/index.js");
});
