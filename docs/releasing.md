# Windows 发布与故障诊断

Phase 6 的交付目标是 Windows x64 当前用户 NSIS 安装器。安装包包含 Electron、渲染页面和 C++ 引擎；使用者不需要 Node.js、pnpm、CMake 或 MinGW。版本与资源边界见 [ADR 0028](decisions/0028-windows-release-and-runtime-diagnostics.md)。

## 构建与验收

维护者使用 Node.js 24、根 `package.json` 中指定的 pnpm 11.19.0、CMake 3.20 以上和 MinGW UCRT64 g++。在仓库根目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm verify
pnpm regression
pnpm package:win
pnpm package:smoke
pnpm package:install-smoke
node scripts/release-assets.mjs
```

`package:win` 先校验版本，再构建前端与 Release 引擎，生成安装器并校验解包资源。开发机只想检查运行目录时可以运行 `pnpm package:dir`。所有打包命令明确使用 `--publish never`，不会因为本机存在 GitHub 凭据而自动上传。

| 产物 | 用途 |
| --- | --- |
| `release/CircuitPlatform-0.1.0-windows-x64-setup.exe` | 当前版本安装器；后续文件名随版本变化 |
| `release/win-unpacked/` | 安装内容的解包目录，包含 `CircuitPlatform.exe` |
| `release/SHA256SUMS.txt` | 安装器 SHA-256 校验值 |
| `release/smoke/` | 打包程序的截图、结果和失败诊断 |
| `artifacts/regression/` | 八项 Electron 回归的逐场景日志和总结果 |

`package:check` 验证 x64 架构、版本、ASAR 入口、前端相对资源地址与开发文件排除，并在只有系统目录的 PATH 中启动随包引擎。`package:smoke` 直接运行打包程序，使用临时用户配置与工作目录，验证正式 `file://` 页面、CSS、preload、真实引擎、工程读写、界面单步、Ctrl+S 保存及退出日志。它还注入无效开发环境变量，验证生产包确实忽略开发引擎和测试页面入口。

`pnpm regression` 顺序执行多文档隔离与恢复、内嵌快照、子电路库、定义导航、端口修复、画布选择与点击放置、视觉 DOM 探针及日志不可写时的真实启动，共八项。每项需要退出码 0 和成功标记，缺引擎或跳过都算失败；每项最多运行三分钟，并使用独立用户配置。截图采集和性能矩阵仍是独立验收，详见[视觉回归](testing/visual-regression.md)与[性能基准](testing/performance-benchmark.md)。

`package:install-smoke` 先确认当前用户和系统均没有 CircuitPlatform 安装，再把安装器静默安装到含中文与空格的临时目录，对实际安装内容运行同一打包程序验收，最后卸载并检查目录和注册表记录已清除。已有安装时保护性拒绝，不覆盖用户程序；改在干净的 Windows 运行器执行。结果写入 `release/smoke/installer-smoke.json`。本机若受工具运行沙箱限制，应在正常用户环境执行这些安装包验收，不应给生产应用禁用安全沙箱以掩盖环境问题。

## 安装、更新与卸载

运行安装器即可安装到当前用户目录，无需管理员权限。开始菜单与桌面提供 CircuitPlatform 入口。更新前先保存并关闭应用，再运行新版本安装器。当前不提供应用内自动更新。

用户工程使用 `.circuit.json` 文件独立保存。当前只接受 v2，不自动迁移 v1。卸载通过 Windows 的“已安装的应用”执行；安装器不删除用户自己保存的工程，默认也保留用户偏好与日志。

## CI 与发布草稿

普通 push 和 Pull Request 在 Windows 2022、Ubuntu 24.04 上执行 `pnpm verify` 和八项 Electron 回归，Linux 使用 Xvfb。代码改动提交前仍需本地验证；配置文件存在并不代表 GitHub 上已经运行成功。

版本发布前同步根包、桌面包、协议包及两处 CMake project 版本，再按需要更新用户文档。引擎版本由 CMake 项目版本注入，防止应用和引擎显示不同版本。标签必须是与版本完全相同的 `v<version>`。

推送发布标签后，Windows 工作流重新执行验证、回归、打包、打包程序验收和实际安装/卸载验收，生成校验值并保存构建产物。随后独立的发布 job 才取得 `contents: write` 权限，校验下载产物的 SHA-256 并创建 **草稿 Release**。维护者检查安装与卸载证据、已知限制和签名状态后，再手动公开草稿。

当前没有配置代码签名证书，默认安装器未签名；Windows 可能显示未知发布者或 SmartScreen 提示。不要把生成校验值等同于代码签名，也不要声称未执行过的系统信任检查已通过。若以后接入证书，应通过 CI secrets 配置 electron-builder 支持的签名选项、增加签名验证，并更新发布说明；证书和密码不得提交仓库。

## 本地日志与恢复

默认日志在 `%APPDATA%\@circuit-platform\desktop\logs\circuit-platform.log` 所对应的 Electron 用户数据目录下；运行参数 `--user-data-dir=<目录>` 可隔离配置，日志随之放在该目录的 `logs/` 子目录。发生主进程或渲染进程致命故障时，错误对话框会显示实际日志路径。

日志每份最多 1 MiB，保留当前文件及 `.1`、`.2` 共三份；队列最多 128 条。记录启动、版本、平台、进程生命周期、超时、协议错误和文件操作错误码。不写入工程路径、工程内容、协议消息全文或 stderr 原文，也不上传。引擎 stderr 持续读取，仅记录累计字节数，避免管道满后卡住。目录不可写时停用日志，业务继续运行。

引擎请求默认超时 5 秒，单条响应上限 8 MiB。超时、畸形输出或超限后，客户端终止对应文档的引擎进程并拒绝等待中的请求。健康检查重启后，工作区按当前编辑器文档重建结构；时序状态和波形会重置，其他文档仍各自隔离。不存在的随包引擎会提示修复或重新安装，普通用户不需要执行开发命令。

报告问题时提供应用版本、Windows 版本、操作步骤、界面错误与相关时间段的诊断日志。只有确实需要复现电路且用户愿意分享时才附工程文件。
