"use strict";

const { WebSocketServer, WebSocket } = require("ws");
const http = require("http");
const { handlers } = require("./actions");
const { EventTranslator } = require("./events");

/**
 * OneBot v11 adapter.
 *
 * Supports both:
 *   - Forward WS: Yunzai connects to us at ws://host:port/
 *   - Reverse WS: We connect to Yunzai at ws://host:port/OneBotv11
 */
class OneBotAdapter {
  constructor(config, bridge) {
    this.config = config;
    this.bridge = bridge;
    this.eventTranslator = new EventTranslator(bridge);

    // Forward WS server
    this.httpServer = null;
    this.wss = null;
    this.forwardClients = new Set();

    // Reverse WS connections
    this.reverseClients = new Map(); // url -> ws

    // Heartbeat
    this._heartbeatTimer = null;
  }

  async start() {
    // Start forward WS server if configured
    if (this.config.wsPort) {
      await this._startForwardWS();
    }

    // Connect reverse WS if configured
    if (this.config.wsReverseUrls?.length) {
      for (const url of this.config.wsReverseUrls) {
        this._connectReverseWS(url);
      }
    }

    // Start heartbeat
    this._heartbeatTimer = setInterval(() => this._sendHeartbeat(), 30000);

    console.log("[onebot] Adapter started");
  }

  // ---- Forward WebSocket Server ----

  async _startForwardWS() {
    this.httpServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", version: "waylay/0.2.0" }));
    });

    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on("connection", (ws, req) => {
      // Check token if configured
      if (this.config.token) {
        const auth = req.headers.authorization;
        const query = new URL(req.url, "http://localhost").searchParams;
        const token = auth?.replace("Bearer ", "") || query.get("access_token");
        if (token !== this.config.token) {
          console.warn("[onebot] Forward WS: auth failed");
          ws.close(1008, "Unauthorized");
          return;
        }
      }

      console.log("[onebot] Forward WS client connected");
      this.forwardClients.add(ws);

      ws.on("message", (raw) => this._handleMessage(ws, raw));
      ws.on("close", () => {
        console.log("[onebot] Forward WS client disconnected");
        this.forwardClients.delete(ws);
      });
      ws.on("error", (e) => {
        console.error("[onebot] Forward WS error:", e.message);
        this.forwardClients.delete(ws);
      });

      // Send lifecycle event
      this._sendLifecycle(ws);
    });

    return new Promise((resolve, reject) => {
      this.httpServer.listen(this.config.wsPort, this.config.wsHost || "0.0.0.0", () => {
        console.log(`[onebot] Forward WS listening on ${this.config.wsHost || "0.0.0.0"}:${this.config.wsPort}`);
        resolve();
      });
      this.httpServer.on("error", reject);
    });
  }

  // ---- Reverse WebSocket Client ----

  _connectReverseWS(url) {
    console.log(`[onebot] Connecting reverse WS to ${url}...`);

    const headers = {};
    if (this.config.token) {
      headers.Authorization = `Bearer ${this.config.token}`;
    }

    const ws = new WebSocket(url, { headers });

    ws.on("open", () => {
      console.log(`[onebot] Reverse WS connected to ${url}`);
      this.reverseClients.set(url, ws);
      this._sendLifecycle(ws);
    });

    ws.on("message", (raw) => this._handleMessage(ws, raw));

    ws.on("close", () => {
      console.log(`[onebot] Reverse WS disconnected from ${url}`);
      this.reverseClients.delete(url);
      // Auto reconnect
      setTimeout(() => this._connectReverseWS(url), 5000);
    });

    ws.on("error", (e) => {
      console.error(`[onebot] Reverse WS error (${url}):`, e.message);
      this.reverseClients.delete(url);
    });
  }

  // ---- Message handling ----

  async _handleMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // API request from Yunzai
    if (msg.action) {
      const response = await this._handleAction(msg.action, msg.params || {}, msg.echo);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(response, mapReplacer));
      }
    }
  }

  async _handleAction(action, params, echo) {
    const handler = handlers[action];
    if (!handler) {
      console.warn(`[onebot] Unknown action: ${action}`);
      return { status: "failed", retcode: 1404, msg: "不支持的 API", data: null, echo };
    }

    try {
      const data = await handler(params, this.bridge, this.eventTranslator);
      return { status: "ok", retcode: 0, data, echo };
    } catch (e) {
      console.error(`[onebot] Action ${action} error:`, e.message);
      return { status: "failed", retcode: 1400, msg: e.message, data: null, echo };
    }
  }

  // ---- Event push ----

  /** Called by the bridge when a kernel event fires */
  pushEvent(listenerName, eventName, data) {
    const events = this.eventTranslator.translate(listenerName, eventName, data);
    for (const event of events) {
      this._broadcast(event);
    }
  }

  _broadcast(event) {
    const payload = JSON.stringify(event, mapReplacer);

    for (const ws of this.forwardClients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
    for (const [, ws] of this.reverseClients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }

  // ---- Lifecycle / Heartbeat ----

  _sendLifecycle(ws) {
    const event = {
      time: Math.floor(Date.now() / 1000),
      self_id: Number(this.bridge.selfInfo.uin) || 0,
      post_type: "meta_event",
      meta_event_type: "lifecycle",
      sub_type: "connect",
    };
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  _sendHeartbeat() {
    const event = {
      time: Math.floor(Date.now() / 1000),
      self_id: Number(this.bridge.selfInfo.uin) || 0,
      post_type: "meta_event",
      meta_event_type: "heartbeat",
      interval: 30000,
      status: {
        online: !!this.bridge.session,
        good: !!this.bridge.session,
      },
    };
    this._broadcast(event);
  }

  /** Re-send lifecycle to all connections (called after login success) */
  notifyLogin() {
    const event = {
      time: Math.floor(Date.now() / 1000),
      self_id: Number(this.bridge.selfInfo.uin) || 0,
      post_type: "meta_event",
      meta_event_type: "lifecycle",
      sub_type: "connect",
    };
    this._broadcast(event);
  }
}

function mapReplacer(key, value) {
  if (value instanceof Map) {
    const obj = {};
    for (const [k, v] of value) obj[k] = v;
    return obj;
  }
  return value;
}

module.exports = { OneBotAdapter };
