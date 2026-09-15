# ADR 0011：大型画布交互使用帧合并与结构投影缓存

## 状态

已确认

## 背景

目标画布需要在 1920×1080、500 个 Component 和 1,000 条 Wire 下连续交互 5 秒，并保持第 95 百分位帧耗时不超过 20ms。节点/Route 拖动和 ConnectionDraft 会产生高频 pointer move；仿真信号变化也不应改变 Wire 几何。

## 决策

- 节点拖动、Route 拖动、画布平移和 ConnectionDraft 的指针值通过 `requestAnimationFrame` 合并，每帧最多应用一次；pointerup 提交前立即刷新最后一个值。
- CanvasScene 投影器按 EditorSnapshot、拖动预览和 Route 预览的引用缓存节点/连线几何；SimulationSnapshot 更新只复制状态叶子，不重新生成 Route。
- 超过 500 个 Component 或 1,000 条 Wire 时，画布只关闭背景次级网格渐变、节点/画布光晕和连线高光；DOM 标签、键盘焦点、命中区域和操作能力保持不变。
- `apps/desktop/scripts/performance-benchmark.mjs` 启动 Vite 和 Electron，挂载真实 `CircuitCanvas`，构造目标规模并通过 DOM PointerEvent 运行 5 秒 pan/drag 场景；采样包含 DOM 事件、组件更新和 RAF 回调，输出 P95 JSON 并以 20ms 为失败门槛。

## 后果

拖动预览仍然是临时 InteractionState，不创建 EditorSnapshot 或调用引擎；结构命令只在释放时提交。缓存依赖编辑器快照及预览对象的引用稳定性，结构或交互预览改变时会安全地重建。基准 runner 以 `disable-gpu`、`no-sandbox`、`backgroundThrottling: false` 和可见窗口保证跨 Windows 环境稳定采样；视觉回归另外验证 Electron 页面合成，因此两者边界明确。
