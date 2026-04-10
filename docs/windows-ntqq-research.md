# Windows NTQQ Hooking 可行性调研

## 1. Windows QQ 目录结构

Windows QQ 安装路径通过注册表获取（通常 `C:\Program Files\Tencent\QQNT`）：

```
HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\QQ → UninstallString
```

**与 Linux 的关键区别**：Windows QQ 使用**版本化目录**布局：

```
<QQ_DIR>/versions/<version>/resources/app/package.json
<QQ_DIR>/versions/<version>/resources/app/wrapper.node
<QQ_DIR>/versions/<version>/resources/app/major.node
<QQ_DIR>/versions/config.json   ← 记录当前版本号
```

Linux 是扁平结构：`/opt/QQ/resources/app/package.json`。两个平台都不使用 `app.asar`，资源是解包的。

## 2. NapCatQQ 的 Windows 实现（3 种模式）

### 模式 A：DLL 注入（Windows 主要方式）

NapCatQQ 提供 `NapCatWinBootMain.exe`（启动器）+ `NapCatWinBootHook.dll`（注入 DLL）。启动器启动 QQ.exe 并注入 hook DLL。通过环境变量（`NAPCAT_PATCH_PACKAGE`、`NAPCAT_LOAD_PATH`）告诉 DLL 替换的 `qqnt.json`（补丁 package.json）和加载脚本的位置。不修改 QQ 原始文件。

### 模式 B：Framework/dlopen hook（QQ Electron 内部）

hook `process.dlopen`，当 QQ 加载 `wrapper.node` 时拦截，捕获 wrapper API，创建代理对象。运行在 QQ 的 Electron 进程内部。

### 模式 C：独立进程（无 QQ GUI）

通过 `process.dlopen` 直接从独立 Node.js 进程加载 `wrapper.node`。复制 wrapper.node、companion DLL、config.json 到独立目录运行。**这与 Waylay 在 Linux 上的做法最接近。**

## 3. 方案可行性评估

| 方案 | 评级 | 说明 |
|------|------|------|
| **package.json 补丁** | 可行 | 与 Linux 相同。补丁 `versions/<ver>/resources/app/package.json`。QQ 自动更新会覆盖。 |
| **DLL 注入**（NapCat 模式） | 可行但较重 | 需要构建原生 C++ 启动器 + DLL。已被 NapCat 验证。不修改文件。但会触发杀毒软件启发式检测。 |
| **process.dlopen 独立进程** | **推荐** | 从 QQ 目录复制 wrapper.node + DLL。用 Waylay 自己的 Node/Electron 加载。Waylay 在 Linux 上已经这样做。 |
| **Electron --require** | 风险高 | 需要用自定义参数启动 QQ.exe，无可靠方式注入。 |
| **app.asar 操作** | 不适用 | QQ 不使用 app.asar。 |

## 4. 推荐方案：独立 process.dlopen

**使用 process.dlopen 独立进程方案**，与 Waylay 在 Linux 上的架构一致。

### 具体实现步骤

1. **检测 QQ 安装路径** — 从注册表读取
2. **读取当前版本** — 解析 `versions/config.json`
3. **定位 wrapper.node** — `versions/<ver>/resources/app/wrapper.node`（参考 NapCat 的回退逻辑）
4. **处理 companion DLL** — Windows wrapper.node 依赖约 10 个 DLL（`avif_convert.dll`、`broadcast_ipc.dll`、`libvips-42.dll` 等），需要确保可访问（复制或加入 PATH）
5. **设置平台参数** — engine init 时 `platform_type: 3`（KWINDOWS）。Waylay 的 `bridge.js` 已有 Windows 相关代码路径。

### 关键挑战

- **companion DLL**：wrapper.node 依赖约 10 个 DLL，必须与之同目录或在 PATH 上
- **自动更新**：QQ 快速更新会创建新版本目录，破坏固定路径。需从 `versions/config.json` 动态检测
- **Windows Defender**：DLL 注入触发启发式检测。独立 process.dlopen 方案可避免
- **Electron ABI**：wrapper.node 是针对 QQ 特定 Electron/Node ABI 编译的。独立模式需使用匹配的 Node.js 版本或 QQ 自带的 Electron
