# Windows 支持计划

## 状态：待实现（需要 Windows 环境测试）

## 推荐方案：process.dlopen 独立进程

与 Linux 上的架构一致，不需要 DLL 注入或 C++ 编译。

### 实现步骤

1. **检测 QQ 安装路径** — 从注册表读取：
   ```
   HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\QQ → UninstallString
   ```

2. **读取当前版本** — 解析 `<QQ_DIR>/versions/config.json`

3. **定位 wrapper.node** — `versions/<ver>/resources/app/wrapper.node`

4. **处理 companion DLL** — Windows wrapper.node 依赖约 10 个 DLL：
   - `avif_convert.dll`, `broadcast_ipc.dll`, `libvips-42.dll` 等
   - 需复制到同目录或加入 PATH

5. **设置平台参数** — `platform_type: 3` (KWINDOWS)
   - `bridge.js` 已有 Windows 相关代码路径（行 80-86, 181-183, 204, 479-485）

6. **启动方式** — 用 QQ 自带的 Electron 或匹配 ABI 的 Node.js

### 发布形式

- Windows installer (.exe) 或 portable zip
- 启动脚本 (.bat / .ps1)
- 可选：Docker Desktop (Windows containers) 镜像

### 参考

- NapCatQQ Windows 实现：DLL 注入 (`NapCatWinBootMain.exe` + `NapCatWinBootHook.dll`)
- NapCat 独立模式：`process.dlopen` 从独立 Node 进程加载 wrapper.node
- 详细调研：[windows-ntqq-research.md](./windows-ntqq-research.md)

### 前置条件

- 需要 Windows 开发/测试环境
- 需要验证 QQ Windows 版本的 wrapper.node ABI 兼容性
