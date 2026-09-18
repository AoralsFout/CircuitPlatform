# CircuitPlatform

CircuitPlatform 是一个简易数字电路仿真桌面应用。

项目采用 Vue、TypeScript、Electron 和 C++ 构建。C++ 仿真引擎作为独立进程运行，桌面应用通过 JSON 消息与它通信。

## 当前阶段

当前处于 Phase 3：图形编辑器（已完成）。

Phase 0–2.5 已完成：项目脚手架、领域模型、组合逻辑和跨进程协议的最小闭环均已建立。前端已经完成编辑器式工作区的结构重构，并交付了切片 1、2 与切片 3：数据驱动的画布投影、元件放置与拖动、双向端口连线、手工正交 Route 与重接、删除与撤销。

切片 3 的性能验收此前未达标，已修复：目标规模下五种交互模式的第 95 百分位帧耗时从 60–94ms 降到 0.2–7.1ms，全部满足 20ms 预算。Component 拖动与 Route 拖动的帧间隔 P50 仍在 60–71ms，已排除渲染与投影两侧的原因，属于待进一步归因的遗留（详见[画布性能基准](docs/testing/performance-benchmark.md)）。

当前阶段的目标是逐步实现：

```text
元件操作 → SVG 画布 → 编辑器模型 → Electron IPC → C++ 引擎
```

具体切片顺序和验收标准见[项目路线图](docs/roadmap.md)。

## 开发环境

- Windows（第一阶段目标平台）
- Node.js
- pnpm
- CMake
- MinGW g++

## 常用命令

```powershell
pnpm install
pnpm build:engine
pnpm dev
```

验证全部基础工程：

```powershell
pnpm verify
```

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

验证与协作：

- [画布性能基准](docs/testing/performance-benchmark.md)
- [视觉状态截图回归](docs/testing/visual-regression.md)
- [协作约定](docs/ai/working-agreement.md)
- [Issue Tracker](docs/agents/issue-tracker.md)
- [Triage 标签](docs/agents/triage-labels.md)
- [开发环境说明](docs/getting-started.md)
