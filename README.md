# CircuitPlatform

CircuitPlatform 是一个用于学习软件工程的简易数字电路仿真桌面应用。

项目采用 Vue、TypeScript、Electron 和 C++ 构建。C++ 仿真引擎作为独立进程运行，桌面应用通过 JSON 消息与它通信。

## 当前阶段

当前是 Phase 0：项目脚手架。

本阶段的目标是建立一个可验证的最小闭环：

```text
Vue 页面 → Electron 主进程 → C++ 引擎 → 健康检查结果 → Vue 页面
```

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

- [项目愿景](docs/vision.md)
- [架构设计](docs/architecture.md)
- [学习路线](docs/learning/roadmap.md)
- [AI 角色约定](docs/ai/roles.md)
- [协作约定](docs/ai/working-agreement.md)
- [架构决策记录](docs/decisions/0001-initial-architecture.md)
- [开发环境说明](docs/getting-started.md)
