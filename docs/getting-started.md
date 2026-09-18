# 开发环境

## 必需工具

- Node.js 和 pnpm
- CMake
- MinGW g++

## 安装前端依赖

```powershell
pnpm install
```

## 编译 C++ 引擎

```powershell
pnpm build:engine
```

## 启动桌面应用

先编译引擎，再启动前端和 Electron：

```powershell
pnpm build:engine
pnpm dev
```

## 验证

```powershell
pnpm verify
```

如果 CMake 选择了不同的生成器，需要相应调整 `build:engine` 脚本或手动执行 CMake 命令。

`verify` 的步骤是 `typecheck → test → build → build:engine → test:engine`。前端测试跑在 `build:engine` **之前**，因此任何需要真实引擎二进制的 `node:test` 都要能优雅跳过：`apps/desktop/tests/temporal-e2e.test.ts`（时序电路的端到端回归）在引擎二进制缺失时跳过，`verify` 的 `test:engine` 步骤在 `build:engine` 之后会把它再跑一遍。只跑它可以用：

```powershell
pnpm --filter @circuit-platform/desktop test:temporal-e2e
```

需要引擎二进制的环境变量 `CIRCUIT_ENGINE_PATH` 同样适用于它。
