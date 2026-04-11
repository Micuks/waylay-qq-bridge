"use strict";

const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const { handlers } = require("./actions");
const { MilkyEventTranslator } = require("./events");

/**
 * Milky protocol adapter.
 *
 * Provides:
 *   - HTTP POST /api/:action  — API calls
 *   - GET /event              — SSE event stream
 *   - WebSocket /event        — WebSocket event stream
 *   - Webhook POST            — push events to configured URLs
 */
class MilkyAdapter {
  constructor(config, bridge) {
    this.config = config;
    this.bridge = bridge;
    this.eventTranslator = new MilkyEventTranslator(bridge);

    this.httpServer = null;
    this.wss = null;
    this.sseClients = new Set(); // SSE response objects
    this.wsClients = new Set(); // WebSocket connections
    this._memberPreloaded = false;
  }

  async start() {
    if (!this.config.port) return;

    this.httpServer = http.createServer((req, res) => this._handleHttp(req, res));

    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on("connection", (ws) => {
      console.log("[milky] WebSocket client connected");
      this.wsClients.add(ws);
      ws.on("close", () => {
        console.log("[milky] WebSocket client disconnected");
        this.wsClients.delete(ws);
      });
      ws.on("error", (e) => {
        console.error("[milky] WebSocket error:", e.message);
        this.wsClients.delete(ws);
      });
    });

    this.httpServer.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname !== "/event") {
        socket.destroy();
        return;
      }
      if (!this._checkAuth(req)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit("connection", ws, req);
      });
    });

    return new Promise((resolve, reject) => {
      this.httpServer.listen(this.config.port, this.config.host || "0.0.0.0", () => {
        console.log(`[milky] HTTP/WS/SSE listening on ${this.config.host || "0.0.0.0"}:${this.config.port}`);
        resolve();
      });
      this.httpServer.on("error", reject);
    });
  }

  // ---- HTTP request handler ----

  _handleHttp(req, res) {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (!this._checkAuth(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "failed", retcode: 1403, data: null }));
      return;
    }

    const url = new URL(req.url, "http://localhost");

    // SSE event stream
    if (req.method === "GET" && url.pathname === "/event") {
      this._handleSSE(req, res);
      return;
    }

    // API call
    if (req.method === "POST" && url.pathname.startsWith("/api/")) {
      this._handleApiCall(req, res, url);
      return;
    }

    // Health check
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", impl: "waylay", protocol: "milky" }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "failed", retcode: 1404, data: null }));
  }

  _handleSSE(req, res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(":ok\n\n");

    this.sseClients.add(res);
    console.log("[milky] SSE client connected");

    req.on("close", () => {
      this.sseClients.delete(res);
      console.log("[milky] SSE client disconnected");
    });
  }

  async _handleApiCall(req, res, url) {
    const action = url.pathname.replace(/^\/api\//, "");

    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    let params = {};
    try {
      if (body) params = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "failed", retcode: 1400, data: null }));
      return;
    }

    console.log(`[milky] <- api: ${action}`);

    const handler = handlers[action];
    if (!handler) {
      console.warn(`[milky] Unknown action: ${action}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "failed", retcode: 1404, data: null }));
      return;
    }

    try {
      const data = await handler(params, this.bridge, this.eventTranslator);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", retcode: 0, data }, mapReplacer));
    } catch (e) {
      console.error(`[milky] Action ${action} error:`, e.message);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "failed", retcode: 1400, data: null }));
    }
  }

  // ---- Auth ----

  _checkAuth(req) {
    if (!this.config.token) return true;
    const auth = req.headers.authorization;
    const url = new URL(req.url, "http://localhost");
    const token = auth?.replace("Bearer ", "") || url.searchParams.get("access_token");
    return token === this.config.token;
  }

  // ---- Event push ----

  pushEvent(listenerName, eventName, data) {
    const events = this.eventTranslator.translate(listenerName, eventName, data);
    for (const event of events) {
      this._broadcast(event);
    }
    // Preload group members once group list arrives
    if (!this._memberPreloaded && listenerName === "nodeIKernelGroupListener" && eventName === "onGroupListUpdate") {
      this._memberPreloaded = true;
      setTimeout(() => this._preloadGroupMembers(), 2000);
    }
  }

  _broadcast(event) {
    const payload = JSON.stringify(event, mapReplacer);

    // SSE clients
    for (const res of this.sseClients) {
      try {
        res.write(`event: ${event.event_type}\ndata: ${payload}\n\n`);
      } catch {
        this.sseClients.delete(res);
      }
    }

    // WebSocket clients
    for (const ws of this.wsClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }

    // Webhooks
    if (this.config.webhookUrls?.length) {
      for (const url of this.config.webhookUrls) {
        this._postWebhook(url, payload);
      }
    }
  }

  _postWebhook(urlStr, payload) {
    try {
      const url = new URL(urlStr);
      const options = {
        method: "POST",
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      };
      if (this.config.token) {
        options.headers.Authorization = `Bearer ${this.config.token}`;
      }
      const proto = url.protocol === "https:" ? require("https") : http;
      const req = proto.request(options);
      req.on("error", (e) => console.warn(`[milky] Webhook error (${urlStr}):`, e.message));
      req.write(payload);
      req.end();
    } catch (e) {
      console.warn(`[milky] Webhook error (${urlStr}):`, e.message);
    }
  }

  notifyLogin() {
    this._memberPreloaded = false;
  }

  async _preloadGroupMembers() {
    if (!this.bridge.session) return;
    try {
      const groups = this.eventTranslator.getGroupList();
      const groupService = this.bridge.session.getGroupService();
      for (const g of groups) {
        try {
          const sceneId = groupService.createMemberListScene(g.groupCode, `milky_preload_${g.groupCode}`);
          await groupService.getNextMemberList(sceneId, undefined, 3000);
          try { groupService.destroyMemberListScene(sceneId); } catch {}
        } catch {}
      }
      console.log(`[milky] Preloaded member lists for ${groups.length} groups`);
    } catch (e) {
      console.warn("[milky] Failed to preload group members:", e.message);
    }
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

module.exports = { MilkyAdapter };
