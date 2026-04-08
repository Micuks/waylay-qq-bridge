# qq-bridge

A PMHQ-compatible headless bridge for NTQQ. Replaces the closed-source PMHQ binary with an open-source Node.js implementation.

## How it works

1. Loads NTQQ's `wrapper.node` native module directly
2. Initializes the QQ kernel, handles login (QR code or quick login)
3. Registers kernel listeners for all events (messages, groups, friends, etc.)
4. Exposes a WebSocket/HTTP server on port 13000 speaking the PMHQ protocol
5. LLOneBot connects to it as a drop-in replacement for PMHQ

## Advantages over PMHQ

- Open source, fully auditable
- No Python/Frida dependency (~10MB vs 65MB binary)
- Registers **more kernel listeners** (online status, search, collection, etc.)
- Direct WebSocket server (no SSE→WS proxy layer)

## Usage

```bash
# Build and run with docker-compose
docker compose up -d --build

# Or run standalone (inside a QQ-installed environment)
node src/index.js --port=13000 --quick-login=YOUR_QQ_NUMBER
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_PORT` | `13000` | WebSocket/HTTP server port |
| `BRIDGE_HOST` | `0.0.0.0` | Listen address |
| `AUTO_LOGIN_QQ` | `` | QQ number for quick login |
| `QQ_APP_DIR` | `/opt/QQ/resources/app` | Path to QQ resources |

## Protocol

Compatible with PMHQ's JSON-over-WebSocket protocol. LLOneBot connects to `ws://host:13000/ws`.

### Request types

- `call` — invoke a kernel service method
- `send` / `send_pb` — send raw SSO protocol buffer packet
- `tell_port` — inform the bridge of webui port

### Event push types

- `on_message` — message events (recv, delete, update, etc.)
- `on_group` — group events
- `on_buddy` — friend events
- `on_profile` — profile changes
- `on_flash_file` — file transfer events
- `on_online_status` — online status changes (new!)
- `on_robot` — bot list changes (new!)
- And more...
