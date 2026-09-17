# 画布性能基准

性能基准独立于 `pnpm verify`，用于检查真实 Vue `CircuitCanvas` 在目标规模下的交互帧耗时。脚本启动 Vite 与 Electron，挂载真实组件，构造 1920×1080、500 个 Component 和 1,000 条 Wire 的文档，并通过 DOM PointerEvent 连续驱动交互。

## 测量口径

场景走 `useEditorState` 的同一条路径：`EditorSnapshot` + 交互预览 → `createCanvasSceneProjector` → `CircuitCanvas`。交互状态由真实 DOM 事件产生，基准不直接改写场景几何。

每个动画帧只推进一步交互，并把该帧「状态更新 → Vue 完成渲染」的耗时记为一个样本。样本因此覆盖投影器的几何重算与 DOM patch，而不只是事件处理器本身；拖动、布线与 Route 编辑的指针位移由各自的 RAF 合并器折叠到一帧内，与真实交互一致。

`p95FrameMs` 是主线程工作耗时的下界：浏览器自身的样式、布局、合成与 SMIL 动画开销不在其中，实际帧间隔只会更长。

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

输出 JSON 中的 `p95FrameMs` 必须不超过 `20`，且 `interacted` 必须为 `true`。`interacted` 由基准自检得出：每种模式都要求可观察的交互证据（视口移动、预览出现、草稿点数、折点预览），只测到空转的基准会直接失败，而不是给出漂亮的数字。基准失败时命令返回非零状态；本地排查可加 `--no-fail` 只输出数据。

`--components=` 与 `--wires=` 可改变规模，只用于定位成本随规模的变化，验收口径固定为 500 / 1,000。输出中的 `domElements` 与 `smilAnimations` 用于成本定位。

## 当前结果

2026-09-17 在本工作区执行（Windows，Node 24，500 Component / 1,000 Wire，5 秒）：

| 交互 | 帧数 | P95 | 最大帧耗时 | DOM 元素 | SMIL 动画 | 结果 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 连续视口平移 | 31 | 68.1ms | 68.8ms | 17,026 | 3,000 | **未达标** |
| Component 拖动预览 | 21 | 70.8ms | 78.9ms | 17,026 | 3,000 | **未达标** |
| 放置 ghost 跟随 | 44 | 93.9ms | 102.3ms | 17,031 | 3,000 | **未达标** |
| ConnectionDraft 布线 | 42 | 59.9ms | 94.5ms | 17,027 | 3,000 | **未达标** |
| Route 折点拖动 | 13 | 92.2ms | 92.2ms | 17,032 | 3,000 | **未达标** |

**目标规模下交互帧耗时未达到 20ms 预算，五种模式全部不达标。**

### 原因

成本几乎全部来自每条 Wire 各自的信号层。`isDenseCanvasScene` 的判定是 `nodes > 500 || wires > 1000`，而验收规模恰好是 500 / 1,000，因此判定为非稠密，每条 Wire 都会渲染三段流动文字加一份静态标签，合计 9,000 个额外 DOM 元素和 3,000 个 SMIL 动画。

对照实验：把规模改成 501 Component / 1,000 Wire（只多一个元件，判定翻转为稠密、信号层关闭），同一模式下 P95 从 47ms 降到 **0.7ms**。

| 规模 | 稠密判定 | DOM 元素 | SMIL 动画 | P95（平移） |
| --- | --- | ---: | ---: | ---: |
| 500 / 1,000 | 否 | 17,026 | 3,000 | 47.0ms |
| 501 / 1,000 | 是 | 8,031 | 0 | 0.7ms |

此前的基准只采样 `requestAnimationFrame` 回调，而 Vue 的调度器在微任务里刷新，投影与 DOM patch 都不在采样的回调内；当时的场景还是静态对象、从不重新投影。因此历史记录中的 0.2–0.9ms 并未覆盖真实的渲染成本，这条验收标准此前没有被真正验证过。

### 待决

`isDenseCanvasScene` 的阈值改了就能达标，但那是可见行为的变化，且现行策略见下：动画只应在**超过**目标规模时关闭，而 500 / 1,000 正是目标规模本身，按要求应当带着动画满足预算。因此这是一个待决策的性能问题，不是阈值笔误。

## 实现约束

Component 拖动、Route 拖动、平移和 ConnectionDraft 的 pointer move 均由 RAF 合并；拖动预览只更新 `InteractionState`，释放时才提交一次布局/Route 命令。`createCanvasSceneProjector` 按 EditorSnapshot 和交互预览缓存几何结构，因此 SimulationSnapshot 更新不会重新生成 Route。基准 runner 使用 `disable-gpu`、`no-sandbox` 和可见窗口关闭隐藏页 RAF 节流，适配 Windows CI；这只改变合成环境，不绕过 DOM 或交互路径。

超出目标规模时应只关闭光晕、动画或次级网格，不得删除标签、键盘焦点或操作能力。

基准通过 DOM 合成事件驱动，`setPointerCapture` 对没有活动指针的合成事件会抛错；`CircuitCanvas` 的 `capturePointer` 保证捕获失败不中断交互，交互继续依赖冒泡的 pointermove。
