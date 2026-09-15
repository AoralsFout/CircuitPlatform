# 画布性能基准

性能基准独立于 `pnpm verify`，用于检查通用画布在目标规模下的交互帧耗时。脚本构造 1920×1080、500 个 Component 和 1,000 条 Wire 的 EditorSnapshot，在接近 60Hz 的连续交互中运行 5 秒，统计场景投影每帧耗时；`pan` 覆盖连续平移与信号更新，`drag` 覆盖节点拖动期间的几何预览。

在仓库根目录执行：

```powershell
pnpm --filter @circuit-platform/desktop performance:benchmark --mode=pan
pnpm --filter @circuit-platform/desktop performance:benchmark --mode=drag
```

输出 JSON 中的 `p95FrameMs` 必须不超过 `20`。基准失败时命令返回非零状态；本地排查可加 `--no-fail` 只输出数据。Node 需要支持现有测试使用的 `--experimental-strip-types` 参数。

2026-09-15 在本工作区执行结果（Windows，Node 24）：

| 交互 | 帧数 | P95 | 最大帧耗时 | 结果 |
| --- | ---: | ---: | ---: | --- |
| 平移 + 信号更新 | 300 | 1.115ms | 22.136ms | 通过（P95 门槛） |
| 节点拖动预览 | 300 | 4.453ms | 9.514ms | 通过 |

实现约束：节点拖动、Route 拖动、平移和 ConnectionDraft 的 pointer move 均由 RAF 合并；拖动预览只更新 `InteractionState`，释放时才提交一次布局/Route 命令。`createCanvasSceneProjector` 按 EditorSnapshot 和交互预览缓存几何结构，因此 SimulationSnapshot 更新不会重新生成 Route。超过目标规模时应只关闭光晕、动画或次级网格，不得删除标签、键盘焦点或操作能力。
