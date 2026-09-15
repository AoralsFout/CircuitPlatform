# ADR 0008：画布采用场景投影与 DOM/SVG 分层渲染

## 状态

已确认

## 背景

旧版画布只渲染固定 AND 示例：CircuitNode 使用 HTML 绝对定位，Wire 使用固定 SVG path，节点百分比位置、SVG 坐标和编辑器模型中的 position 是彼此独立的几何事实源。固定 `NodeKey`、`WireKey` 和十多个展示 props 也使新增 Component 必须同时修改模板、样式和 composable；这些事实源现已迁移到通用投影。

第一版通用画布需要支持任意编辑器文档、平移缩放、节点拖动、添加 Component 和手工布线，并在 500 个 Component、1,000 条 Wire 下保持接近 60 FPS，同时保留 HTML 排版、键盘焦点和 ARIA 能力。

## 决策

画布使用一个数据驱动的场景投影和共享视口变换：

```text
EditorSnapshot + SimulationSnapshot + ComponentDefinitionRegistry
                              │
                              ▼
                         CanvasScene
                              │
                ┌─────────────┼─────────────┐
                ▼             ▼             ▼
           CSS 网格层     SVG Wire 层    HTML Node/Port 层
```

画布渲染组件接收 `CanvasScene`、`ViewportState` 和 `InteractionState` 三个聚合输入，并通过单一 `CanvasController` 端口接收交互命令；不再增加散落的展示 props。`CanvasScene` 是纯投影结果，包含可渲染的 CircuitNode、Port、Wire 和信号状态；`ViewportState` 只包含视口平移、缩放和可见范围；`InteractionState` 保存拖动预览、ConnectionDraft、悬停和键盘焦点。Vue 模板不再识别固定示例身份，也不保存另一套对象坐标。

Component 使用 HTML 渲染，Wire、悬空端点、选择和连接草稿使用 SVG，网格使用 CSS；所有世界图层共享同一个 `ViewportTransform`。世界坐标与屏幕坐标通过集中、可测试的纯函数互转，缩放围绕指针或视口中心进行。视口状态独立于 EditorDocument，不进入撤销历史，第一版不随项目持久化。

`ComponentDefinitionRegistry` 是 Component 展示定义的唯一来源，统一提供分类、名称、符号、说明、尺寸、Port 布局、可用性和搜索别名。它不保存 Circuit 合法性规则；协议和 C++ 引擎仍然执行最终校验。

拖动预览与平移缩放在临时交互状态中按 animation frame 合并，不在 pointer move 期间创建 EditorSnapshot 或调用引擎。结构或布局意图只在交互完成时作为一个 EditorSession 命令提交。信号变化只更新展示状态，不重新计算 Route。

## 未采用的方案

### 继续扩展固定模板

不采用。它会继续复制身份、坐标、Port 和路径信息，无法渲染任意 EditorDocument。

### 全部使用 SVG

不采用。SVG 适合 Wire 和交互覆盖层，但将复杂节点内容、表单和可访问交互全部迁入 SVG 没有带来当前规模所需的收益。

### Canvas 2D 或 WebGL

第一版不采用。目标规模尚不足以抵消文本排版、命中检测、键盘焦点和 ARIA 镜像的额外成本；如果未来性能基准证明分层方案无法满足目标，再以实测数据重新决策。

### 引入通用图编辑框架

第一版不采用。当前领域的悬空 Connection、手工正交 Route、稳定 Editor ID 和补偿事务具有明确语义，先通过窄的项目内模块实现，避免框架状态模型成为新的事实源。

## 后果

- 固定 AND 示例必须迁移为普通 EditorDocument，并删除旧的固定 SVG path、百分比位置和 ID 投影；
- DOM 和 SVG 必须共享完全一致的世界坐标与视口变换；
- 画布交互控制器、场景投影和渲染组件具有明确 seam，可以分别测试；
- 第一版以 1920×1080、500 个 Component 和 1,000 条 Wire 连续交互 5 秒、P95 帧耗时不超过 20ms 作为性能门槛；
- 超过目标规模时可以关闭光晕、动画和次级网格，但不能牺牲标签、焦点和操作能力。
