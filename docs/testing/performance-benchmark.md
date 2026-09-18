# 画布性能基准

性能基准独立于 `pnpm verify`，用于检查真实 Vue `CircuitCanvas` 在目标规模下的交互帧耗时。脚本启动 Vite 与 Electron，挂载真实组件，构造 1920×1080、500 个 Component 和 1,000 条 Wire 的文档，并通过 DOM PointerEvent 连续驱动交互。

## 测量口径

场景走 `useEditorState` 的同一条路径：`EditorSnapshot` + 交互预览 → `createCanvasSceneProjector` → `CircuitCanvas`。交互状态由真实 DOM 事件产生，基准不直接改写场景几何。

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

`--components=` 与 `--wires=` 可改变规模，只用于定位成本随规模的变化，验收口径固定为 500 / 1,000。`--width=` 改变合成文档里端口的位置数，默认为 1（既有基线口径），`--width=8` 用来量多位电路的成本。输出中的 `portWidth` 回报本次用的位宽，`domElements` 与 `smilAnimations` 用于成本定位。

## 端口清单的来源（Phase 4.5 的一次修复）

基准页要自己造 500 元件 / 1000 连线的合成文档，而它**不连引擎**，端口清单因此必须有个本地来源。

Phase 4.5 里 `ComponentDefinition` 去掉了 `ports`（端口清单改由引擎回传，展示定义只保留元数据，`963e77d`），但那次改动漏了 `benchmark.html`——它仍在读 `definition.ports`。后果不是「跑得慢」，而是**五种模式全部挂死**：`undefined.find(...)` 抛 TypeError 让模块脚本在构造连线时中断，`window.__benchmarkReady` 永不置上，`performance-benchmark-runner.cjs` 一直等下去，命令既不报错也不打印。本基准不在 `pnpm verify` 里，所以合并时没有任何一步会碰它。

修法遵循 ADR 0020：基准页**不新增端口定义**，而是复用它自己的引擎替身——`tests/fake-ports.ts` 的 `BUILT_IN_PORTS`。那一份与 `visual-regression.html` 的 `visualPorts` 同类，都是「扮演引擎的夹具必须有的内置定义」，不是前端源码里的第二份副本。本页不进入生产构建（`vite build` 只出 `index.html`），引入测试夹不会把 `tests/` 带进产品。

连线端点也不再由基准页自己拼几何，而是走投影器自己的 `componentGeometryFor` + `portLayoutFor`——端口画在哪由它们决定，基准若自己算一套，端点迟早与端口错位。**修复后 DOM 元素数与修复前的基线逐项相同**（下表），说明这套几何重建是忠实的。

## 多位电路的成本（`--width=`）

端口位宽默认 1，既有基线因此逐像素不变。`--width=8` 把合成文档里每个端口都变成 8 位总线，用来回答「多位电路的帧耗时是否仍满足 Phase 3 的预算」：位区间标注（`out[7:0]`）与二进制信号文本（`1010`）比 1 位端口更长，这是唯一随位宽变化的渲染成本——线路外观不随位宽改变（ADR 0013）。

```powershell
pnpm --filter @circuit-platform/desktop performance:benchmark --mode=wire --width=8
```

结果见下表「8 位」一栏：五种模式 P95 全部 ≤ 5.9ms，远在 20ms 预算内；DOM 元素数与 1 位完全相同（位宽只改文本内容，不改元素数量）。

## 当前结果

2026-09-18 在本工作区执行（Windows，Node 24，500 Component / 1,000 Wire，5 秒）：

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

## 实现约束

Component 拖动、Route 拖动、平移和 ConnectionDraft 的 pointer move 均由 RAF 合并；拖动预览只更新 `InteractionState`，释放时才提交一次布局/Route 命令。`createCanvasSceneProjector` 按 EditorSnapshot 和交互预览缓存几何结构，因此 SimulationSnapshot 更新不会重新生成 Route。基准 runner 使用 `disable-gpu`、`no-sandbox` 和可见窗口关闭隐藏页 RAF 节流，适配 Windows CI；这只改变合成环境，不绕过 DOM 或交互路径。

指针坐标换算按手势缓存画布矩形（`CircuitCanvas` 的 `canvasRectNow`），只在布局变化与每次 `pointerdown` 时失效。改动这条路径时必须保留缓存：逐帧调用 `getBoundingClientRect()` 会强制 Blink 同步重排，在目标规模下即是一次约 5ms 的全量布局。

信号层不得使用动画文本排版属性（`textPath` 的 `startOffset` 等）。信号值由静态文字表达，流向由 `stroke-dashoffset` 这类只触发重绘的 CSS 动画表达。

超出目标规模时应只关闭光晕、动画或次级网格，不得删除标签、键盘焦点或操作能力。

基准通过 DOM 合成事件驱动，`setPointerCapture` 对没有活动指针的合成事件会抛错；`CircuitCanvas` 的 `capturePointer` 保证捕获失败不中断交互，交互继续依赖冒泡的 pointermove。
