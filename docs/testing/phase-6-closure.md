# Phase 6 本地验收记录

验收日期：2026-09-30。目标：Windows x64 当前用户安装器。环境：Windows、Node.js 24.19.0、pnpm 11.19.0、CMake 4.1.0、MinGW UCRT64。

## 已验证

| 验证 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过，锁文件可复现安装 |
| `pnpm verify` | 通过：类型检查、2 项打包脚本测试、16 项协议测试、409 项桌面测试、生产构建、4 项 CTest 和 9 项真实引擎回归 |
| Release C++ 断言 | 四个测试 target 显式取消 `NDEBUG`，Release 下真实执行断言 |
| `pnpm regression` | 8/8 通过；视觉 DOM 探针覆盖 21 状态，结果在 `artifacts/regression/summary.json` |
| 引擎故障与日志 | stderr 大量输出、UTF-8 分片、超时、坏响应、换代隔离、多文档故障隔离、轮转、队列上限、日志不可写均有测试 |
| 真实日志故障启动 | 将临时 profile 的 `logs` 变为普通文件，正式页面仍加载、引擎仍健康、logger 停用、退出正常 |
| `pnpm package:win` | 生成 NSIS 安装器，随包资源校验通过 |
| `pnpm package:check` | x64 PE、ASAR 入口、版本一致、开发文件排除、相对资源地址与系统 PATH 下真实引擎健康均通过 |
| `pnpm package:smoke` | 正式安装内容在临时配置与工作目录运行，`file://` 页面、CSS、preload、真实 NOT 仿真、中文/空格工程路径、打开、单步、输入修改、Ctrl+S 保存和退出日志通过 |
| 生产覆盖隔离 | 无效开发引擎路径和 E2E URL 被忽略，生产桥接不暴露 killForTest |
| `pnpm package:install-smoke` | 当前用户安装到中文与空格临时路径，校验实际安装内容并通过完整程序回归；卸载后安装目录与 HKCU/HKLM 应用记录消失，临时目录已清理 |
| workflow 静态检查 | 官方 actionlint 1.7.12 检查两份 workflow 零诊断；版本标签不匹配会被拒绝 |
| 安装器签名 | `Get-AuthenticodeSignature` 实测 `NotSigned` |

打包程序在正常用户环境中验收，保留 Electron 默认安全沙箱；工具运行沙箱曾导致 GPU 子进程 DLL 加载失败，因此没有用禁用生产安全沙箱来绕过该问题。回归脚本会对失败返回非零并保留诊断。

## 发布产物

- 安装器：`release/CircuitPlatform-0.1.0-windows-x64-setup.exe`，94,190,511 字节。
- 校验值：`release/SHA256SUMS.txt`。
- SHA-256：`19e5907d7221dd43aaac3d9b0916e0057be277ec5a6baf6ffc67d1ccceb0b3bf`。
- 程序验收截图与 JSON 结果：`release/smoke/`。
- 实际安装/卸载结果：`release/smoke/installer-smoke.json`，`installed: true`、`removed: true`、`passed: true`。

这些运行产物由 Git 忽略，CI 会保存对应 artifacts。重新打包后必须重新验收并生成校验值，不沿用本记录的旧 hash。

## 仍需外部执行的事项

- 本机只实际运行了 Windows；Linux 和远端 GitHub Actions 的运行结果尚未取得，不能由 workflow 静态检查替代。
- 当前没有代码签名证书，也没有执行已签名包或 SmartScreen 信任验证。
- 尚未创建版本标签或公开 Release。维护者合入后应检查双平台 CI，再按[发布文档](../releasing.md)推送版本标签、审核发布草稿。
- 本阶段未修改画布渲染算法；既有性能矩阵和截图基准限制继续保留，不把本次打包烟测当作完整视觉/性能矩阵重测。
