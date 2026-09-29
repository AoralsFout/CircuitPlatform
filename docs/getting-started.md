# 开发环境

## 必需工具

- Node.js 24 和 pnpm 11.19.0（版本由根 `package.json` 指定）
- CMake 3.20 以上
- Windows：MinGW UCRT64 g++；Linux：支持 C++20 的 g++

最终用户使用 Windows 安装器即可，无需开发工具。安装、发布和诊断见[发布文档](releasing.md)。

## 安装前端依赖

```powershell
pnpm install --frozen-lockfile
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

统一基础验证：

```powershell
pnpm verify
```

`build:engine` 使用 Release 配置，Windows 新构建默认选择 MinGW Makefiles，Linux 使用 CMake 默认生成器；已有构建树沿用缓存生成器。需要另一工具链时在新的构建树上设置 `CMAKE_GENERATOR`。所有引擎可执行文件统一输出到 `engine/build/`，Release 下仍启用测试断言。

`verify` 的步骤是 `typecheck → test → build → build:engine → test:engine`，覆盖协议与桌面端类型检查、Node 自动化测试、生产构建、C++ 构建和 CTest，以及真实引擎时序 E2E。它不运行下面的独立 Electron E2E、子电路探针、视觉和性能命令。

前端测试跑在 `build:engine` **之前**，因此任何需要真实引擎二进制的 `node:test` 都要能优雅跳过：`apps/desktop/tests/temporal-e2e.test.ts`（时序电路的端到端回归）在引擎二进制缺失时跳过，`verify` 的 `test:engine` 步骤在 `build:engine` 之后会把它再跑一遍。只跑它可以用：

```powershell
pnpm --filter @circuit-platform/desktop test:temporal-e2e
```

### Electron 与子电路验收

Phase 6 提供统一的验收入口，强制检查真实引擎、成功标记与退出码，并收集各场景日志：

```powershell
pnpm regression
```

CI 采用同一入口，Linux 使用 Xvfb。运行器隔离用户配置，端口由系统分配；结果在 `artifacts/regression/`。CI 的触发与门槛见[持续集成说明](testing/continuous-integration.md)。

以下五条命令使用真实 Electron 窗口、正式 IPC 和 C++ 引擎，运行前先执行 `pnpm build:engine`。缺少引擎时直接失败；收口验收必须确认场景实际通过，不能把跳过当作通过：

```powershell
pnpm --filter @circuit-platform/desktop test:multidocument-e2e
pnpm --filter @circuit-platform/desktop test:embedded-snapshot-e2e
pnpm --filter @circuit-platform/desktop test:subcircuit-library-probe
pnpm --filter @circuit-platform/desktop test:embedded-definition-navigation-e2e
pnpm --filter @circuit-platform/desktop test:embedded-port-repair-e2e
```

它们分别覆盖多文档隔离与引擎恢复、快照保存及源文件移动后的重开、子电路树与键盘操作及导出、只读定义导航，以及缺失定义修复时的端口影响确认与撤销。测试会自行启动临时 Vite 服务，无需另开 `pnpm dev`。

需要真实引擎的测试默认使用 `engine/build/circuit-engine.exe`（Windows）；可通过环境变量 `CIRCUIT_ENGINE_PATH` 指定已有二进制的绝对路径。这一变量同样适用于上面的时序 E2E。

### 视觉与性能验收

```powershell
pnpm --filter @circuit-platform/desktop test:canvas-selection
pnpm --filter @circuit-platform/desktop visual:probe
pnpm --filter @circuit-platform/desktop visual:test
```

`test:canvas-selection` 通过正式 App 检查 Wire 选择与清除，并用原生鼠标验证点击元件库、预览跟随和单击落子。

`visual:probe` 自动断言 DOM 状态与键盘行为；`visual:test` 只生成深色/浅色及普通/窄窗口截图供人工检查，不比较像素或哈希。两者使用内存引擎替身，自行启动临时服务。截图写入被 Git 忽略的 `apps/desktop/artifacts/visual-regression/`；覆盖矩阵和已知限制见[视觉状态截图回归](testing/visual-regression.md)。

画布交互、1/5/10 文档和内部信号的性能命令、预算与采样限制见[画布性能基准](testing/performance-benchmark.md)。完整收口验收还需执行该文档中的五种画布交互、1/5/10 文档及内部信号矩阵；只通过 `pnpm verify` 和 Electron E2E 不代表完成性能验收。Spec #67 合并后的命令与结果见[收口验收记录](testing/spec-67-closure.md)。

## 项目文件与子电路

当前只接受 v2 `.circuit.json` 文件。旧版 v1 文件不能打开或作为导入来源，不提供自动迁移。父 Project 保存导入定义及实际使用到的递归依赖；保存、打开和引擎恢复均不依赖源文件。源文件的内容或位置变化不会更新已有快照，更新需要重新选择文件并显式重新导入。

只读定义标签展示结构，不建立独立仿真；某次放置位置的内部实时值由父画布的检查器查看。时序状态和波形属于会话状态，不保存到 Project。具体操作与边界见[内嵌子电路设计](design/embedded-subcircuits.md)、[ADR 0027](decisions/0027-embedded-subcircuit-snapshots.md)和[项目路线图](roadmap.md)。
