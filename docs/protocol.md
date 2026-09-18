# 引擎 JSON Lines 协议

## 目的

Electron 主进程与 C++ 引擎通过 stdin/stdout 建立一条长连接。双方每发送一条 JSON 对象并以换行结束；引擎对每条请求返回一条 JSON 对象。`requestId` 用于把响应匹配回原请求。

协议适配层只负责序列化、反序列化和错误格式化，不负责 Circuit 规则或信号求值。

## 信号值的当前表示

本版本中信号值在协议里是混用的：`0` 和 `1` 以 JSON 数字传输，`X` 以字符串传输，TypeScript 侧的类型是 `0 | 1 | "X"`。这是历史实现，不是有意设计，本文档的示例与实现保持一致（`"value":1` 是数字）。

[ADR 0015](decisions/0015-width-as-port-attribute.md) 决定 Phase 4.5 起把信号值统一为字符串（`"0"`、`"1"`、`"X"`、`"1010"`、`"X1X0"`），长度必须等于端口位宽。在那之前，`set_input` 和 `get_signal` 的值仍按上面的混用形式理解。

所有 `componentId` 和 `connectionId` 都从 `1` 开始。渲染进程传入删除接口的 ID 必须是正安全整数；C++ 删除处理还会拒绝零，以及负数、小数、指数形式、字符串和超出无符号整数范围的值。

## 请求

所有请求都包含 `type` 和 `requestId`。

| type | 主要字段 | 结果 |
| --- | --- | --- |
| `health_check` | 无 | 返回引擎名称和版本 |
| `add_component` | `kind`：`input`、`output`、`and`、`or`、`nand`、`nor`、`xor`、`xnor`、`not`、`clock`、`d_flip_flop` | 返回 `componentId` |
| `add_connection` | `sourceComponentId`、`sourcePort`、`targetComponentId`、`targetPort` | 返回 `connectionId` |
| `remove_component` | `componentId` | 删除 Component，并保留相关悬空 Connection |
| `remove_connection` | `connectionId` | 删除指定 Connection |
| `set_input` | `componentId`、`value`：`0`、`1` 或 `X` | 设置 Input 元件的输出 |
| `settle` | 无 | 求值到稳定状态 |
| `tick` | 无 | 推进一个 tick，返回当前步数与全部输出端口的值 |
| `get_signal` | `componentId`、`port` | 返回 `value`：`0`、`1` 或 `X` |

示例：

```json
{"type":"add_component","requestId":"r1","kind":"and"}
{"type":"add_connection","requestId":"r2","sourceComponentId":1,"sourcePort":"out","targetComponentId":3,"targetPort":"in1"}
{"type":"set_input","requestId":"r3","componentId":1,"value":1}
{"type":"settle","requestId":"r4"}
{"type":"get_signal","requestId":"r5","componentId":3,"port":"out"}
{"type":"remove_component","requestId":"r6","componentId":3}
{"type":"remove_connection","requestId":"r7","connectionId":1}
{"type":"tick","requestId":"r8"}
```

`tick` 是推进时间的唯一入口，响应是一次推进后的**全部输出端口**快照：

```json
{"type":"ticked","requestId":"r8","step":7,"signals":[{"componentId":3,"port":"out","value":1},{"componentId":5,"port":"q","value":"X"}]}
```

`signals` 直接来自仿真内部的输出信号表，只覆盖输出端口（`Output` 元件的 `in` 这类接收端不在其中，但它总是经 Connection 由某个输出端口驱动）。因此连续推进时每步只需一次跨进程往返，不必再按端口逐条 `get_signal`，往返次数不随电路规模增长。

## 响应

成功响应包含与请求相同的 `requestId`，并按操作返回以下类型：

- `health_check_result`：`status` 和 `engine`；
- `component_added`：`componentId`；
- `connection_added`：`connectionId`；
- `component_removed`：`componentId`；
- `connection_removed`：`connectionId`；
- `input_set`：表示输入已写入；
- `settled`：`status` 为 `ok`；
- `ticked`：`step` 为累计推进步数，`signals` 为每个输出端口的 `componentId`、`port` 与 `value`；
- `signal_result`：`value` 为 `0`、`1` 或 `X`。

失败响应统一为：

```json
{"type":"error","requestId":"r4","code":"combinational_loop","message":"检测到组合逻辑环路"}
```

当前可能出现的错误代码包括 `bad_json`、`bad_request`、`invalid_kind`、`invalid_connection`、`component_not_found`、`connection_not_found`、`invalid_signal`、`invalid_input`、`port_not_found`、`combinational_loop` 和 `unsupported_message`。Phase 4.5 会加入位宽不匹配与位区间非法的错误代码（[ADR 0016](decisions/0016-strict-port-width.md)、[ADR 0017](decisions/0017-paired-splitter-and-merger.md)）。

## 生命周期约定

- 引擎进程启动后持有一份 `Circuit`；同一进程内的请求共享这份结构。
- 添加或删除元件、添加或删除连接后会重建 `Simulation` 快照；因此结构修改会清空运行时状态。
- `remove_component` 删除 Component 但保留相关 Connection；端点失效的 Connection 变为悬空连接，不参与仿真。
- `remove_connection` 只删除指定 Connection，不删除两端 Component。
- 悬空 Connection 在领域层可以被查看、删除或重新连接；当前协议只能按已知 ID 删除它。编辑器的「重接」不新增协议请求，而是用「删除旧 Connection + 创建新 Connection」的补偿事务实现（见 [ADR 0007](decisions/0007-editor-session-and-stable-editor-ids.md) 与前端设计规范 14.1）；若将来出现需要原子重接的用例，再评估新请求类型。
- `Simulation` 不读取 UI 位置，也不向 Electron 暴露 C++ 对象；跨进程边界只传输协议数据。
- `tick` 是唯一的推进动作：`settle` 只做组合求值到稳定，`tick` 才翻转 Clock 并推进步数。引擎侧没有定时器也没有后台线程，「连续运行」由前端反复发 `tick` 表达。
- `clock` 元件的输出初值是 `0`，每推进一次在 `0` 与 `1` 之间翻转一次；`d_flip_flop` 目前仍是结构元件，其边沿采样行为由后续票实现。

## 规划中的变更（Phase 4.5）

以下变更已由 [ADR 0015](decisions/0015-width-as-port-attribute.md)、[ADR 0016](decisions/0016-strict-port-width.md) 和 [ADR 0017](decisions/0017-paired-splitter-and-merger.md) 决定，但尚未实现。列在这里以免与上面的当前协议混淆：

- `add_component` 的 `kind` 增加 `splitter` 与 `merger`；请求可选携带端口清单（含位宽与位区间），省略时引擎回退到内置定义；
- `component_added` 回传该 Component 实际的端口清单，前端不再内置一份端口定义；
- 新增 `set_port_width`（或等价的 `update_component`）修改既有元件的位宽。Component 与 Connection 的引擎身份保留，改宽后不再匹配的 Connection 转为悬空连接；
- `set_input` 与 `get_signal` 的信号值统一为字符串，长度等于端口位宽；
- `add_connection` 增加位宽校验，两端位宽不同直接拒绝，不做隐式扩展或截断。

## 实现约束

- TypeScript 类型位于 `packages/protocol/src/index.ts`。
- C++ 解析和错误响应位于 `engine/include/circuit/protocol.hpp` 与 `engine/src/protocol.cpp`。
- Electron 长连接客户端位于 `apps/desktop/electron/engine-client.cjs`。
- 新增消息时，必须同步更新 TypeScript 类型、C++ 处理器、协议测试和本文档。
