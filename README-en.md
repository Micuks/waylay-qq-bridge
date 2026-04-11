<div align="center">

<img src="https://media.valorant-api.com/agents/df1cb487-4902-002e-5c17-d28e83e78588/displayicon.png" width="160" />

# Waylay

**Lightweight, fast, pure-JS headless NTQQ bridge with built-in OneBot v11 + Milky support**

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-≥18-green.svg)](https://nodejs.org/)
[![QQ Version](https://img.shields.io/badge/QQ-3.2.27-blue.svg)](https://im.qq.com/linuxqq/index.shtml)
[![OneBot v11](https://img.shields.io/badge/OneBot-v11-black.svg)](https://github.com/botuniverse/onebot-11)
[![Milky](https://img.shields.io/badge/Milky-v1-purple.svg)](#milky-protocol)
[![Dependencies](https://img.shields.io/badge/deps-1_(ws)-brightgreen.svg)](#highlights)

[中文](README.md)

</div>

---

## About

Waylay is a lightweight headless NTQQ bridge written in plain JavaScript with built-in OneBot v11 protocol support. It loads QQ's `wrapper.node` native module directly to communicate with the QQ kernel — ideal for minimal deployments with low resource requirements.

## Highlights

- **Lightweight** — 9 source files, ~3,000 lines of plain JavaScript, 1 runtime dependency (`ws`)
- **Fast queries** — Event-driven in-memory cache, sub-millisecond read responses
- **Simple architecture** — Direct `wrapper.node` calls, no extra abstraction layers
- **Low resource usage** — Single-process, no WebUI / database / logging framework overhead
- **Ready to deploy** — Docker one-liner, connects directly to Yunzai / Koishi
- **LLOneBot compatible** — Also provides LLOneBot-compatible WebSocket protocol (port 13000)

## How It Works

```
Bot Framework (Yunzai / Koishi) ←→ Waylay (OneBot v11) ←→ wrapper.node ←→ QQ Server
```

1. Runs inside QQ's Electron process (patched `package.json` entry point)
2. Loads NTQQ's `wrapper.node` native module directly
3. Initializes QQ kernel, handles login (QR code or quick login)
4. Registers kernel event listeners (messages, groups, friends, etc.)
5. Exposes OneBot v11 WebSocket (port 3001) and Bridge WebSocket (port 13000)

## Installation

### Option 1: Docker Hub (Recommended)

```bash
docker run -d --name waylay --privileged \
  -p 13000:13000 -p 3001:3001 \
  micuks/waylay:latest
```

Then visit `http://localhost:13000/qrcode` to scan the QR code and log in.

With parameters (quick login + reverse WS):

```bash
docker run -d --name waylay --privileged \
  -p 13000:13000 -p 3001:3001 \
  -e AUTO_LOGIN_QQ=123456789 \
  -e ONEBOT_WS_PORT=3001 \
  -e 'ONEBOT_WS_REVERSE_URLS=["ws://host.docker.internal:2536/OneBotv11"]' \
  --add-host=host.docker.internal:host-gateway \
  -v waylay_qq:/root/.config/QQ \
  micuks/waylay:latest
```

Or use Docker Compose:

```bash
curl -fsSLO https://raw.githubusercontent.com/Micuks/waylay-qq-bridge/master/docker-compose.yml
# Edit docker-compose.yml as needed
docker compose up -d
```

### Option 2: Install Script (Bare-metal Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/Micuks/waylay-qq-bridge/master/install.sh | sudo bash
```

After installation:

```bash
sudo systemctl start waylay    # Start
sudo systemctl enable waylay   # Auto-start on boot
curl http://localhost:13000/qrcode  # View login QR code
journalctl -u waylay -f        # View logs
```

### Option 3: Build from Source

```bash
git clone https://github.com/Micuks/waylay-qq-bridge.git
cd waylay-qq-bridge
docker compose up -d --build
```

**Windows users**: See the [WSL Installation Guide](docs/wsl-guide.md)

### Quick Login

Set the `AUTO_LOGIN_QQ` environment variable to skip QR code scanning:

```yaml
environment:
  - AUTO_LOGIN_QQ=123456789
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

## Comparison

The QQ Bot ecosystem has several excellent open-source projects, each with its own strengths. Here is an objective comparison to help you choose:

| | **Waylay** | **NapCatQQ** | **LLOneBot** | **Lagrange.Core** |
|---|---|---|---|---|
| **Language** | JavaScript | TypeScript | TypeScript | C# |
| **Source size** | ~3,000 lines / 9 files | ~3 MB / 832 files | ~1.7 MB / 529 files | ~1.4 MB / 1,027 files |
| **Runtime deps** | 1 (`ws`) | ~30 npm packages | 23 npm packages | 6 NuGet packages |
| **node_modules** | 208 KB | ~100+ MB | ~80+ MB | N/A (.NET) |
| **Approach** | Direct wrapper.node loading | process.dlopen wrapper.node | PMHQ memory injection + WebSocket | Protocol reimplementation |
| **Requires QQ** | Yes | Yes | Yes (+ PMHQ) | No |
| **Status** | Active | Active | Active | Archived (2025) |

> Each project has its own design philosophy. NapCatQQ is feature-rich with a mature ecosystem; LLOneBot (LuckyLilliaBot) supports multiple protocol adapters; Lagrange.Core needs no QQ client. Waylay focuses on minimalism, suitable for resource-constrained or simplicity-oriented deployments.

### Query Latency Reference (Waylay vs LLOneBot, 10-round avg)

| Action | Waylay | LLOneBot | Note |
|--------|--------|----------|------|
| `get_login_info` | 0.7ms | 6.3ms | |
| `get_friend_list` | 1.0ms | 47.9ms | |
| `get_group_list` | 0.8ms | 27.3ms | |
| `get_group_info` | 0.6ms | 28.4ms | |
| `get_group_member_list` | 1.0ms | 10.2ms | |
| `get_group_member_info` | 0.5ms | 12.0ms | |
| `send_group_msg` | 403ms | 457ms | QQ server bound |

> Waylay's query speed advantage comes from its event-driven in-memory cache design. Message sending latency is comparable — both are bounded by QQ server network round-trip.

### Architecture Overview

```
NapCatQQ:
  Bot Framework ←→ NapCat-OneBot ←→ NapCat-Core ←→ wrapper.node ←→ QQ Server

LLOneBot:
  Bot Framework ←→ LLBot ←→ PMHQ (memory injection) ←→ QQNT ←→ QQ Server

Waylay:
  Bot Framework ←→ Waylay ←→ wrapper.node ←→ QQ Server
```

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
| `record` | ✅ | ✅ | Voice |
| `video` | ✅ | ✅ | Video |
| `file` | ✅ | ✅ | File |
| `json` | ✅ | ✅ | JSON card |
| `forward` | ✅ | ✅ | Forward message |
| `dice` | ✅ | ✅ | Dice |
| `rps` | ✅ | ✅ | Rock-paper-scissors |
| `shake` | ✅ | — | Shake/poke |
| `mface` | ✅ | — | Market face (sticker) |
| `markdown` | ✅ | — | Markdown |
| `music` | — | ✅ | Music share (custom) |

## Acknowledgements

Waylay is inspired by and grateful to the following projects:

- [NapCatQQ](https://github.com/NapNeko/NapCatQQ) — Feature-rich NTQQ framework
- [LLOneBot](https://github.com/LLOneBot/LLOneBot) — Multi-protocol QQ Bot solution
- [Lagrange.Core](https://github.com/LagrangeDev/Lagrange.Core) — Elegant C# protocol implementation
- [OneBot v11](https://github.com/botuniverse/onebot-11) — Unified Bot protocol standard

## License

[Apache License 2.0](LICENSE) — Free to use, attribution required.

Copyright 2026 Micuks
