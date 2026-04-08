# waylay

A headless bridge for NTQQ with built-in OneBot v11 support. Replaces the closed-source PMHQ binary with an open-source Node.js implementation.

## How it works

1. Runs inside QQ's Electron process (patched `package.json` entry point)
2. Loads NTQQ's `wrapper.node` native module directly
3. Initializes the QQ kernel, handles login (QR code or quick login)
4. Registers kernel listeners for all events (messages, groups, friends, etc.)
5. Exposes both:
   - **PMHQ-compatible WebSocket** on port 13000 (for LLOneBot)
   - **OneBot v11 WebSocket** on port 3001 (for Yunzai, Koishi, etc.)

## Advantages

- Open source, fully auditable
- No Python/Frida dependency (~10MB vs 65MB PMHQ binary)
- Built-in OneBot v11 — connect directly to bot frameworks without LLOneBot
- Registers more kernel listeners (online status, search, collection, etc.)
- Direct WebSocket server (no SSE->WS proxy layer)

## Usage

```bash
# Build and run with docker-compose
docker compose up -d --build

# Or run standalone (inside a QQ-installed environment)
# Must run inside QQ's Electron - see Dockerfile for setup
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_PORT` | `13000` | PMHQ-compatible WS/HTTP server port |
| `BRIDGE_HOST` | `0.0.0.0` | Listen address |
| `AUTO_LOGIN_QQ` | `` | QQ number for quick login |
| `QQ_APP_DIR` | `/opt/QQ/resources/app` | Path to QQ resources |
| `ONEBOT_WS_PORT` | `0` | OneBot v11 forward WS port (0 = disabled) |
| `ONEBOT_WS_HOST` | `0.0.0.0` | OneBot v11 listen address |
| `ONEBOT_WS_REVERSE_URLS` | `[]` | JSON array of reverse WS URLs to connect to |
| `ONEBOT_TOKEN` | `` | Access token for OneBot v11 auth |

## OneBot v11 Protocol

### Connection modes

- **Forward WebSocket**: Bot framework connects to `ws://host:3001/`
- **Reverse WebSocket**: Bridge connects to framework (e.g., `ws://host:2536/OneBotv11`)

### Supported actions

Core: `get_login_info`, `get_version_info`, `get_status`, `send_msg`, `send_group_msg`, `send_private_msg`, `delete_msg`, `get_msg`

Lists: `get_friend_list`, `get_group_list`, `get_group_info`, `get_group_member_list`, `get_group_member_info`, `get_stranger_info`

Forward: `send_group_forward_msg`, `send_private_forward_msg`, `get_forward_msg`

Admin: `set_group_ban`, `set_group_whole_ban`, `set_group_kick`, `set_group_admin`, `set_group_card`, `set_group_name`, `set_group_leave`

### Event types

- `message` (group, private)
- `notice` (group_recall, friend_recall, group_increase, group_decrease, group_ban, poke)
- `request` (friend add)
- `meta_event` (lifecycle, heartbeat)

## PMHQ Compatibility

Also speaks the PMHQ JSON-over-WebSocket protocol on port 13000. LLOneBot connects to `ws://host:13000/ws` as a drop-in replacement.

## QR Code Login

When quick login fails (expired token), the bridge falls back to QR code login. Access the QR code at:
- `http://host:13000/qrcode`
