# 初始架构

## 总体结构

```text
Vue + TypeScript 用户界面
          │
          │ Electron IPC / JSON 消息
          ▼
Electron 主进程与协议适配器
          │
          │ stdin / stdout
          ▼
C++ 数字电路仿真引擎
```

## 模块职责

### 桌面应用模块

负责窗口生命周期、用户界面、界面状态和用户操作。它不实现电路求值规则。

### 协议模块

负责描述 TypeScript 侧使用的消息类型和共享概念。协议是前端与引擎之间的 seam。

### 仿真引擎模块

负责电路模型、信号传播、组合逻辑、时序逻辑、状态更新和仿真错误。

## 三类状态

- `Circuit` 保存静态电路结构，例如元件、端口和连接关系。
- 编辑器模型保存元件位置、选中状态和视觉 Wire 形状。
- `SimulationState` 保存当前信号值以及 Clock、D Flip-Flop 等时序元件的运行状态。

画布位置不影响仿真结果；同一份 Circuit 可以被多个 Simulation 使用。

Subcircuit 是 Project 与编辑器层的概念，在进入引擎之前就已经被展平为普通 Component（[ADR 0014](decisions/0014-subcircuit-by-reference-flattened-simulation.md)），因此不改变上面的三类状态划分。

## 第一版连接规则

- 两端 Port 的位宽必须相同；不同位宽拒绝连接，不做隐式扩展或截断（[ADR 0016](decisions/0016-strict-port-width.md)，Phase 4.5 起生效）。
- Connection 必须从输出 Port 指向输入 Port。
- 一个输出 Port 可以连接多个输入 Port，这是 fan-out。
- 一个输入 Port 不能连接多个输出 Port，以避免信号竞争。
- 两个输出 Port 不能直接互相连接。
- Connection 独立于 Component 生命周期存在；删除 Component 不会删除相关 Connection。
- 端点被删除后的 Connection 是悬空连接，可以被重新连接或删除，但不参与仿真。
- 未连接的输入在仿真中得到 `X`，可以同时产生提示。
- 没有 Clock 连接的 DFlipFlop 不会在时钟沿更新，可以产生结构提示。
- 组合逻辑环路在仿真稳定化时报告错误；包含状态元件的反馈回路不属于同一种组合环路。

## 当前 Circuit 接口

本节与下一节记录的是当前实现状态，不描述后续阶段的接口。Phase 4.5 会让 `Port` 增加位宽、`SignalValue` 从三值标量变为逐位多位值、`addConnection` 增加位宽校验、`addComponent` 支持携带端口清单（[ADR 0015](decisions/0015-width-as-port-attribute.md)、[ADR 0016](decisions/0016-strict-port-width.md)）；届时本节同步更新。

当前 C++ 领域模块提供以下操作：

- `addComponent`：添加指定类型的 Component，并返回身份；
- `removeComponent`：删除 Component，但保留相关 Connection；
- `addConnection`：添加合法的输出到输入连接，并返回结果或具体错误；
- `removeConnection`：按身份删除 Connection；
- `component` 和 `connection`：查询领域对象；
- `isDangling`：判断 Connection 是否因端点缺失而悬空。

该接口暂时不负责逻辑求值、信号传播或编辑器位置。那些行为将在后续垂直切片中加入。

## 当前 Simulation 接口

组合逻辑仿真通过独立的 `Simulation` 模块进行：

- `Simulation(Circuit)`：从 Circuit 创建独立仿真快照；
- `setInput`：设置 Input 元件的输出值；
- `settle`：重复求值直到输出稳定，并返回 `SimulationResult`；
- `tick`：推进一个 tick——记录 `clock` 端口前值、翻转全部 Clock、求值到稳定、让 DFlipFlop 在上升沿采样、再求值一次——并返回 `SimulationResult`；
- `step`：返回从创建以来推进的 tick 次数；`reset` 之后归零；
- `reset`：把仿真恢复成刚创建时的状态——全部输出端口回到初值、tick 计数归零、边沿判定的前值快照清空——但不触碰 Circuit 结构与其中的引擎身份；
- `outputSignals`：返回电路中全部输出端口的当前信号，供一次响应带回整份读数；
- `signal`：读取端口当前的 SignalValue。

当前切片实现 `Input`、`NotGate`、`AndGate`、`OrGate`、`NandGate`、`NorGate`、`XorGate`、`XnorGate`、`Output`、`Clock` 和 `DFlipFlop` 的行为，并能报告组合逻辑环路。`Clock` 的输出初值是 `0`（`0 → 1` 才算上升沿，从 `X` 起步会永远判不出第一次边沿），每推进一次翻转一次；`DFlipFlop` 的 `q` 初值是 `Unknown`，只在 `clock` 端口出现 `0 → 1` 时把 `d` 采样进 `q`，下降沿与任何一端是 `X` 的跳变都不采样；其余元件的输出初值仍是 `Unknown`。判边沿所比较的前值跨 tick 保留，因此时钟来自 Input 元件或组合逻辑时同样成立；`reset` 会把它连同其余运行时状态一起清空，重置后的第一次推进因此与刚创建时完全一致。未连接输入的值为 `Unknown`；不存在的端口返回空值。更丰富的通用仿真错误将在后续切片中加入。

## 当前外部接口

Electron 主进程通过 JSON Lines 长连接调用引擎。当前协议提供 `health_check`、`add_component`、`add_connection`、`remove_component`、`remove_connection`、`set_input`、`settle`、`tick`、`reset` 和 `get_signal` 十类请求，详细字段和错误格式见 [引擎 JSON Lines 协议](protocol.md)。

这是一个刻意偏小的垂直切片：先让“创建结构 → 设置输入 → 稳定求值 → 读取输出”跑通，目前已扩展删除协议，后续继续实现时钟、时序状态和持久化。当前桌面 UI 已通过业务 IPC 创建并运行 AND 示例、切换输入、稳定求值和读取输出；画布位置与视觉连线仍只属于编辑器模型，不会进入仿真引擎。后续图形编辑器切片和验收顺序见[项目路线图](roadmap.md)。

## 仿真模型

初期采用离散 tick 模型。组合逻辑在一个 tick 内传播到稳定状态；时序元件在时钟上升沿采样输入并更新状态。
