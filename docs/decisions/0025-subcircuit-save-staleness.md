# ADR 0025：子 Project 保存后的 occurrence-local stale 标记

## 状态

历史决策。保存源 Project 后按路径广播 `needsReload` 的行为由 [ADR 0027](0027-embedded-subcircuit-snapshots.md) 取代；本文记录旧实现的取舍。

## 背景

父 Project 的层次仿真使用显式采用的子 Project 展平快照。子标签可以继续编辑或保存，而父标签必须保持自己的 Circuit、SimulationState、撤销栈和未保存状态，直到用户在父侧显式执行“重新加载子电路”。同一个子 Project 也可能被多个父文档或同一父文档的多个 occurrence 引用。

## 决策

`useWorkspace` 为每个可见 Subcircuit occurrence 保存规范化目标身份、采用版本 token 和 `needsReload` 运行时字段。版本 token 使用成功写盘内容的稳定序列化文本；因此写入字节等价内容不会制造无意义的 stale 状态。运行时字段只叠加到编辑器快照，不进入 Project 文件。

活动生产 seam `useDocumentWorkspace` 在 `writeProjectFile` 成功、文档路径和版本状态更新完成后广播保存事件。其他打开文档只比较自己的 adopted occurrence 版本并设置 stale 标志；广播不读取文件、不调用引擎、不触发重载，也不创建父历史帧。显式重载成功采用新投影后只清除被重载 occurrence 的标志，其余 occurrence 保持 stale。重载的 projection revision 同时保存 occurrence 版本和 stale 集合，因此 undo/redo 会恢复提示状态。

## 后果

- 子文档 dirty、父文档 stale、Subcircuit unresolved 是三个独立维度，可以同时展示。
- 同一目标的多个父文档和多个 occurrence 不共享可变 adopted 状态。
- 关闭标签只移除协调器记录；不会重新打开文档，也不会通过 watcher 传播文件变化。
- 序列化 token 可能比短 hash 占用更多内存，但它避免了额外哈希实现，并且只保存在当前文档的运行时快照中。
