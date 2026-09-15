# 画布性能基准

性能基准独立于 `pnpm verify`，用于检查真实 Vue `CircuitCanvas` 在目标规模下的交互帧耗时。脚本启动 Vite 与 Electron，挂载真实组件，构造 1920×1080、500 个 Component 和 1,000 条 Wire 的 CanvasScene，并通过 DOM PointerEvent 连续驱动 5 秒；采样包含事件分发、组件更新和 requestAnimationFrame 回调。`pan` 覆盖连续平移，`drag` 覆盖 Component 拖动期间的几何预览。

在仓库根目录执行：

```powershell
pnpm --filter @circuit-platform/desktop performance:benchmark --mode=pan
pnpm --filter @circuit-platform/desktop performance:benchmark --mode=drag
```

输出 JSON 中的 `p95FrameMs` 必须不超过 `20`。基准失败时命令返回非零状态；本地排查可加 `--no-fail` 只输出数据。Node 需要支持现有测试使用的 `--experimental-strip-types` 参数。

2026-09-15 在本工作区执行结果（Windows，Node 24）：

| 交互 | 帧数 | P95 | 最大帧耗时 | 结果 |
| --- | ---: | ---: | ---: | --- |
| 连续视口平移 | 169 | 0.2ms | 0.4ms | 通过 |
| 连续 Component 拖动预览 | 160 | 0.2ms | 0.3ms | 通过 |

实现约束：Component 拖动、Route 拖动、平移和 ConnectionDraft 的 pointer move 均由 RAF 合并；拖动预览只更新 `InteractionState`，释放时才提交一次布局/Route 命令。`createCanvasSceneProjector` 按 EditorSnapshot 和交互预览缓存几何结构，因此 SimulationSnapshot 更新不会重新生成 Route。基准 runner 使用 `disable-gpu`、`no-sandbox` 和可见窗口关闭隐藏页 RAF 节流，适配 Windows CI；这只改变合成环境，不绕过 DOM 或交互路径。超过目标规模时应只关闭光晕、动画或次级网格，不得删除标签、键盘焦点或操作能力。
