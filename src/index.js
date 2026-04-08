"use strict";

const { Bridge } = require("./bridge");
const { BridgeServer } = require("./server");

// --- Parse CLI arguments and environment ---

function parseConfig() {
  const config = {
    port: parseInt(process.env.BRIDGE_PORT || "13000"),
    host: process.env.BRIDGE_HOST || "0.0.0.0",
    quickLoginQQ: process.env.AUTO_LOGIN_QQ || "",
    qqResourceAppDir: process.env.QQ_APP_DIR || "/opt/QQ/resources/app",
  };

  for (const arg of process.argv) {
    if (arg.startsWith("--port=")) config.port = parseInt(arg.split("=")[1]);
    if (arg.startsWith("--host=")) config.host = arg.split("=")[1];
    if (arg.startsWith("--qq-app-dir=")) config.qqResourceAppDir = arg.split("=")[1];
    if (arg.startsWith("--quick-login=")) config.quickLoginQQ = arg.split("=")[1];
  }

  return config;
}

// Expose parseConfig for use by electron-entry or direct invocation
module.exports = { parseConfig };

async function main() {
  const config = parseConfig();

  console.log("=== qq-bridge v0.1.0 ===");
  console.log(`[main] Config:`, JSON.stringify(config, null, 2));

  const bridge = new Bridge(config);
  const server = new BridgeServer(config.port, config.host, bridge);
  bridge.setServer(server);

  // Start WebSocket/HTTP server first so LLOneBot can connect
  await server.start();

  // Then initialize NTQQ
  await bridge.init();

  console.log("[main] Bridge is running. Waiting for QQ login...");
}

main().catch((e) => {
  console.error("[main] Fatal error:", e);
  process.exit(1);
});
