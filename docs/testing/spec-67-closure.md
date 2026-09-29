# Spec #67 合并后收口验收

## 范围与环境

本次验收于 2026-09-30 在 Windows 工作区执行，基于 `main` 的合并提交 `52809496fa302c90eea0914b61815bce90788a31`，并包含本次性能验收夹具与失败报告修复。[PR #78](https://github.com/AoralsFout/CircuitPlatform/pull/78) 已合并，规格 #67 与实现票 #68–#77 均已关闭。

工具版本：Node.js `24.19.0`、pnpm `11.19.0`、CMake `4.1.0`、MinGW g++ `15.2.0`。真实引擎使用本工作区 `engine/build/circuit-engine.exe`。

本次处理 Spec #67 的交付遗漏与回归验证，以及验收过程中发现的点击放置入口和预览性能问题。Phase 6 的 CI、安装包和正式发布尚未开始，不能由本记录推定发布就绪。

## 收口改动

- README、开发说明和路线图同步到内嵌快照已交付状态，列明严格 v2 格式、旧版不迁移、只读定义和显式重新导入的边界。
- 开发说明区分基础 `verify`、真实 Electron 场景、DOM 探针、截图采集和交互性能，补齐可重复执行的入口。
- 性能页的交互夹具原先仍包装为 v1，无法通过生产打开路径；改为完整 v2 Project，并移除展平时已经失效的源文件读取器。
- 性能 runner 原先在页面初始化失败后无限等待 `__benchmarkReady`；增加有界等待与错误报告，使失效夹具明确失败，不再永久挂起。
- 点击元件库时初始化可见画布中心的放置预览，接续首次指针移动与单击；扩展已有画布回归，通过原生鼠标检查预览与实际落点。
- 开始、移动放置预览只更新临时编辑状态，不重建层次投影或重新计算脏标记；指针位置在视图层维护，避免每帧重新投影整幅 Circuit。实际落子继续走原结构事务，失败态同步重试位置。新增公开操作回归覆盖仿真、历史、保存状态、连续放置、Alt、取消及无关选择。

## 基础验证

全部修复定稿后，从仓库根目录重新执行 `pnpm verify`，退出码为 0。最终结果：

| 项目 | 结果 |
| --- | --- |
| 协议/桌面类型检查 | 通过 |
| 协议测试 | 16/16，通过，无跳过 |
| 桌面测试 | 388/388，通过，无跳过，含本次新增的两条放置回归 |
| 协议与桌面生产构建 | 通过 |
| C++ 构建与 CTest | 4/4，通过 |
| 构建后真实引擎时序 E2E | 9/9，通过，无跳过 |
| 三层内嵌 Project 加载预算 | 展平后 500 Component / 1,000 Connection，含首次求值；构建后时序回归三次 `2873 / 2647 / 2607ms`，均值 `2709ms ≤ 6000ms` |

性能脚本修复后单独执行 `node --test --experimental-strip-types apps/desktop/tests/performance.test.ts`，6/6 通过；`node --check apps/desktop/scripts/performance-benchmark-runner.cjs` 通过。放置修复相关的 editor-session、workspace、embedded-workspace 与 performance 测试共 125/125 通过，并已纳入上方最终统一验证。`git diff --check` 与六份交付文档的本地文件链接检查通过。

## 独立桌面与视觉验证

命令均从仓库根目录执行；前缀为 `pnpm --filter @circuit-platform/desktop`。以下五项均实际运行并退出 0，没有 `SKIP`。

| 命令 | 本次可观察结果 |
| --- | --- |
| `test:embedded-snapshot-e2e` | 保存成功，源文件移走后重开成功，Port 保留为 `a/y`，真实输出仍为 `0`，定义数为 1 |
| `test:subcircuit-library-probe` | 原生 Space/Tab 键盘操作、长名称、同名编号、改名、导出及撤销删除通过；树节点 3、嵌套深度 1、导出版本 2，父文件字节未变 |
| `test:embedded-definition-navigation-e2e` | 树与画布复用同一只读标签；4 个 Component、3 条 Wire，保存输入值 `1` 与 Port 顺序保留；定义删除后只读标签显示缺失 |
| `test:embedded-port-repair-e2e` | 不兼容修复预告、取消、确认与撤销通过；确认后 Connection 悬空，兼容文件修复后真实输出为 `1` |
| `test:multidocument-e2e` | 父文档步数 4、另一文档步数 1；另存为后内嵌定义保留，引擎恢复成功，关闭清理后标签数为 0 |

| 视觉命令 | 结果 |
| --- | --- |
| `test:canvas-selection` | 同一原生鼠标回归在旧代码上因无放置预览失败，修复后通过；Wire 选择与清除保留，总元件 4→5，新增 NOT 中心与点击目标在 1px 边框容差内 |
| `visual:probe` | 21/21 DOM 状态断言通过 |
| `visual:test` | 32 个状态 × 2 个主题 × 2 个视口，128 张截图采集完成 |

截图与清单位于 `apps/desktop/artifacts/visual-regression/`（Git 忽略目录）。本次抽查深色普通窗口的 `snapshot-isolated`、`long-name`，深色窄窗的 `snapshot-isolated` 和浅色普通窗口的 `internal-signals`。内嵌快照的画布、Port、检查器与长名称截断均有可见证据；720px 窄窗仍有工具栏文字换行，保留为已有布局限制。截图采集和抽查不构成逐像素自动回归。

## 交互性能

修复前，`pnpm --filter @circuit-platform/desktop performance:benchmark --mode=pan` 无法就绪。加入有界等待后，同一命令在原 v1 夹具上自动退出 1，报告：`项目文件校验失败：不支持项目文件 version 1；当前只支持 version 2。` 这条真实 Electron 命令同时作为修复后的回归入口。

修复后按默认 `5000ms` 采样、`1920×1080` 视口和软件渲染执行。验收阈值仍为 `p95FrameMs ≤ 20ms`，不使用 `--no-fail`，不放宽规模或预算。以下各项均为 `pass=true`，展平对象数为 500 Component / 1,000 Connection，交互证据、独立文档 runtime 数量与 `inactiveWork=0` 均通过断言。

| 模式 | 文档数 | P95 工作耗时（ms） | RAF P50（ms，仅诊断） | RAF P95（ms，仅诊断） |
| --- | ---: | ---: | ---: | ---: |
| pan | 1 | 0.1 | 4.8 | 6.5 |
| pan | 5 | 0.1 | 4.9 | 6.4 |
| pan | 10 | 0.2 | 5.5 | 8.0 |
| drag | 1 | 0.2 | 103.5 | 121.4 |
| drag | 5 | 0.2 | 112.5 | 129.5 |
| drag | 10 | 0.2 | 106.2 | 114.8 |
| internal-signals | 1 | 4.5 | 7.0 | 12.2 |
| internal-signals | 5 | 4.2 | 6.8 | 11.1 |
| internal-signals | 10 | 3.9 | 6.9 | 11.0 |
| place | 1 | 2.1 | 4.2 | 5.1 |
| wire | 1 | 9.3 | 5.6 | 15.4 |
| route | 1 | 0.2 | 110.2 | 119.8 |

放置预览的修复过程保留了真实失败证据：补齐初始 ghost 后 P95 为 `244.2ms`；去掉无必要的层次同步后仍为 `125.4ms`。进一步把指针预览留在视图层后，同一正式基准降至 `2.1ms`，采集 1201 帧、最大工作耗时 `6.9ms`，通过原 `20ms` 门槛。相关公开 API 回归先失败后通过，普通鼠标移动不发布新的 EditorSnapshot、不重新投影整幅画布，失败重试仍采用最新坐标。

内部信号的三个文档数量档位均记录 `hiddenReads=0`、`visibleReads=25`、`rapidSelectionReads=25`、`staleResultsDropped=8`、`continuousRunReads=73`。拖动模式的实际 RAF 间隔仍明显偏高，保留为已有性能诊断问题；本次通过工作耗时门槛不代表该问题已经解决。

复现命令：

```powershell
pnpm --filter @circuit-platform/desktop performance:benchmark --mode=pan --documents=1,5,10
pnpm --filter @circuit-platform/desktop performance:benchmark --mode=drag --documents=1,5,10
pnpm --filter @circuit-platform/desktop performance:benchmark --mode=internal-signals --documents=1,5,10
pnpm --filter @circuit-platform/desktop performance:benchmark --mode=place
pnpm --filter @circuit-platform/desktop performance:benchmark --mode=wire
pnpm --filter @circuit-platform/desktop performance:benchmark --mode=route
```

## 已知边界

- `visual:test` 只采集截图，PNG 哈希不作为自动回归基线；DOM 行为由独立探针断言，布局通过抽查截图确认。
- 性能测试固定软件渲染；`p95FrameMs` 衡量状态更新与 Vue 渲染工作，实际 RAF 间隔另行保留，不能据此声称所有交互达到稳定 60fps。
- 720px 窄窗工具栏仍有文字换行，后续布局完善时应单独处理；本次没有修改工具栏样式。
- v1 文件不支持打开、导入或自动迁移；父工程内定义只读，可编辑源 Project，或先导出当前定义后编辑，保存后显式重新导入。
- 不保存 SimulationState、波形、撤销历史或视口；本次收口不扩展这些约定。
