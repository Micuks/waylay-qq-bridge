"use strict";

const { Bridge } = require("./bridge");
const { BridgeServer } = require("./server");
const { OneBotAdapter } = require("./onebot/adapter");
const { MilkyAdapter } = require("./milky/adapter");

// --- Parse CLI arguments and environment ---

function parseConfig() {
  const config = {
    port: parseInt(process.env.BRIDGE_PORT || "13000"),
    host: process.env.BRIDGE_HOST || "0.0.0.0",
    quickLoginQQ: process.env.AUTO_LOGIN_QQ || "",
    qqResourceAppDir: process.env.QQ_APP_DIR || "/opt/QQ/resources/app",

    // OneBot v11 config
    onebotWsPort: parseInt(process.env.ONEBOT_WS_PORT || "0"),
    onebotWsHost: process.env.ONEBOT_WS_HOST || "0.0.0.0",
    onebotWsReverseUrls: parseJsonArray(process.env.ONEBOT_WS_REVERSE_URLS || ""),
    onebotToken: process.env.ONEBOT_TOKEN || "",

    // Milky protocol config
    milkyPort: parseInt(process.env.MILKY_HTTP_PORT || "0"),
    milkyHost: process.env.MILKY_HOST || "0.0.0.0",
    milkyToken: process.env.MILKY_TOKEN || "",
    milkyWebhookUrls: parseJsonArray(process.env.MILKY_WEBHOOK_URLS || ""),
  };

  for (const arg of process.argv) {
    if (arg.startsWith("--port=")) config.port = parseInt(arg.split("=")[1]);
    if (arg.startsWith("--host=")) config.host = arg.split("=")[1];
    if (arg.startsWith("--qq-app-dir=")) config.qqResourceAppDir = arg.split("=")[1];
    if (arg.startsWith("--quick-login=")) config.quickLoginQQ = arg.split("=")[1];
    if (arg.startsWith("--onebot-ws-port=")) config.onebotWsPort = parseInt(arg.split("=")[1]);
    if (arg.startsWith("--onebot-ws-reverse=")) {
      config.onebotWsReverseUrls = parseJsonArray(arg.split("=").slice(1).join("="));
    }
    if (arg.startsWith("--onebot-token=")) config.onebotToken = arg.split("=")[1];
    if (arg.startsWith("--milky-port=")) config.milkyPort = parseInt(arg.split("=")[1]);
    if (arg.startsWith("--milky-token=")) config.milkyToken = arg.split("=")[1];
    if (arg.startsWith("--milky-webhook=")) {
      config.milkyWebhookUrls = parseJsonArray(arg.split("=").slice(1).join("="));
    }
  }

  return config;
}

function parseJsonArray(str) {
  if (!str) return [];
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return str.split(",").map((s) => s.trim()).filter(Boolean);
  }
}

module.exports = { parseConfig };

async function main() {
  const config = parseConfig();

  console.log("=== waylay v0.2.0 ===");
  console.log(`[main] Config:`, JSON.stringify(config, null, 2));

  const bridge = new Bridge(config);

  // Bridge server (for LLOneBot backward compat)
  const server = new BridgeServer(config.port, config.host, bridge);
  bridge.setServer(server);

  // OneBot v11 adapter (for Yunzai / other frameworks)
  const hasOneBot = config.onebotWsPort || config.onebotWsReverseUrls.length;
  let onebotAdapter = null;
  if (hasOneBot) {
    onebotAdapter = new OneBotAdapter(
      {
        wsPort: config.onebotWsPort,
        wsHost: config.onebotWsHost,
        wsReverseUrls: config.onebotWsReverseUrls,
        token: config.onebotToken,
      },
      bridge
    );
    bridge.setOneBotAdapter(onebotAdapter);
  }

  // Milky protocol adapter
  let milkyAdapter = null;
  if (config.milkyPort) {
    milkyAdapter = new MilkyAdapter(
      {
        port: config.milkyPort,
        host: config.milkyHost,
        token: config.milkyToken,
        webhookUrls: config.milkyWebhookUrls,
      },
      bridge
    );
    bridge.setMilkyAdapter(milkyAdapter);
  }

  // Start servers
  await server.start();
  if (onebotAdapter) await onebotAdapter.start();
  if (milkyAdapter) await milkyAdapter.start();

  // Then initialize NTQQ
  await bridge.init();

  console.log("[main] Bridge is running. Waiting for QQ login...");
}

main().catch((e) => {
  console.error("[main] Fatal error:", e);
  process.exit(1);
});
