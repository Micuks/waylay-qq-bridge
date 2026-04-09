<div align="center">

<img src="https://media.valorant-api.com/agents/df1cb487-4902-002e-5c17-d28e83e78588/displayicon.png" width="160" />

# Waylay

**轻量、高速、纯 JS 的 NTQQ 无头桥接，内置 OneBot v11 协议支持**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-≥18-green.svg)](https://nodejs.org/)
[![QQ Version](https://img.shields.io/badge/QQ-3.2.27-blue.svg)](https://im.qq.com/linuxqq/index.shtml)
[![OneBot v11](https://img.shields.io/badge/OneBot-v11-black.svg)](https://github.com/botuniverse/onebot-11)
[![Dependencies](https://img.shields.io/badge/依赖-1_(ws)-brightgreen.svg)](#为什么选择-waylay)

[English](README-en.md)

</div>

---

## 特性

- **极致轻量** — 9 个文件、~3,000 行纯 JavaScript，1 个依赖 (`ws`)，208 KB node_modules
- **亚毫秒查询** — 事件驱动缓存，所有读操作 < 1ms 响应，比 LLOneBot 快 **9–48 倍**
- **零抽象税** — 直接调用 `wrapper.node` 原生接口，从 OneBot Action 到 QQ 内核仅 ~3 层调用
- **低内存占用** — 运行时 ~150 MB（含 QQ 内核），无 Winston/Express/SQLite/React 等额外开销
- **单进程架构** — 无 master/worker 分离、无 WebUI 进程、无独立数据库进程
- **开箱即用** — Docker 一键部署，直连 Yunzai / Koishi / Miao-Yunzai 等框架
- **LLOneBot 兼容** — 同时暴露 LLOneBot 兼容的 JSON-over-WebSocket 协议（端口 13000）

## 工作原理

```
Yunzai / Koishi ←→ Waylay (OneBot v11) ←→ wrapper.node ←→ QQ 服务器
```

1. 在 QQ 的 Electron 进程中运行（补丁 `package.json` 入口点）
2. 直接加载 NTQQ 的 `wrapper.node` 原生模块
3. 初始化 QQ 内核、处理登录（扫码或快速登录）
4. 注册全部内核事件监听（消息、群组、好友等）
5. 对外暴露：
   - **OneBot v11 WebSocket** — 端口 3001（正向/反向 WS）
   - **Bridge WebSocket** — 端口 13000（LLOneBot 兼容）

## 快速开始

```bash
# 克隆仓库
git clone https://github.com/Micuks/waylay.git
cd waylay

# Docker 一键启动
docker compose up -d --build

# 访问二维码登录
open http://localhost:13000/qrcode
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

## 支持的 QQ 版本

| 版本 | 平台 | 状态 |
|------|------|------|
| QQ 3.2.27 (Linux amd64) | Docker / Linux | 已验证 |

> Waylay 加载 NTQQ 的 `wrapper.node`，理论上支持所有包含该模块的 QQ Linux 版本。

## 性能对比

### 与同类项目对比

| | **Waylay** | NapCatQQ | LLOneBot | Lagrange.Core |
|---|---|---|---|---|
| **语言** | JavaScript | TypeScript | TypeScript | C# |
| **源码规模** | **~3,000 行 / 9 文件** | ~3 MB / 832 文件 | ~1.7 MB / 529 文件 | ~1.4 MB / 1,027 文件 |
| **运行时依赖** | **1** (`ws`) | ~30 npm 包 | 23 npm 包 | 6 NuGet 包 |
| **node_modules** | **208 KB** | ~100+ MB | ~80+ MB | N/A (.NET) |
| **应用代码体积** | **120 KB** | ~3 MB | ~1.7 MB | ~1.4 MB |
| **运行内存** | **~150 MB** | ~300 MB+ | ~300 MB+（含 QQNT） | ~50-100 MB |
| **实现方式** | 直接调用 wrapper.node | wrapper.node + FFI | QQNT 插件 (LiteLoader) | 协议重新实现 |
| **需要 QQ** | 是 | 是 | 是（+ LiteLoader） | 否 |
| **项目状态** | 活跃维护 | 活跃 | 活跃 | 已归档 (2025) |

### 响应延迟对比（Waylay vs LLOneBot，10 轮平均值）

| Action | Waylay | LLOneBot | 倍率 |
|--------|--------|----------|------|
| `get_login_info` | **0.7ms** | 6.3ms | 9x |
| `get_friend_list` | **1.0ms** | 47.9ms | **48x** |
| `get_group_list` | **0.8ms** | 27.3ms | **34x** |
| `get_group_info` | **0.6ms** | 28.4ms | **47x** |
| `get_group_member_list` | **1.0ms** | 10.2ms | **10x** |
| `get_group_member_info` | **0.5ms** | 12.0ms | **24x** |
| `send_group_msg` | 403ms | 457ms | 1.1x |

> 所有查询类 Action 均为亚毫秒级响应，得益于事件驱动的内存缓存。`send_group_msg` 耗时相当 — 两者均受限于 QQ 服务器往返延迟。

### 架构对比

```
NapCatQQ (24 packages, ~30 deps):
  Yunzai ←→ NapCat-OneBot ←→ NapCat-Core ←→ napi2native.node ←→ wrapper.node ←→ QQ Server

LLOneBot (23 deps):
  Yunzai ←→ LLOneBot plugin ←→ LiteLoaderQQNT ←→ QQNT Renderer ←→ QQ Server

Waylay (1 dep):
  Yunzai ←→ Waylay ←→ wrapper.node ←→ QQ Server
```

## 为什么选择 Waylay

| 特性 | 说明 |
|------|------|
| **极致轻量** | ~3,000 行纯 JS，1 个依赖，208 KB node_modules — 无 TypeScript 编译、无打包器、无 monorepo |
| **亚毫秒查询** | 内核事件监听 → 内存缓存，无数据库、无 API 往返 |
| **低内存** | ~150 MB（含 QQ 内核）。NapCat/LLOneBot 通常 300+ MB（Winston、Express、SQLite、React/Vite） |
| **零抽象层** | 直接调用 `wrapper.node`，无依赖注入 (inversify)、无插件系统 (cordis)、无 protobuf 代码生成 |
| **单进程** | 无 master/worker、无 WebUI 服务器、无独立数据库进程 |
| **秒级启动** | wrapper.node 加载 + 引擎初始化 + 登录 + 会话就绪，无编译步骤、无资源打包、无数据库迁移 |
| **内置 OneBot v11** | 直连 Yunzai/Koishi，无需 LLOneBot 中间层，省去一跳和 ~200 MB 额外内存 |

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
| `record` | ✅ | — | 语音 |
| `video` | ✅ | — | 视频 |
| `file` | ✅ | — | 文件 |
| `json` | ✅ | ✅ | JSON 卡片 |
| `forward` | ✅ | ✅ | 合并转发 |
| `dice` | ✅ | ✅ | 骰子 |
| `rps` | ✅ | ✅ | 猜拳 |
| `shake` | ✅ | — | 戳一戳 |
| `mface` | ✅ | — | 商城表情 |
| `markdown` | ✅ | — | Markdown |
| `music` | — | ✅ | 音乐分享（自定义） |

## LLOneBot 兼容

Waylay 同时在端口 13000 暴露与 LLOneBot 兼容的 JSON-over-WebSocket 协议。LLOneBot 可直接连接 `ws://host:13000/ws` 作为即插即用的替代方案。

## 二维码登录

快速登录失效时（Token 过期），自动回退到扫码登录。访问二维码：

```
http://host:13000/qrcode
```

## 许可证

[MIT](LICENSE) - 自由使用，开放修改。
