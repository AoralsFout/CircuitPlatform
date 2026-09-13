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

## 第一版连接规则

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
- `signal`：读取端口当前的 SignalValue。

当前切片实现 `Input`、`NotGate`、`AndGate`、`OrGate`、`NandGate`、`NorGate`、`XorGate`、`XnorGate` 和 `Output` 的组合行为，并能报告组合逻辑环路。未连接输入的值为 `Unknown`；不存在的端口返回空值。更丰富的通用仿真错误将在后续切片中加入。

## 初始外部接口

引擎接口计划保持为少量高层操作：

- `loadCircuit`
- `setInput`
- `reset`
- `step`
- `run`
- `pause`
- `getSnapshot`

本阶段只实现健康检查消息，用于验证进程和通信链路。

## 仿真模型

初期采用离散 tick 模型。组合逻辑在一个 tick 内传播到稳定状态；时序元件在时钟上升沿采样输入并更新状态。
