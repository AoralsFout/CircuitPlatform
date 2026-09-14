# ADR 0007：使用 EditorSession 管理编辑器删除与撤销

## 状态

已确认

## 背景

Phase 3 的编辑器同时面对两套身份和两类模型：C++ `Circuit` 中的 Component、Connection 使用引擎分配的数值身份；编辑器模型还需要保存位置、选中状态和视觉 Wire。删除 Component 后，按照 ADR 0003，C++ 仍然保留相关悬空 Connection。编辑器必须在被删节点的最后端口位置继续显示这些 Wire，并支持异步失败的删除和撤销。

如果 Vue 页面直接调用协议、保存 engine ID 并自行拼接撤销步骤，协议字段、异步竞态、悬空连接和新身份映射会扩散到多个调用者，破坏 Circuit、编辑器模型和 SimulationState 的职责分离。

## 决策

在 Vue 与协议适配器之间引入一个深模块 `EditorSession`。它是删除、撤销和编辑器投影的唯一入口，Vue 不接触 engine ID 或原始 `EngineResponse`。

其最小 Interface 为：

```ts
interface EditorSession {
  snapshot(): EditorSnapshot;
  dispatch(command: EditorCommand): Promise<CommandResult>;
  subscribe(listener: (snapshot: EditorSnapshot) => void): () => void;
}
```

`EditorSelection` 只包含编辑器本地的 `EditorComponentId` 或 `EditorConnectionId`。`EditorSnapshot` 至少包含可见 Component、未删除的 live/dangling Wire、当前选中对象、待确认操作、操作状态、`canUndo` 和可展示错误。Wire 端点保存最后一次有效的画布坐标，并通过 `danglingEndpoints` 标明悬空端。

### 身份分离

- 编辑器身份在一次编辑会话中稳定，用于选择、历史和 Vue 列表 key；
- engine ID 只保存在 `EditorSession` 的内部映射中；
- 删除后撤销必须调用 `addComponent` 和 `addConnection` 获得新的 engine ID；
- 撤销完成后更新映射，旧 engine ID 永不重新绑定到新的编辑器对象。

当前固定 AND 示例使用 `input-a`、`input-b`、`and-gate` 和 `output` 等稳定逻辑身份，但这些身份不等同于 C++ Component ID。示例启动时必须使用引擎实际返回的 Component/Connection ID 初始化内部映射，生产路径不得假设 ID 起始值。

### 删除语义

- 删除 Component 时只请求引擎删除 Component；引擎保留相关 Connection；
- 编辑器模型继续在 `snapshot().document.connections` 返回这些 Connection，并通过 `danglingEndpoints` 标记 `source`、`target` 中失效的一端；
- 删除 Connection 时才请求引擎删除该 Connection，并从编辑器模型中移除对应 Wire；
- 删除开始时可先发布节点消失、Wire 转为 dangling 的投影和 `busy` 状态；协议失败必须回滚，成功后才压入撤销记录。

### 撤销语义

撤销 Component 删除时按以下顺序执行：

1. 创建同类型 Component，获得新的 engine ID；
2. 使用新的端点身份重建所有关联 Connection，获得新的 Connection ID；
3. 所有新对象创建成功后，清理删除时留下的旧 dangling Connection；
4. 更新内部映射，恢复编辑器 Component、位置、属性、Wire 和选中状态。

撤销 Connection 删除时，使用当前两端 Component 的 engine ID 创建新的 Connection，再更新编辑器映射。

### 清空与取消语义

- `request-clear` 只在快照中发布待确认操作，不调用引擎，也不写入历史；
- 待确认期间只接受 `confirm-clear` 或 `cancel-current-operation`，避免确认内容与实际文档漂移；
- 确认后将当前可见文档清空为一个复合历史帧：先删除 Connection，再删除 Component；
- 清空只物理删除当时 live 的 Connection；已有 dangling Connection 遵守独立生命周期并保留引擎绑定，但从画布投影隐藏，撤销清空时恢复对应悬空 Wire；
- Esc 优先取消待确认操作并保留选择；没有待确认操作时取消当前选择；已经发往引擎的异步事务不伪装成可取消操作。

撤销清空时先重建全部可见 Component，再重建清空前的 live Connection，并使用新的 engine ID 更新映射；清空前已 dangling 的 Wire 只恢复编辑器投影。重做清空必须使用撤销后生成的新 engine ID。

所有删除、清空和撤销命令串行执行。同一时间只允许一个结构变更命令处于 `busy` 状态，避免旧快照覆盖新快照。

### 失败和补偿

协议调用是异步且可失败的。预期引擎错误被转换为 `EditorSnapshot.error`，不会把协议错误对象传播给 Vue。

- 删除失败：编辑器可见状态和撤销栈保持不变；
- 清空部分失败：重建已删除的 Component 和 live Connection，并更新变化后的 engine ID；
- 撤销中间步骤失败：删除新建的 Component 和 Connection，保持原编辑器快照；
- 补偿也失败：进入 `recovery_required` 状态，暂停后续结构编辑，并要求显式恢复或重新加载；
- 只有全部步骤成功，撤销才从历史栈移除对应记录。

恢复算法依赖 ADR 0003 的语义：dangling Connection 不参与有效输入端口的占用判断。若引擎当前实现仍让 dangling Connection 阻塞 live 输入，必须先补齐该 Circuit 规则或提供等价的引擎侧恢复事务，不能由 Vue 绕过协议直接修改 Circuit。

## Seam 与 Adapter

`EditorSession` 依赖一个窄的引擎 Adapter。Adapter 负责把 `component_added`、`connection_added`、`component_removed`、`connection_removed` 以及错误响应转换成编辑器可理解的结果；Vue 和编辑器模型不依赖 JSON 字段。

生产 Adapter 连接 Electron preload 和 C++ 引擎，测试 Adapter 使用可控的内存实现。命令队列、engine ID 映射、历史记录、悬空 Wire 投影和补偿逻辑全部留在 `EditorSession` 内部，以保持变更 Locality。

固定示例的 `Workspace` 只通过 `onBindingsChanged` 内部回调获得仍然有效的仿真身份；回调不会进入 Vue 快照。删除导致结构不完整时仿真绑定暂时失效，撤销成功后以新 engine ID 重新绑定，因此后续仿真不会调用已删除的身份。

## 未采用的方案

### Vue 直接调用协议

不采用。它会让每个页面重复处理 request/response、错误、engine ID 和异步竞态，Interface 浅且维护 Locality 差。

### 直接把 engine ID 当作 Vue key

不采用。撤销必然产生新 engine ID，会导致选中状态、Wire 引用和组件列表身份漂移。

### 删除 Component 时同时删除所有 Connection

不采用。它违反 ADR 0003 的 Connection 独立生命周期，也会丢失恢复和后续重新连接所需的信息。

### 通过重新使用旧 engine ID 撤销

不采用。引擎 ID 由 C++ 单调分配，删除后不保证可复用；强行复用会把编辑器历史和引擎真实状态混在一起。

## 后果

- Vue 的默认删除、清空和撤销调用保持简单：只需向组合层发出选择、请求确认、确认/取消或历史意图；
- 引擎身份变化被隐藏，编辑器模型可以稳定维护选择和历史；
- 删除 Component 后，领域层与 UI 都保留 dangling Connection；UI 使用冻结端点和警示样式明确显示悬空 Wire；
- 需要维护 editor ID 到 engine ID 的映射，并实现可测试的补偿流程；
- `EditorSession` 为后续多选、连接草稿、保存/加载和批量恢复保留扩展点，但当前仍使用固定 AND 示例；
- 本 ADR 不宣称画布拖动、端口连线或属性编辑已经完成，具体交付仍由 `docs/roadmap.md` 跟踪。
