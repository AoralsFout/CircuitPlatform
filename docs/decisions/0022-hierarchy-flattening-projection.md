# ADR 0022：层次展平使用纯 TypeScript 投影与 occurrence 身份

## 状态

已接受

## 背景

ADR 0014 决定 Subcircuit 在进入引擎前展平，但没有规定递归读取、失败回滚和多个实例如何共享文件内 ID。若递归函数直接向全局 Circuit 写入，深层引用失败会留下半成品；若内部连接沿用子文件自己的 ID，多实例会发生碰撞并依赖遍历顺序获得不稳定后缀。

## 决策

- 层次解析保持为不依赖 Electron、Vue 和引擎 ID 的纯 TypeScript 深模块；子 Project 通过异步 `HierarchyProjectReader` 注入，路径解析沿用 ADR 0021 的词法身份规则。
- 每个 Subcircuit occurrence 先写入局部投影，递归完成且没有诊断后才一次性合并到父投影；缺失、非法接口、Clock、循环或深层失败都只保留顶层可见 Subcircuit 的缓存端口与诊断，不合并失败子树。
- 扁平 Component 与内部 Connection 的身份由 occurrence path 加文件内 ID 组成（例如 `u1/gate`、`u1/w1`）；顶层原始连接仍沿用自身 ID。这样同一 Project 的多次使用相互独立，且 source map 不依赖遍历顺序。
- 引擎投影只输出协议 `ComponentKindName`；Subcircuit 仅保留在顶层 EditorDocument。`sources.ports` 只描述顶层 Subcircuit 的外部端口到内部扁平端点的方向化映射，普通根级元件沿用直接绑定。

## 后果

- 加载失败不会污染已经成功解析的兄弟实例，调用方可以把返回的 Circuit 当作原子快照提交。
- Source map 能支持一对多 Component/Connection 绑定与后续重载；内部连接没有平坦对应物（例如直接接到边界的线）不会伪造引擎对象。
- 递归深度和展平后的对象数量仍需由调用方限制或在后续性能切片中测量；本 ADR 不引入引擎原生层次协议。
