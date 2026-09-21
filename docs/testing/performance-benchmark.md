# 画布性能基准

性能基准独立于 `pnpm verify`，用于检查真实 Vue `CircuitCanvas` 在目标规模下的交互帧耗时。脚本启动 Vite 与 Electron，挂载真实组件，先读取三层 Project 夹具并调用生产 `flattenProjectHierarchy`，再把得到的 500 个 Component / 1,000 条 Connection flat Circuit 投影到画布，并通过 DOM PointerEvent 连续驱动交互。

## 测量口径

场景走生产层次解析和 `useEditorState` 使用的同一条画布路径：`ProjectFileData` → `flattenProjectHierarchy` → `EditorSnapshot` + 交互预览 → `createCanvasSceneProjector` → `CircuitCanvas`。夹具的解析诊断、flat 计数和端点映射都在页面启动时断言；交互状态由真实 DOM 事件产生，基准不直接改写场景几何。

每个动画帧只推进一步交互，并把该帧「状态更新 → Vue 完成渲染」的耗时记为一个样本。样本因此覆盖投影器的几何重算与 DOM patch，而不只是事件处理器本身；拖动、布线与 Route 编辑的指针位移由各自的 RAF 合并器折叠到一帧内，与真实交互一致。

`p95FrameMs` 是主线程工作耗时的下界：浏览器自身的样式、布局、合成与动画开销不在其中，实际帧间隔只会更长。`frameP50Ms` / `frameP95Ms` 记录相邻 `requestAnimationFrame` 回调的真实间隔，把上述开销一并计入，用于诊断「P95 达标但手感仍卡」的情形。

## 运行

在仓库根目录执行：

```powershell
pnpm --filter @circuit-platform/desktop performance:benchmark --mode=pan
pnpm --filter @circuit-platform/desktop performance:benchmark --mode=drag
pnpm --filter @circuit-platform/desktop performance:benchmark --mode=place
pnpm --filter @circuit-platform/desktop performance:benchmark --mode=wire
pnpm --filter @circuit-platform/desktop performance:benchmark --mode=route
```

| 模式 | 交互 |
| --- | --- |
| `pan` | 按住中键连续平移视口 |
| `drag` | 拖动一个 Component，包含拖动期间的几何预览 |
| `place` | 待放置 ghost 跟随指针 |
| `wire` | 从输出 Port 起笔的 ConnectionDraft 布线 |
| `route` | 拖动已选中 Wire 的 Route 折点 |

输出 JSON 中的 `p95FrameMs` 必须不超过 `20`，且 `interacted` 必须为 `true`。`frameP50Ms` / `frameP95Ms` 是诊断字段，**不参与 `pass` 判定**：基准固定使用软件渲染（`disable-gpu`），绝对帧间隔不可跨环境比较。`interacted` 由基准自检得出：每种模式都要求可观察的交互证据（视口移动、预览出现、草稿点数、折点预览），只测到空转的基准会直接失败，而不是给出漂亮的数字。基准失败时命令返回非零状态；本地排查可加 `--no-fail` 只输出数据。

`--components=` 与 `--wires=` 可改变期望规模；层次夹具当前固定为 500 / 1,000，传入其他数值会让基准失败，避免把不同规模误标为验收结果。`--width=` 改变画布投影里的端口位宽，默认为 1（既有基线口径），`--width=8` 用来量多位电路的成本。输出中的 `hierarchyFixture`、`flattenedComponents`、`flattenedWires` 是真实层次路径的断言字段；`portWidth`、`domElements` 与 `smilAnimations` 用于成本定位。

## 层次夹具

`src/project-file/performance-fixture.ts` 生成根 → wrapper → core 三层 Project。core 内有 498 个普通 Component 和 998 条内部 Connection，根层的两条跨层边界连接经生产递归展平后得到精确的 500 / 1,000 规模。`benchmark.html` 先用生产 `HierarchyProjectReader` 做零诊断展平，再通过 `useDocumentWorkspace` 为每个文档创建独立 runtime/controller；交互文档打开同一份生产展平结果，内部信号场景保留层次 Project。`tests/performance.test.ts` 会断言运行时 adapter 数量、文档键、真实 `getSignal` 计数和 scheduler/refresh/frame 计数来源。

## Phase 5.6 文档数与内部信号矩阵

Phase 5.6 使用同一份生产 500 Component / 1,000 Connection 展平夹具，为每个文档创建
独立的 runtime/controller；只有活动文档接收 pointer 交互。`--documents=1,5,10` 表示
同时打开的文档数量，不是把 5 或 10 份电路拼成一个更大的画布。每个单元至少记录：

- `p95FrameMs`：活动画布的主线程工作耗时，必须 `<= 20ms`；
- `interacted`、`flattenedComponents=500`、`flattenedWires=1000`：确认测到的是目标
  场景而不是空转或错误夹具；
- `frameP50Ms` / `frameP95Ms`：真实 RAF 间隔，仅作诊断；
- `inactiveWork`：非活动文档的 scheduler/refresh/frame 工作量，不得随文档数成比例增加；
- 内部信号模式的 `reads`、`staleResultsDropped` 和 `frameSamples`。

| 场景 | 文档数 | 模式 | 通过条件 | 证据 |
| --- | ---: | --- | --- | --- |
| 活动画布平移 | 1 / 5 / 10 | `pan` | 每个 N 的活动 P95 ≤ 20ms、`interacted=true` | 通过：P95 `0.2 / 0.2 / 0.2ms`，`inactiveWork=0` |
| 活动画布拖动 | 1 / 5 / 10 | `drag` | 每个 N 的活动 P95 ≤ 20ms、`interacted=true` | 通过：P95 `0.2 / 0.2 / 0.2ms`，`inactiveWork=0` |
| 内部表隐藏 | 1 / 5 / 10 | `internal-signals-hidden` | `reads=0`，画布帧样本不因 N 增长而阻塞 | 通过：每档 `hiddenReads=0`、P95 `0.1ms` |
| 内部表显示 | 1 / 5 / 10 | `internal-signals-visible` | 只读选中 occurrence，读取不阻塞画布帧 | 通过：每档 `visibleReads=25`、P95 `3.4–3.5ms` |
| 快速切换 occurrence | 1 / 5 / 10 | `internal-signals-rapid` | 迟到 revision 结果丢弃，不发布到新选择 | 通过：每档 `rapidSelectionReads=25`、`staleResultsDropped=8` |
| 连续运行 | 1 / 5 / 10 | `internal-signals-running` | tick 只由活动文档推进，表刷新不引入逐帧读取 | 通过：每档 `continuousRunReads=73`、`inactiveWork=0` |

2026-09-21 已在同一 Windows 集成工作区运行以下矩阵；上表记录的是命令 JSON 输出，
不是由既有单文档结果外推：

```powershell
pnpm --filter @circuit-platform/desktop performance:benchmark --mode=pan --documents=1,5,10
pnpm --filter @circuit-platform/desktop performance:benchmark --mode=drag --documents=1,5,10
pnpm --filter @circuit-platform/desktop performance:benchmark --mode=internal-signals --documents=1,5,10
```

如果 runner 将内部信号拆成多个 mode，应保持上表四个语义（hidden、visible、rapid、
running）并在 JSON 中输出同名或等价字段。隐藏面板的零读取与 revision 丢弃属于通过条件，
不是仅供解释的日志。

## 端口清单的来源（Phase 4.5 的一次修复）

基准页不启动引擎，但它读取真实层次 Project 夹具并在递归展平后绘制 flat Circuit；端口清单因此仍需要一个本地引擎替身来源。

Phase 4.5 里 `ComponentDefinition` 去掉了 `ports`（端口清单改由引擎回传，展示定义只保留元数据，`963e77d`），但那次改动漏了 `benchmark.html`——它仍在读 `definition.ports`。后果不是「跑得慢」，而是**五种模式全部挂死**：`undefined.find(...)` 抛 TypeError 让模块脚本在构造连线时中断，`window.__benchmarkReady` 永不置上，`performance-benchmark-runner.cjs` 一直等下去，命令既不报错也不打印。本基准不在 `pnpm verify` 里，所以合并时没有任何一步会碰它。

修法遵循 ADR 0020：基准页**不新增端口定义**，而是复用它自己的引擎替身——`tests/fake-ports.ts` 的 `BUILT_IN_PORTS`。那一份与 `visual-regression.html` 的 `visualPorts` 同类，都是「扮演引擎的夹具必须有的内置定义」，不是前端源码里的第二份副本。本页不进入生产构建（`vite build` 只出 `index.html`），引入测试夹不会把 `tests/` 带进产品。

连线端点也不再由基准页自己拼几何，而是走投影器自己的 `componentGeometryFor` + `portLayoutFor`——端口画在哪由它们决定，基准若自己算一套，端点迟早与端口错位。**修复后 DOM 元素数与修复前的基线逐项相同**（下表），说明这套几何重建是忠实的。

## 多位电路的成本（`--width=`）

端口位宽默认 1，既有基线因此逐像素不变。`--width=8` 把展平后的画布端口投影成 8 位总线，用来回答「多位电路的帧耗时是否仍满足 Phase 3 的预算」：位区间标注（`out[7:0]`）与二进制信号文本（`1010`）比 1 位端口更长，这是唯一随位宽变化的渲染成本——线路外观不随位宽改变（ADR 0013）。

```powershell
pnpm --filter @circuit-platform/desktop performance:benchmark --mode=wire --width=8
```

结果见下表「8 位」一栏：五种模式 P95 全部 ≤ 5.9ms，远在 20ms 预算内；DOM 元素数与 1 位完全相同（位宽只改文本内容，不改元素数量）。

## 当前结果

历史平面基线（2026-09-18，Windows，Node 24，500 Component / 1,000 Wire，5 秒；用于与此前 Phase 4 结果对照）：

| 交互 | P95 | 帧间隔 P50 | 帧间隔 P95 | DOM 元素 | SMIL 动画 | 结果 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 连续视口平移 | 0.2ms | 7.6ms | 10.9ms | 9,026 | 0 | 达标 |
| Component 拖动预览 | 0.2ms | 63.6ms | 88.3ms | 9,026 | 0 | 达标 |
| 放置 ghost 跟随 | 2.5ms | 4.1ms | 5.3ms | 9,031 | 0 | 达标 |
| ConnectionDraft 布线 | 1.8ms | 5.0ms | 11.5ms | 9,027 | 0 | 达标 |
| Route 折点拖动 | 0.2ms | 55.8ms | 78.7ms | 9,032 | 0 | 达标 |

五种模式的 P95 全部满足 20ms 预算，`interacted` 全部为 `true`。这是 Phase 4 完整落地之后的复测（issue #24）：本阶段改了工具栏、新增了运行控制按钮、改了工作区绑定，但基准直接挂 `CircuitCanvas`、不经过 Workspace，实测 P95 与 DOM 元素数都没有变化。帧间隔 P50/P95 是诊断字段，含义与局限见下。

### Phase 4.5 复测（2026-09-18，issue #32）

同一台机器、同一命令、500 Component / 1,000 Wire。先修好上一节的端口清单来源问题，再重跑：

| 交互 | P95 | 帧间隔 P50 | 帧间隔 P95 | DOM 元素 | SMIL 动画 | 结果 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 连续视口平移 | 0.2ms | 5.6ms | 7.8ms | 9,026 | 0 | 达标 |
| Component 拖动预览 | 0.2ms | 68.9ms | 86.2ms | 9,026 | 0 | 达标 |
| 放置 ghost 跟随 | 2.5ms | 4.2ms | 5.3ms | 9,031 | 0 | 达标 |
| ConnectionDraft 布线 | 1.1ms | 4.7ms | 8.7ms | 9,027 | 0 | 达标 |
| Route 折点拖动 | 0.2ms | 60.2ms | 97.4ms | 9,032 | 0 | 达标 |

P95 逐项与上一次持平或更低（布线 1.8 → 1.1ms），**DOM 元素数五项全部逐项相同**——这是端口几何重建忠实的一处旁证。帧间隔 P50 的 60.2 / 68.9ms 落在既有记录的 60–71ms 区间内，与记录一致。

多位电路（`--width=8`，每个端口都是 8 位总线）：

| 交互 | P95 | 帧间隔 P50 | 帧间隔 P95 | DOM 元素 | 结果 |
| --- | ---: | ---: | ---: | ---: | --- |
| 连续视口平移 | 0.2ms | 6.1ms | 8.4ms | 9,026 | 达标 |
| Component 拖动预览 | 0.2ms | 67.7ms | 92.1ms | 9,026 | 达标 |
| 放置 ghost 跟随 | 2.2ms | 4.2ms | 5.2ms | 9,031 | 达标 |
| ConnectionDraft 布线 | 5.9ms | 4.7ms | 8.8ms | 9,027 | 达标 |
| Route 折点拖动 | 0.2ms | 68.1ms | 91.1ms | 9,032 | 达标 |

五种模式 P95 全部 ≤ 5.9ms，落在 Phase 3 的 20ms 预算内。位宽带来的唯一变化在布线与放置这两个「渲染落在采样窗口内」的模式上（布线 1.1 → 5.9ms），来源是更长的位区间标注与二进制信号文本；平移、拖动、Route 的渲染本就不在采样窗口内，因此读数不变。DOM 元素数与 1 位完全相同——位宽只改文本内容，不改元素数量。

### 采样口径的一个已知不对称

`p95FrameMs` 覆盖「派发事件 → Vue 完成渲染」，但**只有当渲染落在 `nextTick` 之前时才被计入**。平移、Component 拖动和 Route 拖动的状态更新经各自的 RAF 合并器折叠到下一帧，Vue 的渲染发生在合并器的 rAF 回调里、采样窗口之外；放置 ghost 与 ConnectionDraft 的部分状态是同步更新的，渲染因此落在窗口内。

后果：**只有放置与布线两个模式的 P95 真正包含整树重渲染成本**，平移、拖动和 Route 的 0.2–0.4ms 实际只覆盖事件处理与 CSS 变换，不代表这两种交互的完整帧成本。这正是本次加入帧间隔诊断字段的原因——它包含浏览器样式、布局、合成与动画采样，不受这个不对称影响。

### 已修复的两个根因

**一、指针热路径上的强制同步重排。** `pointerInCanvas()` 每次 pointer move 都调用 `getBoundingClientRect()`，强制 Blink 立即完成一次全量布局。CPU profile 显示它在采样中占 30.7%，而 Vue 的 `patchElement` 只占 2.9%。改为按手势缓存画布矩形后，平移 P95 从 58.1ms 降到 1.0ms。

**二、SMIL 动画 textPath 的 `startOffset`。** 每条 Wire 曾渲染三段沿路径流动的信号文字，靠 SMIL 动画 `startOffset` 实现。`startOffset` 是排版属性，每帧都会让 1,000 段文本沿路径重新排版，并把布局树持续弄脏——任何一次强制重排都要为此付出代价。这就是为什么基线成本并不随元素数线性增长：

| 实验（同一轮运行内对照，各 3 秒） | P95 | 帧间隔 P50 |
| --- | ---: | ---: |
| 原样 | 58.1ms | 117.2ms |
| 只缓存画布矩形 | 1.0ms | 107.7ms |
| 只移除 3,000 个 `<animate>` | 0.4ms | 40.8ms |
| 两者都做 | 0.2ms | 40.7ms |

只摘掉 3,000 个 `<animate>`、保留另外 6,000 个流动文字元素，P95 就从 45.8ms 掉到 0.5ms；再移除那 6,000 个元素没有任何进一步变化。**成本由排版动画而非元素数量决定。**

此前文档把根因记为 `isDenseCanvasScene` 阈值「恰好不触发稠密判定」。那个结论是错的：501 Component 之所以快，是因为稠密模式关掉了动画层，间接消除了布局失效，阈值只是碰巧相关。改阈值不是正确的修复方向。

### 动画层的替换

信号流动不再是「沿 Route 移动的 SMIL 文字」，改为：**信号值由始终可见的静态等宽文字表达，流向由叠加的 CSS 虚线动画（`stroke-dashoffset`）表达**。虚线只触发重绘、不触发文本排版。这是 [ADR 0013](../decisions/0013-wire-appearance-and-signal-flow.md) 的修订内容。

替换后 DOM 元素从 17,026 降到 9,026，SMIL 动画从 3,000 降到 0；放置与布线的 P95 分别从 47.9ms / 30.3ms 降到 3.1ms / 7.1ms。

### 整树重渲染的收敛

仅去掉动画还不够：放置与布线的剩余成本全在 Vue 的整树重渲染上（25.9ms / 16.3ms）。画布为每个 Wire 与 Component 加了 `v-memo`，并把这些节点重复计算的 `isDenseCanvasScene(scene)` 提为 `denseScene` 计算属性；Wire 自身、焦点与稠密标记都未变时，Vue 跳过 vnode 重建与 DOM patch。渲染成本降到 2.8ms / 8.0ms。

`v-memo` 只在对象身份稳定时才能命中，而投影器此前每次都会重建全部节点与连线。`createCanvasSceneProjector` 因此增加了一次复用：逐字段比较内容，内容相同的节点与连线直接返回上一次的对象；整个场景都未变时连容器本身也复用。拖动一个 Component 时只有它与相连的少量 Wire 变化，其余保持不变。

效果实测：拖动期间 DOM 写入从每帧约 11,000 次降到 **12 次**（只剩被拖元件相连的几条 Wire 的 `d`），Route 拖动的帧间隔 P50 从 77ms 降到 60ms。

### 遗留：拖动与 Route 的帧间隔下限

Component 拖动与 Route 拖动的帧间隔 P50 仍是 ~60–71ms，而平移、放置、布线只有 4–9ms。这一项经过了下列排除，均**不是**原因：

- **不是 DOM patch**：拖动时每帧只有 12 次属性写入；
- **不是流动虚线或信号文字**：移除这两层元素后帧间隔只从 63.8ms 变到 55.2ms；
- **不是模糊阴影**：关闭全部 `box-shadow` 与网格暗角后从 77ms 变到 71ms；
- **不是软件渲染**：加不加 `--disable-gpu` 分别是 75.4ms 与 70.7ms；
- **不是事件处理或投影本身**：事件处理耗时 0.2ms，整帧 JS 约 10.6ms（CPU profile）。

关键实验是让指针原地不动：此时场景完全不变化、DOM 写入为零，帧间隔仍有 **58.4ms**。也就是说这个下限既不属于渲染，也不属于投影的重建与复用，而是「每帧调用一次投影 + 触发一次 Vue 重渲染」这一循环本身的成本。它随总元素数近似线性缩放（50/100 → 7.7ms，200/400 → 27.7ms，500/1,000 → 74.5ms）。

在归因清楚之前不建议继续优化这一项：验收口径的 P95 已大幅达标，且这两个模式的渲染本就不在采样窗口内。若要继续排查，下一步应当先用 Chromium trace（而非 JS profile）确认这 58ms 落在哪个阶段。

## Phase 5.5 层次规模验收

Phase 5.5 的性能规模按**展平后的引擎对象**计算。固定验收口径仍是 `flattenedComponents=500`、`flattenedWires=1000`，视口为 `1920×1080`；真实交互的 `p95FrameMs` 必须不超过 `20ms`，并且 `interacted` 必须为 `true`。当前 Canvas 直接渲染这份递归展平结果，因此 `components` / `wires` 与 `flattenedComponents` / `flattenedWires` 必须同时为 500 / 1,000，并由 runner 一起断言，不能用顶层外壳数代替展平规模。

当前基准默认运行三层真实 Project 夹具；其余四种模式只需替换 `--mode`。参数代表本次层次展平后必须得到的规模，传入非 `500` / `1000` 会直接失败：

```powershell
pnpm --filter @circuit-platform/desktop performance:benchmark --mode=pan --components=500 --wires=1000
# --mode 依次替换为 drag、place、wire、route
```

`benchmark.html` 会在挂载 Canvas 前断言 `hierarchyFixture=true`、零层次诊断和精确的 `flattenedComponents=500` / `flattenedWires=1000`；runner 还把这三个条件纳入 `pass`。因此性能结果来自「Project 读取 → 生产递归展平 → Canvas 投影 → 真实 DOM PointerEvent」的完整画布路径。真实引擎完整推送结果见本文“文档推送时延（Phase 5 #42）”，命令为：

```powershell
pnpm --filter @circuit-platform/desktop test:temporal-e2e
```

2026-09-20 在 Windows 10.0.29671.1000、Node.js 24.19.0、Electron 38.8.6 上，`temporal-e2e.test.ts` 使用真实三层 Project 文件，经递归展平后逐次核对引擎收到的对象数确为 `500 Component / 1,000 Connection`。用同一命令独立复测两轮：第一轮三次“读取父子文件 → 展平 → 完整推送 → 首次稳定求值”耗时为 `2728 / 2819 / 2721 ms`，均值 `2756 ms`；最终标准复审轮为 `3413 / 3094 / 3059 ms`，均值 `3189 ms`。两轮所有样本都满足 `≤ 6000 ms` 预算；两组数据同时保留以呈现共享开发环境中的波动。复现命令：

```powershell
pnpm --filter @circuit-platform/desktop test:temporal-e2e
```

画布五种交互由正式 `benchmark.html` 验收；它渲染递归展平后的 500 个 flat Component 和 1,000 条 flat Connection，并同时携带 `hierarchyFixture=true`。五种模式的本轮实测结果见下表，只有全部 `interacted=true`、`hierarchyFixture=true` 且 `p95FrameMs≤20` 时才算通过。

| 模式 | Canvas Component | Canvas Connection | 展平 Component | 展平 Connection | P95 | hierarchyFixture | interacted |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| pan | 500 | 1000 | 500 | 1000 | 0.2 ms | true | true |
| drag | 500 | 1000 | 500 | 1000 | 0.3 ms | true | true |
| place | 500 | 1000 | 500 | 1000 | 1.9 ms | true | true |
| wire | 500 | 1000 | 500 | 1000 | 0.3 ms | true | true |
| route | 500 | 1000 | 500 | 1000 | 0.2 ms | true | true |

## 文档推送时延（Phase 5 #42）

打开项目与引擎重启重建共用的整份推送路径有明确预算：500 元件 / 1,000 连线的完整推送（含加载后的首次稳定求值）均值 ≤ 6 秒，由时序端到端回归在真实引擎上断言（`temporal-e2e.test.ts` 的推送预算用例，3 次实测取均值）。预算出处是规格 #34，原始定价 3 秒；落地实测后按规格「时延不达标时首先复核口径」的预案重新定价为 6 秒，依据如下（2026-09-19，真实 `circuit-engine` 二进制，开发机）：

- **形状约束**：恰好凑出 500 元件 / 1,000 连线必须用 8 输入合线器做连接目标（其余内置元件扇入最多 2，凑不满 1,000 条线），因此文档是 125 级「拆线 → 合线」链加一排 NOT 门；
- **每条连线的引擎侧成本随端口形状变化**：普通门扇入约 1.6–2.2 ms/条（同日冷机与热机两次实测），位区间分支端口上约 3.2 ms/条——连接校验要按位区间对齐位宽；
- **同口径实测**：500 元件 / 1,000 连线完整推送在两种机器状态下各测三次——重载状态下 3,898 / 3,676 / 3,877 ms（均值 3,817 ms，其中元件约 0.4 秒、连线约 3.2 秒、首次求值约 35 ms），空闲状态下 2,937 / 2,878 / 2,858 ms（均值 2,891 ms）。两次都真实出现，这正是预算需要余量的原因：原定价 3 秒会在重载状态下随机失败；
- **预算含义**：6 秒覆盖实测均值加约六成余量（机器状态自身有 ±40% 波动），仍能在出现 2 倍级退化（→12 秒）时失败。

推送提速的方向在规格里已定：瓶颈在引擎逐条连接的处理，不在往返（流水线并发发送几乎无改善），批量请求属于引擎与协议改动，不在 Phase 5。

## 实现约束

Component 拖动、Route 拖动、平移和 ConnectionDraft 的 pointer move 均由 RAF 合并；拖动预览只更新 `InteractionState`，释放时才提交一次布局/Route 命令。`createCanvasSceneProjector` 按 EditorSnapshot 和交互预览缓存几何结构，因此 SimulationSnapshot 更新不会重新生成 Route。基准 runner 使用 `disable-gpu`、`no-sandbox` 和可见窗口关闭隐藏页 RAF 节流，适配 Windows CI；这只改变合成环境，不绕过 DOM 或交互路径。

指针坐标换算按手势缓存画布矩形（`CircuitCanvas` 的 `canvasRectNow`），只在布局变化与每次 `pointerdown` 时失效。改动这条路径时必须保留缓存：逐帧调用 `getBoundingClientRect()` 会强制 Blink 同步重排，在目标规模下即是一次约 5ms 的全量布局。

信号层不得使用动画文本排版属性（`textPath` 的 `startOffset` 等）。信号值由静态文字表达，流向由 `stroke-dashoffset` 这类只触发重绘的 CSS 动画表达。

超出目标规模时应只关闭光晕、动画或次级网格，不得删除标签、键盘焦点或操作能力。

基准通过 DOM 合成事件驱动，`setPointerCapture` 对没有活动指针的合成事件会抛错；`CircuitCanvas` 的 `capturePointer` 保证捕获失败不中断交互，交互继续依赖冒泡的 pointermove。
