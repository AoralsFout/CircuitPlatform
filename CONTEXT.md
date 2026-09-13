# CircuitPlatform 领域语言

本上下文描述数字电路仿真领域中的核心概念，帮助需求、设计、代码和测试使用一致的术语。

## 电路结构

**Circuit**：一份静态的数字电路定义，包含元件及其端口之间的连接关系。它描述电路“是什么”，不描述当前仿真值，也不描述画布上的展示位置。

**Component**：电路中的逻辑或状态元件，例如 AND 门、输入端、输出端、Clock 和 D Flip-Flop。
_Avoid_: Node（在本项目中容易与 UI 节点或图算法节点混淆）

**Port**：Component 用来接收或输出数字信号的连接点，具有输入或输出方向。

**Connection**：一个输出 Port 到一个输入 Port 的有效连接关系。一个输出可以连接多个输入，但一个输入不能连接多个输出。
_Avoid_: Wire（Wire 专指编辑器中的视觉线段时才使用）

## 信号与状态

**SignalValue**：信号的具体值，第一版包括 `0`、`1` 和 `X`，其中 `X` 表示未知。

**Signal**：在仿真中通过 Port 和 Connection 传播的数字信息，具有一个 SignalValue。

**Simulation**：对一份 Circuit 进行求值和运行的过程。

**SimulationState**：某次 Simulation 在当前时刻的运行状态，包含端口信号值和时序元件保存的状态。

## 时序元件

**Clock**：产生有规律数字变化并为时序元件提供时序参考的 Component。

**DFlipFlop**：在 Clock 上升沿采样 D 输入，并保持采样结果直到下一次有效上升沿的状态元件。
_Avoid_: Register（Register 是由多个状态元件组成的更高层概念）
