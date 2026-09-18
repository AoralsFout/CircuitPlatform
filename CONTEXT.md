# CircuitPlatform 领域语言

本上下文描述数字电路仿真领域中的核心概念，帮助需求、设计、代码和测试使用一致的术语。

## 电路结构

**Circuit**：一份静态的数字电路定义，包含元件及其端口之间的连接关系。它描述电路“是什么”，不描述当前仿真值，也不描述画布上的展示位置；Connection 可以在元件被删除后继续存在。

**Component**：电路中的逻辑或状态元件，例如 AND 门、输入端、输出端、Clock、D Flip-Flop，以及放入电路中的 Subcircuit。
_Avoid_: Node（在本项目中容易与 UI 节点或图算法节点混淆）
_Avoid_: Instance（Subcircuit 放入电路后仍称为 Component，不另造"实例"一词）

**Project**：用户保存和打开的工作单元，包含一份 Circuit、它的编辑器布局和元数据。一个 Project 恰好包含一份 Circuit；只有保存过的 Project 才拥有身份，也才能被其他 Circuit 作为 Subcircuit 引用。

**Subcircuit**：被另一份 Circuit 当作 Component 使用的 Project。它的 Input 和 Output 元件构成对外的 Port；内部其他 Component 对外不可见。Subcircuit 通过引用被使用，不是拷贝；一份 Project 可以在多份 Circuit 中被多次使用，也可以自身使用其他 Subcircuit，但引用关系不允许成环。Subcircuit 在加载时被展平，引擎不需要感知层次。
_Avoid_: Module、Block、CompoundComponent

**展平 Flatten**：加载父 Project 时，把每个 Subcircuit 使用的内部 Component 和 Connection 复制为普通 Component，并把外部 Port 上的 Connection 改接到内部 Input 元件的 `out` 或 Output 元件的 `in`。展平发生在进入引擎之前，因此引擎和协议都不出现层次概念。同一份 Project 在父 Circuit 中被放入多份时，每份各自展平出独立的 Component 和 SimulationState。
_Avoid_: 内联、实例化

**Port**：Component 用来接收或输出数字信号的连接点，具有输入或输出方向和一个位宽。端口清单由引擎声明并在创建与改宽时回传，是位宽的唯一权威来源。

**位宽 Width**：Port 一次接收或输出的位数。位宽为 1 的是单比特 Port，大于 1 的是多位 Port。
_Avoid_: Bus、向量长度（「总线」只在口语中指代位宽大于 1 的 Port 或 Connection，不是独立的领域对象）

**位区间 BitRange**：拆线器或合线器的某个 Port 在其宿主元件的那条多位 Port 上占据的连续位范围。位区间决定该 Port 的位宽。

**拆线器 Splitter**：把一条多位输入拆成若干条位区间输出的 Component。

**合线器 Merger**：把若干条位区间输入合并成一条多位输出的 Component。

**Connection**：一个输出 Port 到一个输入 Port 的连接记录，两端 Port 的位宽必须相同。Connection 独立于 Component 生命周期存在，端点被删除后可以成为悬空连接。
_Avoid_: Wire（Wire 专指编辑器中的视觉线段时才使用）

**DanglingConnection**：缺少一个或两个有效端点的 Connection，或者两端 Port 的位宽不再相同的 Connection。它可以被查看、删除或重新连接，但不参与信号传播。位宽不匹配走的是同一个表达，因此没有「失效连接」这个近义词。

## 信号与状态

**SignalValue**：信号的具体值，是一个多位值：每一位独立取 `0`、`1` 或 `X`，其中 `X` 表示该位未知。

**Signal**：在仿真中通过 Port 和 Connection 传播的数字信息，具有一个 SignalValue，位宽由所在 Port 决定。

**Simulation**：对一份 Circuit 进行求值和运行的过程。

**SimulationState**：某次 Simulation 在当前时刻的运行状态，包含端口信号值和时序元件保存的状态。

**Reset**：把某次 Simulation 恢复成刚建立时的状态的动作——全部输出 Port 回到初始值、Clock 回到 `0`、每个 DFlipFlop 的 `q` 回到 `X`、Tick 计数归零，上升沿判定的前值快照一并清空。Reset 只清 SimulationState，不改变 Circuit：元件与连接的引擎身份属于 Circuit，必须保持。它是用户**显式要求**的清空，与「结构变更保留已积累的时序状态」是两件互相独立的事，因此也是一条独立请求而不是推进的一个参数。
_Avoid_: 重新加载、重建仿真（Reset 不动 Circuit，也不重新推送文档）

**Tick**：仿真时间的最小推进单位。一次 Tick 先翻转全部 Clock 的输出，把新的电平等组合逻辑传播到稳定，再让时序元件按本次的端口跳变完成采样，然后才让采样结果继续传播。Tick 只由显式请求推进，引擎里没有定时器，也没有「当前是否在跑」这个状态——连续运行只是前端反复发 Tick。
_Avoid_: 帧、时钟周期（一个 Clock 周期是两个 Tick）

## 时序元件

**Clock**：产生有规律数字变化并为时序元件提供时序参考的 Component。

**上升沿**：一次 Tick 中 `clock` 端口从 `0` 变到 `1` 的跳变。只有 `0 → 1` 算上升沿：`1 → 0` 是下降沿，任何一端是 `X` 的跳变都不算——`X → 1` 无法与「上一 Tick 本来就是 `1`」区分开。判定只看该端口的**前值与当前值**，与时钟来自 Clock 元件、Input 元件还是组合逻辑无关，因此门控时钟和展平后的 Subcircuit 都适用。
_Avoid_: 边沿、时钟沿（单独说「边沿」时必须说明是上升还是下降）

**DFlipFlop**：在 `clock` 端口的上升沿把 `d` 采样进 `q`，并保持采样结果直到下一次上升沿的状态元件。第一次有效上升沿之前 `q` 是 `X`，表示还没有采过样，而不是保存了 `0`；`clock` 端口没有连接时它每一步都不更新，这是结构问题而不是错误。
_Avoid_: Register（Register 是由多个状态元件组成的更高层概念）
