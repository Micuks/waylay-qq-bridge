<div align="center">

<img src="https://media.valorant-api.com/agents/df1cb487-4902-002e-5c17-d28e83e78588/displayicon.png" width="160" />

# Waylay

**Lightweight, fast, pure-JS headless NTQQ bridge with built-in OneBot v11 support**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-≥18-green.svg)](https://nodejs.org/)
[![QQ Version](https://img.shields.io/badge/QQ-3.2.27-blue.svg)](https://im.qq.com/linuxqq/index.shtml)
[![OneBot v11](https://img.shields.io/badge/OneBot-v11-black.svg)](https://github.com/botuniverse/onebot-11)
[![Dependencies](https://img.shields.io/badge/deps-1_(ws)-brightgreen.svg)](#why-waylay)

[中文](README.md)

</div>

---

## Features

- **Ultra-lightweight** — 9 files, ~3,000 lines of plain JavaScript, 1 dependency (`ws`), 208 KB node_modules
- **Sub-millisecond queries** — Event-driven cache, all read actions < 1ms, **9–48x faster** than LLOneBot
- **Zero abstraction tax** — Calls `wrapper.node` native APIs directly, ~3 function calls from OneBot action to QQ kernel
- **Low memory** — ~150 MB runtime (including QQ kernel), no Winston/Express/SQLite/React overhead
- **Single process** — No master/worker split, no WebUI server, no separate DB process
- **Ready to deploy** — Docker one-liner, connects directly to Yunzai / Koishi / Miao-Yunzai
- **LLOneBot compatible** — Also exposes LLOneBot-compatible JSON-over-WebSocket protocol (port 13000)

## How It Works

```
Yunzai / Koishi ←→ Waylay (OneBot v11) ←→ wrapper.node ←→ QQ Server
```

1. Runs inside QQ's Electron process (patched `package.json` entry point)
2. Loads NTQQ's `wrapper.node` native module directly
3. Initializes QQ kernel, handles login (QR code or quick login)
4. Registers all kernel event listeners (messages, groups, friends, etc.)
5. Exposes:
   - **OneBot v11 WebSocket** — port 3001 (forward/reverse WS)
   - **Bridge WebSocket** — port 13000 (LLOneBot compatible)

## Quick Start

```bash
# Clone
git clone https://github.com/Micuks/waylay.git
cd waylay

# Launch with Docker
docker compose up -d --build

# Access QR code for login
open http://localhost:13000/qrcode
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_PORT` | `13000` | Bridge WS/HTTP server port |
| `BRIDGE_HOST` | `0.0.0.0` | Listen address |
| `AUTO_LOGIN_QQ` | — | QQ number for quick login |
| `ONEBOT_WS_PORT` | `0` | OneBot v11 forward WS port (0 = disabled) |
| `ONEBOT_WS_HOST` | `0.0.0.0` | OneBot v11 listen address |
| `ONEBOT_WS_REVERSE_URLS` | `[]` | JSON array of reverse WS URLs |
| `ONEBOT_TOKEN` | — | Access token for OneBot v11 auth |

## Supported QQ Versions

| Version | Platform | Status |
|---------|----------|--------|
| QQ 3.2.27 (Linux amd64) | Docker / Linux | Verified |

> Waylay loads NTQQ's `wrapper.node` and should work with any QQ Linux version that includes this module.

## Performance

### Comparison with Similar Projects

| | **Waylay** | NapCatQQ | LLOneBot | Lagrange.Core |
|---|---|---|---|---|
| **Language** | JavaScript | TypeScript | TypeScript | C# |
| **Source code** | **~3,000 lines / 9 files** | ~3 MB / 832 files | ~1.7 MB / 529 files | ~1.4 MB / 1,027 files |
| **Runtime deps** | **1** (`ws`) | ~30 npm packages | 23 npm packages | 6 NuGet packages |
| **node_modules** | **208 KB** | ~100+ MB | ~80+ MB | N/A (.NET) |
| **App code size** | **120 KB** | ~3 MB | ~1.7 MB | ~1.4 MB |
| **Runtime memory** | **~150 MB** | ~300 MB+ | ~300 MB+ (with QQNT) | ~50-100 MB |
| **Approach** | Direct wrapper.node | wrapper.node + FFI | QQNT plugin (LiteLoader) | Protocol reimplementation |
| **Requires QQ** | Yes | Yes | Yes (+ LiteLoader) | No |
| **Status** | Active | Active | Active | Archived (2025) |

### Response Latency (Waylay vs LLOneBot, 10 rounds avg)

| Action | Waylay | LLOneBot | Ratio |
|--------|--------|----------|-------|
| `get_login_info` | **0.7ms** | 6.3ms | 9x |
| `get_friend_list` | **1.0ms** | 47.9ms | **48x** |
| `get_group_list` | **0.8ms** | 27.3ms | **34x** |
| `get_group_info` | **0.6ms** | 28.4ms | **47x** |
| `get_group_member_list` | **1.0ms** | 10.2ms | **10x** |
| `get_group_member_info` | **0.5ms** | 12.0ms | **24x** |
| `send_group_msg` | 403ms | 457ms | 1.1x |

> All query actions are sub-millisecond thanks to event-driven caching. `send_group_msg` is equivalent — both are bounded by QQ server round-trip.

### Architecture Comparison

```
NapCatQQ (24 packages, ~30 deps):
  Yunzai ←→ NapCat-OneBot ←→ NapCat-Core ←→ napi2native.node ←→ wrapper.node ←→ QQ Server

LLOneBot (23 deps):
  Yunzai ←→ LLOneBot plugin ←→ LiteLoaderQQNT ←→ QQNT Renderer ←→ QQ Server

Waylay (1 dep):
  Yunzai ←→ Waylay ←→ wrapper.node ←→ QQ Server
```

## Why Waylay

| Feature | Details |
|---------|---------|
| **Ultra-lightweight** | ~3,000 lines of plain JS, 1 dep, 208 KB node_modules — no TS compilation, no bundler, no monorepo |
| **Sub-ms queries** | Kernel event listeners → in-memory cache, no database, no API round-trip per query |
| **Low memory** | ~150 MB (including QQ kernel). NapCat/LLOneBot typically 300+ MB (Winston, Express, SQLite, React/Vite) |
| **Zero abstraction** | Direct `wrapper.node` calls, no DI (inversify), no plugin system (cordis), no protobuf codegen |
| **Single process** | No master/worker, no WebUI server, no separate DB process |
| **Fast startup** | wrapper.node load + engine init + login + session ready in seconds, no compilation, no bundling |
| **Built-in OneBot v11** | Direct connection to Yunzai/Koishi, no LLOneBot middleware layer, saves one hop and ~200 MB memory |

## OneBot v11 Protocol

### Connection Modes

- **Forward WebSocket** — Bot framework connects to `ws://host:3001/`
- **Reverse WebSocket** — Waylay connects to framework (e.g., `ws://host:2536/OneBotv11`)

### Supported Actions

<details>
<summary>Click to expand full list</summary>

#### Core

| Action | Description |
|--------|-------------|
| `get_login_info` | Get login info |
| `get_version_info` | Get version info |
| `get_status` | Get running status |

#### Messages

| Action | Description |
|--------|-------------|
| `send_msg` | Send message (auto-detect private/group) |
| `send_group_msg` | Send group message |
| `send_private_msg` | Send private message |
| `delete_msg` | Recall message |
| `get_msg` | Get message details |
| `send_group_forward_msg` | Send group forward message |
| `send_private_forward_msg` | Send private forward message |
| `get_forward_msg` | Get forward message content |

#### Friends / Users

| Action | Description |
|--------|-------------|
| `get_friend_list` | Get friend list |
| `get_stranger_info` | Get stranger info |
| `set_friend_add_request` | Handle friend request |

#### Groups

| Action | Description |
|--------|-------------|
| `get_group_list` | Get group list |
| `get_group_info` | Get group info |
| `get_group_member_list` | Get group member list |
| `get_group_member_info` | Get group member info |
| `set_group_ban` | Ban group member |
| `set_group_whole_ban` | Whole group ban |
| `set_group_kick` | Kick member |
| `set_group_admin` | Set/unset admin |
| `set_group_card` | Set group card |
| `set_group_name` | Set group name |
| `set_group_leave` | Leave group |
| `set_group_add_request` | Handle group request |
| `group_poke` | Group poke |

#### Media

| Action | Description |
|--------|-------------|
| `get_image` | Get image |
| `get_record` | Get voice record |
| `can_send_image` | Check image capability |
| `can_send_record` | Check voice capability |

</details>

### Supported Events

| Type | Event | Description |
|------|-------|-------------|
| **Message** | `message.group` | Group message |
| | `message.private` | Private message |
| **Notice** | `notice.group_recall` | Group message recall |
| | `notice.friend_recall` | Friend message recall |
| | `notice.group_increase` | Member joined group |
| | `notice.group_decrease` | Member left/kicked |
| | `notice.group_ban` | Group ban |
| | `notice.group_admin` | Admin change |
| | `notice.group_upload` | Group file upload |
| | `notice.friend_add` | Friend added |
| | `notice.notify.poke` | Poke |
| | `notice.notify.lucky_king` | Lucky king |
| | `notice.notify.honor` | Group honor change |
| **Request** | `request.friend` | Friend request |
| | `request.group.add` | Group join request |
| | `request.group.invite` | Group invite |
| **Meta** | `meta_event.lifecycle` | Lifecycle |
| | `meta_event.heartbeat` | Heartbeat |

### Supported Message Segments

| Type | Recv | Send | Description |
|------|:----:|:----:|-------------|
| `text` | ✅ | ✅ | Plain text |
| `at` | ✅ | ✅ | Mention (including @all) |
| `face` | ✅ | ✅ | QQ emoji |
| `image` | ✅ | ✅ | Image (base64/URL/local path) |
| `reply` | ✅ | ✅ | Reply |
| `record` | ✅ | — | Voice |
| `video` | ✅ | — | Video |
| `file` | ✅ | — | File |
| `json` | ✅ | ✅ | JSON card |
| `forward` | ✅ | ✅ | Forward message |
| `dice` | ✅ | ✅ | Dice |
| `rps` | ✅ | ✅ | Rock-paper-scissors |
| `shake` | ✅ | — | Shake/poke |
| `mface` | ✅ | — | Market face (sticker) |
| `markdown` | ✅ | — | Markdown |
| `music` | — | ✅ | Music share (custom) |

## LLOneBot Compatibility

Waylay also exposes a LLOneBot-compatible JSON-over-WebSocket protocol on port 13000. LLOneBot can connect to `ws://host:13000/ws` as a drop-in replacement.

## QR Code Login

When quick login fails (expired token), the bridge falls back to QR code login. Access the QR code at:

```
http://host:13000/qrcode
```

## License

[MIT](LICENSE)
