# CircuitPlatform

CircuitPlatform 是一个简易数字电路仿真桌面应用。

项目采用 Vue、TypeScript、Electron 和 C++ 构建。C++ 仿真引擎作为独立进程运行，桌面应用通过 JSON 消息与它通信。

## 当前阶段

Phase 0–5.6 已完成，覆盖图形编辑器、时序逻辑、多位 Port、波形与持久化、层次化电路以及多文档工作区。Spec #67 的内嵌子电路快照已合并：父 Project 自包含保存导入定义及递归依赖，支持定义树、只读查看、重新导入、删除与修复、撤销及导出。Phase 6 的工程实现与 Windows 本地验收已完成：提供 CI、运行诊断、故障恢复、Windows x64 安装器和标签发布草稿流程；尚未公开发布，签名与远端 CI 状态见[验收记录](docs/testing/phase-6-closure.md)。

当前项目文件使用严格的 v2 格式。旧版 v1 文件不能打开或导入，也不自动迁移。导入后不再依赖源文件，源文件修改、移动或删除不会改变父工程；更新定义需要显式重新导入。详见[内嵌子电路设计](docs/design/embedded-subcircuits.md)与 [ADR 0027](docs/decisions/0027-embedded-subcircuit-snapshots.md)。

交付范围、验收证据和已知限制见[项目路线图](docs/roadmap.md)；画布性能的采样口径与历史遗留见[画布性能基准](docs/testing/performance-benchmark.md)。

## 开发环境

- Windows（第一阶段目标平台）
- Node.js 24
- pnpm 11.19.0
- CMake 3.20 以上
- MinGW UCRT64 g++（Linux 基础验证使用 g++）

最终用户直接使用 Windows x64 安装器，无需开发工具。构建安装器、安装/卸载验收与日志位置见[发布文档](docs/releasing.md)。

## 常用命令

```powershell
pnpm install --frozen-lockfile
pnpm build:engine
pnpm dev
```

验证类型检查、Node 自动化测试、生产构建、C++ 构建与测试，以及真实引擎时序回归：

```powershell
pnpm verify
```

`verify` 不包含独立 Electron E2E、子电路探针、视觉与性能验收；这些命令及前置条件见[开发环境说明](docs/getting-started.md#验证)。截图命令只采集供人工检查的画面，不做像素回归判定。

统一运行八项 Electron 回归，并生成 Windows 安装器及验收它：

```powershell
pnpm regression
pnpm package:win
pnpm package:smoke
pnpm package:install-smoke
```

安装/卸载验收要求本机尚未安装 CircuitPlatform，避免覆盖已有用户安装。当前安装器未签名。

Spec #67 合并后的验证结果见[收口验收记录](docs/testing/spec-67-closure.md)。

## 文档

先读：

- [领域语言](CONTEXT.md)
- [工程约定](AGENTS.md)

规划与设计：

- [项目愿景](docs/vision.md)
- [项目路线图](docs/roadmap.md)
- [架构设计](docs/architecture.md)
- [引擎 JSON Lines 协议](docs/protocol.md)
- [架构决策记录](docs/decisions/0001-initial-architecture.md)
- [前端设计规范](docs/design/frontend-design-system.md)
- [多文档与下钻设计](docs/design/multi-document-and-drill-down.md)
- [内嵌子电路设计](docs/design/embedded-subcircuits.md)
- [内嵌快照决策 ADR 0027](docs/decisions/0027-embedded-subcircuit-snapshots.md)

验证与协作：

- [画布性能基准](docs/testing/performance-benchmark.md)
- [视觉状态截图回归](docs/testing/visual-regression.md)
- [协作约定](docs/ai/working-agreement.md)
- [Issue Tracker](docs/agents/issue-tracker.md)
- [Triage 标签](docs/agents/triage-labels.md)
- [开发环境说明](docs/getting-started.md)
- [CI 与统一回归](docs/testing/continuous-integration.md)
- [Windows 发布与故障诊断](docs/releasing.md)
- [Phase 6 验收记录](docs/testing/phase-6-closure.md)
