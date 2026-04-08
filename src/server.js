"use strict";

const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const { randomUUID } = require("crypto");

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

    // Serve QR code image for login
    if (req.url === "/qrcode" || req.url === "/qr") {
      const fs = require("fs");
      try {
        const qr = fs.readFileSync("/tmp/qrcode.png");
        res.writeHead(200, { "Content-Type": "image/png" });
        return res.end(qr);
      } catch {
        res.writeHead(404);
        return res.end("QR code not available yet");
      }
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", version: "qq-bridge/0.1.0" }));
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
