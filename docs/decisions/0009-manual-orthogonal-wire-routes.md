# ADR 0009：编辑器保存可手工编辑的正交 Wire Route

## 状态

已确认

## 背景

领域 Connection 只描述一个输出 Port 到一个输入 Port 的电气关系；Wire 是它在编辑器中的视觉投影。当前固定示例把 Wire path 写死在 Vue 模板中，无法随节点移动，也无法保留用户布局。第一版通用画布要求完成手工布线，而不是只生成不可编辑的自动路径。

## 决策

EditorDocument 保存 Wire 的显式正交 Route。Route 由已连接 Port 端点、零个或多个有序 Waypoint 以及可能存在的悬空端点组成：

- 已连接端点坐标从 CircuitNode 的 Port 布局推导，不重复持久化；
- Waypoint 是实际可见折点，使用世界坐标并随编辑器文档保存；
- DanglingConnection 的失效端点保存最后有效世界坐标；
- Route 几何不进入领域 Connection，也不影响仿真结果；
- 每一段只能水平或垂直，渲染圆角不改变 Route 数据。

用户可以从输入或输出 Port 发起布线，编辑器提交时统一规范化为 `output Port → input Port`。点击式布线依次放置 Waypoint，拖拽式布线可以快速直连或在空白处转入持续布线；`Space` 切换当前轴向。第一段沿 Port 朝外方向延伸，Port 外保留至少 16 世界单位的终端线段。

现有 Wire 支持拖动内部线段和折点。水平线段只能上下移动，垂直线段只能左右移动；直接连接 Port 的首尾终端线段固定，不允许拖动。每次编辑后只删除重复点和共线冗余点，不自动选择更短路径，不重排用户折点，也不提供自动避障。

移动 CircuitNode 时，用户 Waypoint 保持绝对世界坐标不变，只重新生成两端到 Route 的派生正交线段；没有 Waypoint 时生成默认正交 Route。CircuitNode 和 Waypoint 默认吸附到 16 世界单位网格，按住 `Alt` 临时关闭吸附。

Wire 相交或重叠不会创建 junction。Fan-out 仍由一个输出 Port 对多个独立 Connection 表达。第一版不包含多端 Net、总线、crossing bridge 或把 Component 自动插入 Wire。

创建、重接和一次 Route 编辑分别作为单个 EditorSession 历史命令。ConnectionDraft 的移动、加点和轴向切换不进入历史。重接已占用输入时沿用 EditorSession 补偿事务：旧 Wire 在成功前保持可见，失败保留草稿，补偿失败进入恢复状态。

## 未采用的方案

### Route 完全由端点派生

不采用。它无法保存用户的手工布局，节点移动或重新打开文档时可能改变路径意图。

### 在领域 Connection 中保存路径

不采用。路径只属于编辑器展示，把它放进 Circuit 会破坏编辑器几何与仿真结构的职责分离。

### 第一版自动避障

不采用。自动避障会在节点移动时不可预测地改写用户布局，也显著扩大性能和撤销模型；Wire 与 CircuitNode 的几何重叠不属于电气错误。

### Wire 相交时自动连接

不采用。视觉交叉不应隐式改变 Circuit，junction 和多端 Net 需要独立的领域决策。

## 后果

- EditorConnection 需要扩展 Route/Waypoint 数据，旧示例路径需要迁移为显式模型；
- Route 生成、坐标转换、吸附、规范化、命中和键盘状态机必须能脱离 Vue 进行纯函数测试；
- ConnectionDraft、拖动预览与持久 EditorDocument 分离，只有完成的用户意图进入历史；
- 项目文件阶段必须持久化 Waypoint，但不必持久化 ViewportState；
- 删除 Component 后，Wire 继续遵守 ADR 0003 和 ADR 0007 的悬空语义。
