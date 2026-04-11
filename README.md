<div align="center">

<img src="https://media.valorant-api.com/agents/df1cb487-4902-002e-5c17-d28e83e78588/displayicon.png" width="160" />

# Waylay

**轻量、高速、纯 JS 的 NTQQ 无头桥接，内置 OneBot v11 + Milky 协议支持**

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-≥18-green.svg)](https://nodejs.org/)
[![QQ Version](https://img.shields.io/badge/QQ-3.2.27-blue.svg)](https://im.qq.com/linuxqq/index.shtml)
[![OneBot v11](https://img.shields.io/badge/OneBot-v11-black.svg)](https://github.com/botuniverse/onebot-11)
[![Milky](https://img.shields.io/badge/Milky-v1-purple.svg)](#milky-协议支持)
[![Dependencies](https://img.shields.io/badge/依赖-1_(ws)-brightgreen.svg)](#项目特点)

[English](README-en.md)

</div>

---

## 简介

Waylay 是一个轻量级的 NTQQ 无头桥接工具，使用纯 JavaScript 编写，内置 OneBot v11 协议支持。它直接加载 QQ 的 `wrapper.node` 原生模块与 QQ 内核通信，适合追求简洁部署和低资源占用的场景。

## 项目特点

- **轻量** — 13 个源文件、~4,000 行纯 JavaScript，仅 1 个运行时依赖 (`ws`)
- **快速查询** — 基于事件驱动的内存缓存，读操作亚毫秒级响应
- **非阻塞 I/O** — 媒体下载、音视频探测全部异步，不阻塞消息收发
- **简洁架构** — 直接调用 `wrapper.node`，无额外抽象层
- **低资源占用** — 单进程运行，无额外 WebUI / 数据库 / 日志框架开销
- **多协议** — 同时支持 OneBot v11 和 Milky 协议，兼容更多框架
- **开箱即用** — Docker 一键部署，直连 Yunzai / Koishi 等主流框架
- **快速登录** — 支持 QQ 号快速登录，容器重启免扫码
- **LLOneBot 兼容** — 同时提供 LLOneBot 兼容的 WebSocket 协议（端口 13000）

## 工作原理

```
Bot 框架 (Yunzai / Koishi) ←→ Waylay (OneBot v11) ←→ wrapper.node ←→ QQ 服务器
```

1. 在 QQ 的 Electron 进程中运行（补丁 `package.json` 入口点）
2. 直接加载 NTQQ 的 `wrapper.node` 原生模块
3. 初始化 QQ 内核、处理登录（扫码或快速登录）
4. 注册内核事件监听（消息、群组、好友等）
5. 对外暴露 OneBot v11 WebSocket（端口 3001）和 Bridge WebSocket（端口 13000）

## 安装与部署

### 方式一：Docker Hub 一键拉取（推荐）

```bash
docker run -d --name waylay --privileged \
  -p 13000:13000 -p 3001:3001 \
  micuks/waylay:latest
```

启动后访问 `http://localhost:13000/qrcode` 扫码登录。

带参数启动（快速登录 + 反向 WS）：

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

或使用 Docker Compose：

```bash
curl -fsSLO https://raw.githubusercontent.com/Micuks/waylay-qq-bridge/master/docker-compose.yml
# 按需编辑 docker-compose.yml
docker compose up -d
```

### 方式二：一键安装脚本（裸机 Linux）

```bash
curl -fsSL https://raw.githubusercontent.com/Micuks/waylay-qq-bridge/master/install.sh | sudo bash
```

安装完成后：

```bash
sudo systemctl start waylay    # 启动
sudo systemctl enable waylay   # 开机自启
curl http://localhost:13000/qrcode  # 查看登录二维码
journalctl -u waylay -f        # 查看日志
```

### 方式三：从源码构建

```bash
git clone https://github.com/Micuks/waylay-qq-bridge.git
cd waylay-qq-bridge
docker compose up -d --build
```

**Windows 用户**：请参阅 [WSL 安装指南](docs/wsl-guide.md)

### 快速登录

设置环境变量 `AUTO_LOGIN_QQ` 为你的 QQ 号即可跳过扫码：

```yaml
environment:
  - AUTO_LOGIN_QQ=123456789
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `BRIDGE_PORT` | `13000` | Bridge WebSocket/HTTP 端口 |
| `BRIDGE_HOST` | `0.0.0.0` | 监听地址 |
| `AUTO_LOGIN_QQ` | — | 快速登录 QQ 号 |
| `ONEBOT_WS_PORT` | `0` | OneBot v11 正向 WS 端口（0 = 禁用） |
| `ONEBOT_WS_HOST` | `0.0.0.0` | OneBot v11 监听地址 |
| `ONEBOT_WS_REVERSE_URLS` | `[]` | 反向 WS URL 列表（JSON 数组） |
| `ONEBOT_TOKEN` | — | OneBot v11 鉴权 Token |
| `MILKY_HTTP_PORT` | `0` | Milky 协议 HTTP/WS/SSE 端口（0 = 禁用） |
| `MILKY_HOST` | `0.0.0.0` | Milky 监听地址 |
| `MILKY_TOKEN` | — | Milky 鉴权 Token |
| `MILKY_WEBHOOK_URLS` | `[]` | Milky Webhook URL 列表（JSON 数组） |

## 支持的 QQ 版本

| 版本 | 平台 | 状态 |
|------|------|------|
| QQ 3.2.27 (Linux amd64) | Docker / Linux | 已验证 |

> Waylay 加载 NTQQ 的 `wrapper.node`，理论上支持所有包含该模块的 QQ Linux 版本。

## 同类项目对比

QQ Bot 生态中有多个优秀的开源项目，各有侧重。以下是客观的技术参数对比，帮助你根据需求选择：

| | **Waylay** | **NapCatQQ** | **LLOneBot** | **Lagrange.Core** |
|---|---|---|---|---|
| **语言** | JavaScript | TypeScript | TypeScript | C# |
| **源码规模** | ~4,000 行 / 13 文件 | ~3 MB / 832 文件 | ~1.7 MB / 529 文件 | ~1.4 MB / 1,027 文件 |
| **运行时依赖** | 1 (`ws`) | ~30 npm 包 | 23 npm 包 | 6 NuGet 包 |
| **node_modules** | 208 KB | ~100+ MB | ~80+ MB | N/A (.NET) |
| **实现方式** | 直接加载 wrapper.node | process.dlopen 加载 wrapper.node | PMHQ 内存注入 + WebSocket | 协议重新实现 |
| **需要 QQ 客户端** | 是 | 是 | 是（+ PMHQ） | 否 |
| **项目状态** | 活跃 | 活跃 | 活跃 | 已归档 (2025) |

> 每个项目都有自己的设计理念和适用场景。NapCatQQ 功能全面、生态成熟；LLOneBot (LuckyLilliaBot) 支持多协议适配；Lagrange.Core 无需 QQ 客户端。Waylay 的定位是极简轻量，适合资源有限或偏好简洁部署的用户。

### 查询响应延迟参考（Waylay vs LLOneBot，10 轮平均值）

| Action | Waylay | LLOneBot | 说明 |
|--------|--------|----------|------|
| `get_login_info` | 0.7ms | 6.3ms | |
| `get_friend_list` | 1.0ms | 47.9ms | |
| `get_group_list` | 0.8ms | 27.3ms | |
| `get_group_info` | 0.6ms | 28.4ms | |
| `get_group_member_list` | 1.0ms | 10.2ms | |
| `get_group_member_info` | 0.5ms | 12.0ms | |
| `send_group_msg` | 403ms | 457ms | 受限于 QQ 服务器往返 |

> Waylay 的查询速度优势来自事件驱动的内存缓存设计。发送消息耗时两者相当，均受限于 QQ 服务器网络延迟。

### 架构概览

```
NapCatQQ:
  Bot 框架 ←→ NapCat-OneBot ←→ NapCat-Core ←→ wrapper.node ←→ QQ Server

LLOneBot:
  Bot 框架 ←→ LLBot ←→ PMHQ (内存注入) ←→ QQNT ←→ QQ Server

Waylay:
  Bot 框架 ←→ Waylay ←→ wrapper.node ←→ QQ Server
```

## OneBot v11 协议支持

### 连接方式

- **正向 WebSocket** — Bot 框架连接 `ws://host:3001/`
- **反向 WebSocket** — Waylay 主动连接框架（如 `ws://host:2536/OneBotv11`）

### 支持的 Action

<details>
<summary>展开查看完整列表</summary>

#### 核心

| Action | 说明 |
|--------|------|
| `get_login_info` | 获取登录号信息 |
| `get_version_info` | 获取版本信息 |
| `get_status` | 获取运行状态 |

#### 消息

| Action | 说明 |
|--------|------|
| `send_msg` | 发送消息（自动判断私聊/群聊） |
| `send_group_msg` | 发送群消息 |
| `send_private_msg` | 发送私聊消息 |
| `delete_msg` | 撤回消息 |
| `get_msg` | 获取消息详情 |
| `send_group_forward_msg` | 发送群合并转发 |
| `send_private_forward_msg` | 发送私聊合并转发 |
| `get_forward_msg` | 获取合并转发内容 |

#### 好友/用户

| Action | 说明 |
|--------|------|
| `get_friend_list` | 获取好友列表 |
| `get_stranger_info` | 获取陌生人信息 |
| `send_like` | 给好友点赞 |
| `set_friend_add_request` | 处理好友请求 |

#### 群组

| Action | 说明 |
|--------|------|
| `get_group_list` | 获取群列表 |
| `get_group_info` | 获取群信息 |
| `get_group_member_list` | 获取群成员列表 |
| `get_group_member_info` | 获取群成员信息 |
| `set_group_ban` | 禁言群成员 |
| `set_group_whole_ban` | 全体禁言 |
| `set_group_kick` | 踢出群成员 |
| `set_group_admin` | 设置/取消管理员 |
| `set_group_card` | 设置群名片 |
| `set_group_name` | 设置群名 |
| `set_group_leave` | 退群 |
| `set_group_add_request` | 处理加群请求 |
| `group_poke` | 群戳一戳 |

#### 媒体

| Action | 说明 |
|--------|------|
| `get_image` | 获取图片 |
| `get_record` | 获取语音 |
| `can_send_image` | 检查能否发图 |
| `can_send_record` | 检查能否发语音 |

</details>

### 支持的事件

| 类型 | 事件 | 说明 |
|------|------|------|
| **消息** | `message.group` | 群消息 |
| | `message.private` | 私聊消息 |
| **通知** | `notice.group_recall` | 群消息撤回 |
| | `notice.friend_recall` | 好友消息撤回 |
| | `notice.group_increase` | 群成员增加 |
| | `notice.group_decrease` | 群成员减少 |
| | `notice.group_ban` | 群禁言 |
| | `notice.group_admin` | 管理员变动 |
| | `notice.group_upload` | 群文件上传 |
| | `notice.friend_add` | 好友添加 |
| | `notice.notify.poke` | 戳一戳 |
| | `notice.notify.lucky_king` | 运气王 |
| | `notice.notify.honor` | 群荣誉变更 |
| **请求** | `request.friend` | 好友请求 |
| | `request.group.add` | 加群请求 |
| | `request.group.invite` | 邀请入群 |
| **元事件** | `meta_event.lifecycle` | 生命周期 |
| | `meta_event.heartbeat` | 心跳 |

### 支持的消息段

| 类型 | 收 | 发 | 说明 |
|------|:--:|:--:|------|
| `text` | ✅ | ✅ | 纯文本 |
| `at` | ✅ | ✅ | @成员（含 @全体） |
| `face` | ✅ | ✅ | QQ 表情 |
| `image` | ✅ | ✅ | 图片（base64/URL/本地路径） |
| `reply` | ✅ | ✅ | 回复消息 |
| `record` | ✅ | ✅ | 语音 |
| `video` | ✅ | ✅ | 视频 |
| `file` | ✅ | ✅ | 文件 |
| `json` | ✅ | ✅ | JSON 卡片 |
| `forward` | ✅ | ✅ | 合并转发 |
| `dice` | ✅ | ✅ | 骰子 |
| `rps` | ✅ | ✅ | 猜拳 |
| `shake` | ✅ | — | 戳一戳 |
| `mface` | ✅ | — | 商城表情 |
| `markdown` | ✅ | — | Markdown |
| `music` | — | ✅ | 音乐分享（自定义） |

## Milky 协议支持

Waylay 同时支持 Milky 协议，提供 HTTP API + WebSocket/SSE 事件推送。

### 启用

设置 `MILKY_HTTP_PORT` 环境变量即可启用：

```bash
docker run -d --name waylay --privileged \
  -p 13000:13000 -p 3001:3001 -p 8082:8082 \
  -e ONEBOT_WS_PORT=3001 \
  -e MILKY_HTTP_PORT=8082 \
  micuks/waylay:latest
```

### 连接方式

| 方式 | 端点 | 说明 |
|------|------|------|
| HTTP API | `POST /api/:action` | 调用 API |
| SSE | `GET /event` | 服务器推送事件流 |
| WebSocket | `ws://host:port/event` | 双向事件流 |
| Webhook | 配置 `MILKY_WEBHOOK_URLS` | 推送到外部 URL |

### 鉴权

设置 `MILKY_TOKEN` 后，所有请求需携带 Bearer Token：

```
Authorization: Bearer your_token
```

### 响应格式

```json
{
  "status": "ok",
  "retcode": 0,
  "data": { ... }
}
```

### 事件格式

```json
{
  "event_type": "message_receive",
  "time": 1712640000,
  "self_id": "123456789",
  "data": { ... }
}
```

### 支持的 API

| API | 说明 |
|-----|------|
| `get_login_info` | 获取登录信息 |
| `get_impl_info` | 获取实现信息 |
| `get_friend_list` | 获取好友列表 |
| `get_group_list` | 获取群列表 |
| `get_group_info` | 获取群信息 |
| `get_group_member_list` | 获取群成员列表 |
| `get_group_member_info` | 获取群成员信息 |
| `send_private_message` | 发送私聊消息 |
| `send_group_message` | 发送群消息 |
| `recall_private_message` | 撤回私聊消息 |
| `recall_group_message` | 撤回群消息 |
| `get_message` | 获取消息详情 |
| `set_group_name` | 设置群名 |
| `set_group_member_card` | 设置群名片 |
| `set_group_member_admin` | 设置管理员 |
| `set_group_member_mute` | 禁言成员 |
| `set_group_whole_mute` | 全体禁言 |
| `kick_group_member` | 踢出成员 |
| `send_group_nudge` | 群戳一戳 |
| `send_friend_nudge` | 好友戳一戳 |

### 支持的事件

| 事件 | 说明 |
|------|------|
| `message_receive` | 收到消息 |
| `message_recall` | 消息撤回 |
| `friend_request` | 好友请求 |
| `friend_nudge` | 好友戳一戳 |
| `friend_file_upload` | 好友文件上传 |
| `group_join_request` | 加群请求 |
| `group_invited_join_request` | 被邀请入群 |
| `group_admin_change` | 管理员变动 |
| `group_member_increase` | 成员增加 |
| `group_member_decrease` | 成员减少 |
| `group_mute` | 成员禁言 |
| `group_nudge` | 群戳一戳 |
| `group_file_upload` | 群文件上传 |

### 消息段类型

| 类型 | 收 | 发 | 说明 |
|------|:--:|:--:|------|
| `text` | ✅ | ✅ | 纯文本 |
| `mention` | ✅ | ✅ | @成员 |
| `mention_all` | ✅ | ✅ | @全体成员 |
| `face` | ✅ | ✅ | QQ 表情 |
| `reply` | ✅ | ✅ | 回复消息 |
| `image` | ✅ | ✅ | 图片 |
| `record` | ✅ | ✅ | 语音 |
| `video` | ✅ | ✅ | 视频 |
| `file` | ✅ | — | 文件 |
| `forward` | ✅ | — | 合并转发 |
| `market_face` | ✅ | — | 商城表情 |
| `light_app` | ✅ | ✅ | JSON 卡片 |
| `xml` | ✅ | — | XML 消息 |

## 致谢

Waylay 的诞生离不开以下项目的启发和贡献：

- [NapCatQQ](https://github.com/NapNeko/NapCatQQ) — 功能全面的 NTQQ 框架
- [LLOneBot](https://github.com/LLOneBot/LLOneBot) — 多协议适配的 QQ Bot 方案
- [Lagrange.Core](https://github.com/LagrangeDev/Lagrange.Core) — 优雅的 C# 协议实现
- [OneBot v11](https://github.com/botuniverse/onebot-11) — 统一的 Bot 协议标准

## 许可证

[Apache License 2.0](LICENSE) — 自由使用，需保留版权声明和出处。

Copyright 2026 Micuks
