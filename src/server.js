"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer, WebSocket } = require("ws");
const { randomUUID } = require("crypto");

const WEB_ROOT = path.join(__dirname, "web");
const STATIC_MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".ico":  "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".txt":  "text/plain; charset=utf-8",
  ".woff2":"font/woff2",
};

const SERVER_VERSION = "qq-bridge/0.4.1";
const SERVER_START_MS = Date.now();

function wantsHtml(req) {
  const accept = (req.headers["accept"] || "").toLowerCase();
  return accept.includes("text/html");
}

function safeJoin(root, relUrl) {
  // Strip query/hash, decode, then resolve under root. Returns null on traversal.
  const cleaned = relUrl.split("?")[0].split("#")[0].replace(/^\/+/, "");
  let decoded;
  try { decoded = decodeURIComponent(cleaned); } catch { return null; }
  if (decoded.includes("\0")) return null;
  const full = path.normalize(path.join(root, decoded));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

function serveFile(res, fullPath, fallbackMime) {
  fs.readFile(fullPath, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    const ext = path.extname(fullPath).toLowerCase();
    const mime = STATIC_MIME[ext] || fallbackMime || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": mime,
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=300",
    });
    res.end(buf);
  });
}

/**
 * Combined WebSocket + HTTP server for bridge protocol.
 *
 * Downstream (LLOneBot) connects via:
 *   - WebSocket: ws://host:port/ws
 *   - HTTP POST: http://host:port/
 *
 * Protocol messages:
 *   Request (from LLOneBot):
 *     { type: "call",      data: { func, args, echo } }
 *     { type: "send",      data: { cmd, pb, echo } }       // raw SSO packet
 *     { type: "send_pb",   data: { cmd, pb, echo } }       // alias
 *     { type: "tell_port", data: { webui_port, echo } }
 *
 *   Response (to LLOneBot, matched by echo):
 *     { type: "call",      data: { result, echo } }
 *     { type: "send",      data: { pb, echo } }
 *
 *   Event push (to LLOneBot, unsolicited):
 *     { type: "on_message"|"on_group"|..., data: { sub_type, data } }
 */
class BridgeServer {
  constructor(port, host, bridge) {
    this.port = port;
    this.host = host;
    this.bridge = bridge;
    this.wsClients = new Set();

    this.httpServer = http.createServer(this._handleHttp.bind(this));
    this.wss = new WebSocketServer({ server: this.httpServer, path: "/ws" });
    this.wss.on("connection", (ws) => this._handleWsConnection(ws));
  }

  start() {
    return new Promise((resolve, reject) => {
      this.httpServer.listen(this.port, this.host, () => {
        console.log(`[server] Listening on ${this.host}:${this.port}`);
        const display = this.host === "0.0.0.0" || this.host === "::" ? "0.0.0.0" : this.host;
        const base = `http://${display}:${this.port}`;
        console.log(`[ui] Web console available on ${this.host} (all interfaces${this.host === "0.0.0.0" ? "" : " — set BRIDGE_HOST=0.0.0.0 to expose externally"}):`);
        console.log(`[ui]   landing  → ${base}/`);
        console.log(`[ui]   docs     → ${base}/docs`);
        console.log(`[ui]   login QR → ${base}/qrcode`);
        console.log(`[ui]   status   → ${base}/api/status`);
        resolve();
      });
      this.httpServer.on("error", reject);
    });
  }

  /** Broadcast an event to all connected WebSocket clients */
  broadcast(message) {
    const payload = JSON.stringify(message, mapReplacer);
    for (const ws of this.wsClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  /** Push a kernel event to connected clients */
  pushEvent(listenerName, eventName, data) {
    const typeMap = {
      nodeIKernelMsgListener: "on_message",
      nodeIKernelGroupListener: "on_group",
      nodeIKernelBuddyListener: "on_buddy",
      nodeIKernelProfileListener: "on_profile",
      nodeIKernelFlashTransferListener: "on_flash_file",
      nodeIKernelLoginListener: "on_login",
      nodeIKernelOnlineStatusListener: "on_online_status",
      nodeIKernelRecentContactListener: "on_recent_contact",
      nodeIKernelStorageCleanListener: "on_storage_clean",
      nodeIKernelRobotListener: "on_robot",
      nodeIKernelSearchListener: "on_search",
      nodeIKernelCollectionListener: "on_collection",
      nodeIKernelYellowFaceListener: "on_yellow_face",
      nodeIKernelFileAssistantListener: "on_file_assistant",
      nodeIKernelSessionListener: "on_session",
      nodeIKernelSettingListener: "on_setting",
      nodeIQQNTWrapperSessionListener: "on_session",
    };
    const type = typeMap[listenerName] || listenerName;
    this.broadcast({ type, data: { sub_type: eventName, data } });
  }

  // --- WebSocket handling ---

  _handleWsConnection(ws) {
    console.log("[server] WebSocket client connected");
    this.wsClients.add(ws);
    ws.on("close", () => {
      console.log("[server] WebSocket client disconnected");
      this.wsClients.delete(ws);
    });
    ws.on("error", (err) => {
      console.error("[server] WebSocket error:", err.message);
      this.wsClients.delete(ws);
    });
    ws.on("message", async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const result = await this._handleRequest(msg);
      if (result && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(result, mapReplacer));
      }
    });
  }

  // --- HTTP handling ---

  _handleHttp(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      return res.end();
    }

    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        let msg;
        try {
          msg = JSON.parse(body);
        } catch {
          res.writeHead(400);
          return res.end("Invalid JSON");
        }
        const result = await this._handleRequest(msg);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result || {}, mapReplacer));
      });
      return;
    }

    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Method not allowed");
    }

    const urlPath = (req.url || "/").split("?")[0];

    // Static asset directories (under src/web/)
    if (urlPath.startsWith("/static/")) {
      const full = safeJoin(WEB_ROOT, urlPath);
      if (!full) { res.writeHead(400); return res.end("Bad path"); }
      return serveFile(res, full);
    }
    if (urlPath.startsWith("/assets/")) {
      const full = safeJoin(WEB_ROOT, urlPath);
      if (!full) { res.writeHead(400); return res.end("Bad path"); }
      return serveFile(res, full);
    }

    // Brand favicon shortcut
    if (urlPath === "/favicon.ico" || urlPath === "/favicon.svg") {
      return serveFile(res, path.join(WEB_ROOT, "assets", "favicon.svg"));
    }

    // Live status JSON for the dashboard
    if (urlPath === "/api/status") {
      return this._handleStatus(req, res);
    }

    // QR code: PNG by default, HTML shell when a browser asks for it
    if (urlPath === "/qrcode" || urlPath === "/qr") {
      if (wantsHtml(req)) {
        return serveFile(res, path.join(WEB_ROOT, "qrcode.html"));
      }
      return this._serveQrPng(res);
    }
    if (urlPath === "/qrcode.png" || urlPath === "/qr.png") {
      return this._serveQrPng(res);
    }

    // Docs live in the standalone wiki — redirect for anyone who keeps typing /docs
    if (urlPath === "/docs" || urlPath === "/docs/") {
      const target = process.env.WAYLAY_WIKI_URL || "https://waylay-wiki.micuks.click/";
      res.writeHead(302, { Location: target });
      return res.end();
    }

    // Landing — HTML for browsers, JSON status for everything else
    if (urlPath === "/" || urlPath === "/index.html") {
      if (wantsHtml(req)) {
        return serveFile(res, path.join(WEB_ROOT, "index.html"));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ status: "ok", version: SERVER_VERSION }));
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }

  _serveQrPng(res) {
    fs.readFile("/tmp/qrcode.png", (err, buf) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("QR code not available yet");
      }
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
      res.end(buf);
    });
  }

  _handleStatus(req, res) {
    const bridge = this.bridge || {};
    const cfg = bridge.config || {};
    const onebot = bridge.onebotAdapter || null;
    const milky = bridge.milkyAdapter || null;
    const selfInfo = bridge.selfInfo || {};
    const qrAvailable = (() => {
      try { return fs.statSync("/tmp/qrcode.png").size > 0; }
      catch { return false; }
    })();

    const data = {
      status: "ok",
      version: SERVER_VERSION,
      uptime_sec: Math.floor((Date.now() - SERVER_START_MS) / 1000),
      logged_in: Boolean(selfInfo.uin),
      uin: selfInfo.uin || "",
      nickname: selfInfo.nickName || "",
      qrcode_available: qrAvailable,
      bridge_port: this.port,
      bridge_host: this.host,
      bridge_ws_clients: this.wsClients ? this.wsClients.size : 0,
      onebot: {
        enabled: Boolean(onebot),
        ws_port: cfg.onebotWsPort || 0,
        reverse_urls: Array.isArray(cfg.onebotWsReverseUrls) ? cfg.onebotWsReverseUrls.length : 0,
        clients: onebot && onebot.wsClients ? onebot.wsClients.size : 0,
      },
      milky: {
        enabled: Boolean(milky && cfg.milkyPort),
        port: cfg.milkyPort || 0,
        ws_clients:  milky && milky.wsClients  ? milky.wsClients.size  : 0,
        sse_clients: milky && milky.sseClients ? milky.sseClients.size : 0,
        webhook_urls: Array.isArray(cfg.milkyWebhookUrls) ? cfg.milkyWebhookUrls.length : 0,
      },
    };
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  }

  // --- Request dispatch ---

  async _handleRequest(msg) {
    const echo = msg.data?.echo || randomUUID();
    try {
      if (msg.type === "call") {
        const result = await this.bridge.handleCall(msg.data.func, msg.data.args);
        return { type: "call", data: { result, echo } };
      }
      if (msg.type === "send" || msg.type === "send_pb") {
        const result = await this.bridge.handleSendPB(msg.data.cmd, msg.data.pb);
        return { type: "send", data: { ...result, echo } };
      }
      if (msg.type === "tell_port") {
        return { type: "tell_port", data: { success: true, echo } };
      }
    } catch (e) {
      console.error(`[server] Error handling ${msg.type}:`, e.message);
      return { type: msg.type, data: { result: e.message, echo } };
    }
    return { type: "unknown", data: { echo } };
  }
}

/** JSON.stringify replacer that converts Map to plain object */
function mapReplacer(key, value) {
  if (value instanceof Map) {
    const obj = {};
    for (const [k, v] of value) obj[k] = v;
    return obj;
  }
  return value;
}

module.exports = { BridgeServer };
