# 变更日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 规范，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布] / v0.4.1 - 2026-04-15

### 新增

- 实现群文件管理 API（上传、移动、删除等）
- 支持通过 `multiForwardMsgWithComment` 原生发送合并转发消息
- 新增 `move_group_file` 动作

### 修复

- `get_stranger_info` 现从缓存和 profile 事件中读取昵称
- `upload_group_file` 错误细化，增加超时处理
- 通过本地 HTTP 代理转发已接收图片，避免 CDN rkey 过期导致图片失效

---

## [0.4.0] - 2026-04-11

### 新增

- 新增 Milky 协议适配器（HTTP API + WebSocket/SSE 事件推送）
- 新增 `__introspect` 动作，用于运行时自检
- 默认启用反向 WebSocket 连接
- 为容器设置 hostname，实现登录状态持久化

### 修复

- 修复 `send_like` 和 `get_stranger_info` 接口异常
- 修复 `send_msg` 因媒体下载使用同步 `execSync` 导致的超时问题，改为异步 `exec`

### 移除

- 从仓库中移除内部文档

---

## [0.3.0] - 2026-04-10

### 新增

- 发布 Docker Hub 镜像，提供一键安装脚本和简化版 `docker-compose`
- 新增 WSL 使用指南及 Windows NTQQ Hook 调研文档

### 修复

- 修复引用回复消息时时间戳显示为 1970-01-01 的问题

---

## [0.2.0] - 2026-04-09

### 新增

- 对好友列表和群成员进行缓存，查询延迟降至毫秒以下
- 支持发送视频、文件和语音消息
- 替换第三方基础镜像为 `debian:bookworm-slim`，并添加国内 apt/npm 镜像加速

### 修复

- 修复小程序消息（如哔哩哔哩等）被静默丢弃的问题

### 移除

- 从 `docker-compose` 中移除旧版 LLOneBot 服务

---

## [0.1.0] - 2026-04-08

### 新增

- 实现基于 NTQQ 的无头 LLOneBot 兼容桥接服务
- 实现 OneBot v11 协议支持（事件上报、动作调用、消息段）
- 补全缺失的 OneBot v11 事件、动作与消息段类型

### 修复

- 修复图片发送：通过独立会话配合正确的 BDH 上传流程实现
- 修复 @ 提及：正确解析 UID 与显示名称

### 变更

- 清理代码库中的历史遗留命名
