# waylay

A headless bridge for NTQQ with built-in OneBot v11 support. An open-source Node.js implementation that loads QQ's native kernel directly.

## How it works

1. Runs inside QQ's Electron process (patched `package.json` entry point)
2. Loads NTQQ's `wrapper.node` native module directly
3. Initializes the QQ kernel, handles login (QR code or quick login)
4. Registers kernel listeners for all events (messages, groups, friends, etc.)
5. Exposes both:
   - **Bridge WebSocket** on port 13000 (for LLOneBot backward compat)
   - **OneBot v11 WebSocket** on port 3001 (for Yunzai, Koishi, etc.)

## Comparison with similar projects

| | **waylay** | NapCatQQ | LLOneBot | Lagrange.Core |
|---|---|---|---|---|
| **Language** | JavaScript | TypeScript | TypeScript | C# |
| **Source code** | **2,948 lines / 9 files** | ~3 MB / 832 files | ~1.7 MB / 529 files | ~1.4 MB / 1,027 files |
| **Runtime deps** | **1** (`ws`) | ~30 npm packages | 23 npm packages | 6 NuGet packages |
| **node_modules** | **208 KB** | ~100+ MB | ~80+ MB | N/A (.NET) |
| **App code size** | **120 KB** | ~3 MB | ~1.7 MB | ~1.4 MB |
| **Runtime memory** | **~150 MB** | ~300 MB+ | ~300 MB+ (with QQNT) | ~50-100 MB |
| **Approach** | Direct wrapper.node | wrapper.node + FFI | QQNT plugin (LiteLoader) | Protocol reimplementation |
| **Requires QQ** | Yes | Yes | Yes (+ LiteLoader) | No |
| **Status** | Active | Active | Active | Archived (2025) |

### Key advantages

- **Minimal footprint**: 2,948 lines of plain JavaScript, 1 dependency (`ws`), 208 KB node_modules. No TypeScript compilation, no bundler, no monorepo, no framework overhead.
- **Low memory**: ~150 MB runtime (includes QQ kernel). NapCat and LLOneBot typically consume 300+ MB due to additional abstraction layers, logging frameworks (winston), web frameworks (express/hono), database engines (SQLite), and frontend UI (React/Vite).
- **Zero abstraction tax**: Calls `wrapper.node` APIs directly without intermediate layers. No dependency injection (inversify), no plugin system (cordis), no protobuf codegen. The call path from OneBot action to QQ kernel is ~3 function calls deep.
- **Single-process**: No master/worker split, no WebUI server, no separate database process. One Electron process handles everything.
- **Fast startup**: wrapper.node load + engine init + login + session ready in seconds. No compilation step, no asset bundling, no database migration.
- **Built-in OneBot v11**: Connects directly to Yunzai/Koishi without LLOneBot as a middleware layer, eliminating one hop and ~200 MB of extra memory.

### Architecture comparison

```
NapCatQQ (24 packages, ~30 deps):
  Yunzai ←→ NapCat-OneBot ←→ NapCat-Core ←→ napi2native.node ←→ wrapper.node ←→ QQ Server

LLOneBot (23 deps):
  Yunzai ←→ LLOneBot plugin ←→ LiteLoaderQQNT ←→ QQNT Renderer ←→ QQ Server

waylay (1 dep):
  Yunzai ←→ waylay ←→ wrapper.node ←→ QQ Server
```

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
| `BRIDGE_PORT` | `13000` | Bridge WS/HTTP server port |
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
- `notice` (group_recall, friend_recall, group_increase, group_decrease, group_ban, group_admin, group_upload, poke, lucky_king, honor)
- `request` (friend, group add/invite)
- `meta_event` (lifecycle, heartbeat)

## LLOneBot Compatibility

Also speaks a JSON-over-WebSocket protocol on port 13000. LLOneBot connects to `ws://host:13000/ws` as a drop-in replacement.

## QR Code Login

When quick login fails (expired token), the bridge falls back to QR code login. Access the QR code at:
- `http://host:13000/qrcode`
