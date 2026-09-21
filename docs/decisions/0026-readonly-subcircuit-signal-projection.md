# ADR 0026：只读 Subcircuit 内部信号投影

## 状态

已接受。

## 背景

层次展平后，引擎只认识 occurrence-qualified 的扁平 Component。检查器需要回答“父文档中这个
Subcircuit 使用处当前是什么状态”，不能把同路径子 Project 标签自己的仿真状态当成答案，也不能把
临时 Engine ID 变成 Vue 或持久化 API。

## 决策

- 展平结果为每个顶层 Subcircuit 使用处保留稳定的 `ownerId`、`flatId`、路径、显示名和端口描述。
- Workspace 在一次既有 `tick` 快照返回后，把引擎端口投影成 `flatId:port` 的内部快照；检查器只消费这个
  stable source key，因此多个 occurrence（包括 D Flip-Flop）天然隔离。
- 非推进读取只接受当前可见检查器请求的稳定端点，走所属文档现有 EngineCallQueue；相同请求在队列中合并。
- 文档、选择、投影或可见性变化会使读取 revision 失效，迟到结果不得发布到当前检查器。读取失败单独保留
  可恢复诊断，不清除 Circuit、历史或上一次有效读数。
- 检查器投影是纯只读函数，不提供结构、输入或仿真状态编辑入口；不增加共享协议或 C++ 请求类型。

## 后果

tick 的跨进程次数不随内部端口数量增长；隐藏检查器不产生内部读取。端口清单仍由引擎绑定提供，层次
描述只负责稳定身份与展示元数据。内部输入端口若不在现有 tick 快照中，则在可见时通过已有
`get_signal` 补齐，不能为了表格引入新的批量协议。
