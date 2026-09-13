# 引擎 JSON Lines 协议

## 目的

Electron 主进程与 C++ 引擎通过 stdin/stdout 建立一条长连接。双方每发送一条 JSON 对象并以换行结束；引擎对每条请求返回一条 JSON 对象。`requestId` 用于把响应匹配回原请求。

协议适配层只负责序列化、反序列化和错误格式化，不负责 Circuit 规则或信号求值。

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
```

## 响应

成功响应包含与请求相同的 `requestId`，并按操作返回以下类型：

- `health_check_result`：`status` 和 `engine`；
- `component_added`：`componentId`；
- `connection_added`：`connectionId`；
- `component_removed`：`componentId`；
- `connection_removed`：`connectionId`；
- `input_set`：表示输入已写入；
- `settled`：`status` 为 `ok`；
- `signal_result`：`value` 为 `0`、`1` 或 `X`。

失败响应统一为：

```json
{"type":"error","requestId":"r4","code":"combinational_loop","message":"检测到组合逻辑环路"}
```

当前可能出现的错误代码包括 `bad_json`、`bad_request`、`invalid_kind`、`invalid_connection`、`component_not_found`、`connection_not_found`、`invalid_signal`、`invalid_input`、`port_not_found`、`combinational_loop` 和 `unsupported_message`。

## 生命周期约定

- 引擎进程启动后持有一份 `Circuit`；同一进程内的请求共享这份结构。
- 添加或删除元件、添加或删除连接后会重建 `Simulation` 快照；因此结构修改会清空运行时状态。
- `remove_component` 删除 Component 但保留相关 Connection；端点失效的 Connection 变为悬空连接，不参与仿真。
- `remove_connection` 只删除指定 Connection，不删除两端 Component。
- 悬空 Connection 在领域层可以被查看、删除或重新连接；当前协议可以按已知 ID 删除它，后续查询和重连接口也必须保持 Connection 独立于 Component 生命周期的规则。
- `Simulation` 不读取 UI 位置，也不向 Electron 暴露 C++ 对象；跨进程边界只传输协议数据。
- 当前 `clock` 和 `d_flip_flop` 仅能被创建，时序行为将在后续阶段实现。

## 实现约束

- TypeScript 类型位于 `packages/protocol/src/index.ts`。
- C++ 解析和错误响应位于 `engine/include/circuit/protocol.hpp` 与 `engine/src/protocol.cpp`。
- Electron 长连接客户端位于 `apps/desktop/electron/engine-client.cjs`。
- 新增消息时，必须同步更新 TypeScript 类型、C++ 处理器、协议测试和本文档。
