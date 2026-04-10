# Windows 安装指南（WSL）

Waylay 运行在 Linux 环境中，但 Windows 用户可以通过 WSL2（Windows Subsystem for Linux）轻松运行。WSL2 提供了完整的 Linux 内核，可以直接运行 Docker 和 Waylay，无需虚拟机。

## 前置条件

- Windows 10 版本 2004 及以上（内部版本 19041+），或 Windows 11
- 管理员权限

## 步骤一：安装 WSL2

以管理员身份打开 PowerShell，运行：

```powershell
wsl --install
```

安装完成后**重启电脑**。

重启后，确保默认使用 WSL2：

```powershell
wsl --set-default-version 2
```

安装 Ubuntu 发行版（如果上一步没有自动安装）：

```powershell
wsl --install -d Ubuntu
```

也可以从 Microsoft Store 搜索并安装 Ubuntu。

首次启动 Ubuntu 时，按提示设置用户名和密码。

## 步骤二：安装 Docker

有两种方式，选择其一即可。

### 方式 A：Docker Desktop（推荐新手使用）

1. 从 [docker.com](https://www.docker.com/products/docker-desktop/) 下载并安装 Docker Desktop
2. 安装时确保勾选 **Use WSL 2 based engine**
3. 安装完成后，打开 Docker Desktop → Settings → Resources → WSL Integration，确保你的 Ubuntu 发行版已启用
4. 之后在 WSL 终端中可以直接使用 `docker` 命令

### 方式 B：在 WSL 内安装 Docker Engine（无需 Desktop）

在 WSL 的 Ubuntu 终端中运行：

```bash
sudo apt-get update && sudo apt-get install -y docker.io
```

将当前用户加入 docker 组（避免每次都用 sudo）：

```bash
sudo usermod -aG docker $USER
```

**注意**：添加用户组后需要关闭并重新打开 WSL 终端才能生效，或者运行 `newgrp docker`。

启动 Docker 服务：

```bash
sudo service docker start
```

## 步骤三：运行 Waylay

在 WSL 终端中运行：

```bash
docker run -d --name waylay --privileged \
  -p 13000:13000 -p 3001:3001 \
  micuks/waylay:latest
```

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

## 步骤四：扫码登录

在 Windows 浏览器中打开：

```
http://localhost:13000/qrcode
```

使用手机 QQ 扫描页面上的二维码完成登录。

## 步骤五：连接 Bot 框架

### Yunzai（反向 WebSocket）

在 `docker run` 中添加反向 WS 地址，指向 Yunzai 的监听端口：

```bash
-e 'ONEBOT_WS_REVERSE_URLS=["ws://host.docker.internal:2536/OneBotv11"]'
--add-host=host.docker.internal:host-gateway
```

Yunzai 端配置反向 WS 监听端口为 `2536` 即可。

### Koishi（正向 WebSocket）

在 Koishi 中安装 `adapter-onebot` 插件，配置正向 WebSocket 连接：

- 协议：`ws`
- 地址：`localhost:3001`

确保 Waylay 启动时设置了 `ONEBOT_WS_PORT=3001`。

## 常见问题

### WSL 网络：localhost 能否从 Windows 访问？

可以。WSL2 默认支持 localhost 转发，Windows 上的浏览器和应用可以通过 `localhost` 直接访问 WSL 中的服务端口。

### Docker 权限被拒绝（permission denied）

如果运行 `docker` 命令时提示权限错误，说明当前用户不在 docker 组中：

```bash
sudo usermod -aG docker $USER
```

然后关闭并重新打开 WSL 终端。

### QQ 登录过期

二维码登录有效期较短。如果登录过期：

1. 重新访问 `http://localhost:13000/qrcode` 扫码
2. 或者设置 `AUTO_LOGIN_QQ` 环境变量实现快速登录，避免反复扫码：

```bash
docker run -d --name waylay --privileged \
  -p 13000:13000 -p 3001:3001 \
  -e AUTO_LOGIN_QQ=123456789 \
  -v waylay_qq:/root/.config/QQ \
  micuks/waylay:latest
```

使用 `-v waylay_qq:/root/.config/QQ` 挂载数据卷可以持久化登录状态，避免容器重启后需要重新登录。
