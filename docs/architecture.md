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

- 两端 Port 的位宽必须相同；不同位宽拒绝连接，不做隐式扩展或截断（[ADR 0016](decisions/0016-strict-port-width.md)）。
- Connection 必须从输出 Port 指向输入 Port。
- 一个输出 Port 可以连接多个输入 Port，这是 fan-out。
- 一个输入 Port 不能连接多个输出 Port，以避免信号竞争。
- 两个输出 Port 不能直接互相连接。
- Connection 独立于 Component 生命周期存在；删除 Component 不会删除相关 Connection。
- 端点被删除后的 Connection 是悬空连接，可以被重新连接或删除，但不参与仿真；两端位宽不再相同的 Connection 同样归入悬空，只有这一种表达（[ADR 0003](decisions/0003-connections-have-independent-lifecycle.md)、[ADR 0020](decisions/0020-port-list-is-the-only-authority.md)）。
- 未连接的输入在仿真中得到 `X`，可以同时产生提示。
- 没有 Clock 连接的 DFlipFlop 不会在时钟沿更新，可以产生结构提示。
- 组合逻辑环路在仿真稳定化时报告错误；包含状态元件的反馈回路不属于同一种组合环路。

## 当前 Circuit 接口

本节与下一节记录的是当前实现状态，不描述后续阶段的接口。Phase 4.5 已落地的是 `Port` 的位宽与位区间、逐位多位的 `SignalValue`、`addConnection` 的位宽校验、`addComponent` 的端口清单、`setComponentPorts` 以及端口清单作为位宽唯一权威来源的规则（[ADR 0015](decisions/0015-width-as-port-attribute.md)、[ADR 0016](decisions/0016-strict-port-width.md)、[ADR 0020](decisions/0020-port-list-is-the-only-authority.md)）；拆线器与合线器同样已落地（[ADR 0017](decisions/0017-paired-splitter-and-merger.md)）。

当前 C++ 领域模块提供以下操作：

- `addComponent`：添加指定类型的 Component，并返回身份；可以携带一份端口清单，省略时回退到内置定义；
- `setComponentPorts`：用新的端口清单整体替换既有元件的清单，Component 与仍然匹配的 Connection 身份都不变；
- `removeComponent`：删除 Component，但保留相关 Connection；
- `addConnection`：添加合法的输出到输入连接，并返回结果或具体错误；两端位宽不同返回 `WidthMismatch`；
- `removeConnection`：按身份删除 Connection；
- `component` 和 `connection`：查询领域对象；
- `validatePort`：校验单份端口声明的领域规则——位宽至少为 1，位区间必须与位宽自洽；
- `isDangling`：判断 Connection 是否悬空——端点无法解析，或两端位宽不再相同；
- `danglingConnections`：按创建顺序枚举当前全部悬空连接的稳定顺序身份。

该接口暂时不负责逻辑求值、信号传播或编辑器位置。那些行为将在后续垂直切片中加入。

## 当前 Simulation 接口

组合逻辑仿真通过独立的 `Simulation` 模块进行：

- `Simulation(const Circuit&)`：在一份 Circuit 上建立仿真状态。它持有引用而不复制结构，因此外部的结构变更不需要重建仿真，只需通知它重新推导状态；
- `reconcile`：结构变更后按元件身份重新推导仿真状态——仍然存在**且值的长度仍等于该端口当前位宽**的 `PortId` 保留当前值，消失的端口连同它的值一起丢弃，新出现的端口按初始值建立（初值长度等于端口位宽：Clock 的 `out` 是等宽的全 `0`，其余是等宽的 `X`），仍然存在的 `DFlipFlop` 保留它的 `q` 与 `clock` 端口上的前值，已删除的 `DFlipFlop` 不再留下残留。位宽变了的端口按初值重建，因此不会留下长度对不上端口的陈旧值。已推进的步数不归零；
- `setInput`：设置 Input 元件的输出值；长度是否等于该端口声明的位宽由调用方负责；
- `settle`：重复求值直到输出稳定，并返回 `SimulationResult`；
- `tick`：推进一个 tick——取每个 `DFlipFlop` 的 `clock` 端口前值、翻转全部 Clock、求值到稳定、让 DFlipFlop 在上升沿采样、再求值一次——并返回 `SimulationResult`。前值是「上一 tick 求值稳定之后观测到的值」：只在首次遇到该 DFlipFlop 时现读一次，其后跨 tick 保留并在每次推进末尾写回；
- `step`：返回从创建以来推进的 tick 次数；`reset` 之后归零；
- `reset`：把仿真恢复成刚创建时的状态——全部输出端口回到初值、tick 计数归零、上升沿判定的前值快照清空——但不触碰 Circuit 结构与其中的引擎身份；
- `outputSignals`：返回电路中全部输出端口的当前信号，供一次响应带回整份读数；
- `signal`：读取端口当前的 SignalValue。

`SignalValue` 是一个 N 位的逐位三值：每一位独立取 `0` / `1` / `X`，某一位未知不影响其余位，用户看到的是 `1X0` 而不是整条 `XXX`。`invert`、`andValue`、`orValue`、`xorValue` 这四个标量原语的签名不变，只是体内按位循环。相等是逐位比较，长度也必须相同——`settle` 的定点迭代正是靠这个相等判断本轮有没有变化，因此任何近似（例如把 `X` 当成通配）都会让迭代提前收敛、静默地求值不全。位宽为 1 的 Port 与引入位宽之前完全等价，`SignalValue` 在它上面就等于旧的三值标量。

端口读不到值（未连接输入、来源已失效、两端位宽不再相同）时，返回的是**按该端口自己声明的位宽**构造的全 `X`，而不是一个长度对不上的值。

当前切片实现 `Input`、`NotGate`、`AndGate`、`OrGate`、`NandGate`、`NorGate`、`XorGate`、`XnorGate`、`Output`、`Clock`、`DFlipFlop`、`Splitter` 和 `Merger` 的行为，并能报告组合逻辑环路。`Clock` 的输出初值是 `0`（`0 → 1` 才算上升沿，从 `X` 起步会永远判不出第一次上升沿），每推进一次在「整值全 `0`」与「整值全 `1`」之间翻转一次，长度等于端口位宽；`DFlipFlop` 的 `q` 初值是 `X`，只在 `clock` 端口出现 `0 → 1` 时把 `d` 采样进 `q`，下降沿与任何一端是 `X` 的跳变都不采样；其余元件的输出初值仍是整值全 `X`。判上升沿所比较的前值跨 tick 保留，因此时钟来自 Input 元件或组合逻辑时同样成立；`reset` 会把它连同其余运行时状态一起清空，重置后的第一次推进因此与刚创建时完全一致。未连接输入的值为该端口位宽的全 `X`；不存在的端口返回空值。更丰富的通用仿真错误将在后续切片中加入。

结构变更与清空状态是两件独立的事：结构变更按元件身份保留已积累的运行时状态（见 `reconcile`），而把整个仿真恢复成刚创建时的样子——全部输出回到初始值、`Clock` 回到 `0`、每个 `DFlipFlop` 的 `q` 回到 `X`、步数归零——是一条独立的 `reset` 请求。取舍与已知限制见 [ADR 0019](decisions/0019-tick-driven-by-protocol-and-state-kept-by-identity.md)；[ADR 0004](decisions/0004-json-lines-engine-session.md) 中「结构变化后重建 `Simulation` 快照」的第一版规则已由它修订。

## 当前外部接口

Electron 主进程通过 JSON Lines 长连接调用引擎。当前协议提供 `health_check`、`add_component`、`set_port_width`、`add_connection`、`remove_component`、`remove_connection`、`set_input`、`settle`、`tick`、`reset` 和 `get_signal` 十一类请求，详细字段和错误格式见 [引擎 JSON Lines 协议](protocol.md)。

端口清单是位宽的唯一权威来源：`add_component` 可选携带清单，`component_added` 与 `port_width_set` 回传该 Component 实际的清单。前端因此不再内置一份端口定义，`ComponentDefinitionRegistry` 只保留展示元数据，端口几何由展示定义里的布局条目加一条通用排布规则推导（[ADR 0020](decisions/0020-port-list-is-the-only-authority.md)）。

这是一个刻意偏小的垂直切片：先让“创建结构 → 设置输入 → 稳定求值 → 读取输出”跑通，目前已扩展删除协议，后续继续实现时钟、时序状态和持久化。当前桌面 UI 已通过业务 IPC 创建并运行 AND 示例、切换输入、稳定求值和读取输出；画布位置与视觉连线仍只属于编辑器模型，不会进入仿真引擎。后续图形编辑器切片和验收顺序见[项目路线图](roadmap.md)。

## 仿真模型

初期采用离散 tick 模型。组合逻辑在一个 tick 内传播到稳定状态；时序元件在时钟上升沿采样输入并更新状态。
