# CircuitPlatform 领域语言

本上下文描述数字电路仿真领域中的核心概念，帮助需求、设计、代码和测试使用一致的术语。

## 电路结构

**Circuit**：一份静态的数字电路定义，包含元件及其端口之间的连接关系。它描述电路“是什么”，不描述当前仿真值，也不描述画布上的展示位置；Connection 可以在元件被删除后继续存在。

**Component**：电路中的逻辑或状态元件，例如 AND 门、输入端、输出端、Clock、D Flip-Flop，以及放入电路中的 Subcircuit。
_Avoid_: Node（在本项目中容易与 UI 节点或图算法节点混淆）
_Avoid_: Instance（Subcircuit 放入电路后仍称为 Component，不另造"实例"一词）

**Project**：用户保存和打开的工作单元，包含一份 Circuit、它的编辑器布局和元数据。一个 Project 恰好包含一份 Circuit。

**Subcircuit**：被另一份 Circuit 当作 Component 使用的 Project。它的 Input 和 Output 元件构成对外的 Port；内部其他 Component 对外不可见。Subcircuit 通过引用被使用，不是拷贝；一份 Project 可以在多份 Circuit 中被多次使用，也可以自身使用其他 Subcircuit，但引用关系不允许成环。
_Avoid_: Module、Block、CompoundComponent

**Port**：Component 用来接收或输出数字信号的连接点，具有输入或输出方向和一个位宽。

**位宽 Width**：Port 一次接收或输出的位数。位宽为 1 的是单比特 Port，大于 1 的是多位 Port。
_Avoid_: Bus、向量长度（「总线」只在口语中指代位宽大于 1 的 Port 或 Connection，不是独立的领域对象）

**位区间 BitRange**：Port 在宿主 Component 的一条多位总线上占据的连续位范围。位区间决定该 Port 的位宽。

**拆线器 Splitter**：把一条多位输入拆成若干条位区间输出的 Component。

**合线器 Merger**：把若干条位区间输入合并成一条多位输出的 Component。

**Connection**：一个输出 Port 到一个输入 Port 的连接记录，两端 Port 的位宽必须相同。Connection 独立于 Component 生命周期存在，端点被删除后可以成为悬空连接。
_Avoid_: Wire（Wire 专指编辑器中的视觉线段时才使用）

**DanglingConnection**：缺少一个或两个有效端点的 Connection。它可以被查看、删除或重新连接，但不参与信号传播。

## 信号与状态

**SignalValue**：信号的具体值，是一个多位值：每一位独立取 `0`、`1` 或 `X`，其中 `X` 表示该位未知。

**Signal**：在仿真中通过 Port 和 Connection 传播的数字信息，具有一个 SignalValue，位宽由所在 Port 决定。

**Simulation**：对一份 Circuit 进行求值和运行的过程。

**SimulationState**：某次 Simulation 在当前时刻的运行状态，包含端口信号值和时序元件保存的状态。

## 时序元件

**Clock**：产生有规律数字变化并为时序元件提供时序参考的 Component。

**DFlipFlop**：在 Clock 上升沿采样 D 输入，并保持采样结果直到下一次有效上升沿的状态元件。
_Avoid_: Register（Register 是由多个状态元件组成的更高层概念）
