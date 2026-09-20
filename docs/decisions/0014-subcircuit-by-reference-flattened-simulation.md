# ADR 0014：Subcircuit 按引用组合并在加载时展平

## 状态

已确认

## 背景

用户希望把一个已保存的 Project（例如 ALU）作为一个 Component 放进另一份 Circuit 中复用，内部的 Input 和 Output 元件成为对外 Port。这需要回答两个互相依赖的问题：父 Project 记录子 Project 的什么（引用还是拷贝），以及仿真引擎如何求值一个由数据决定端口列表的 Component。

现状约束：

- 引擎的 `ComponentKind` 是封闭枚举，端口列表和求值规则按类型硬编码在 `portsFor`、`isCombinational`、`evaluateBinaryGate` 三处；
- `Simulation::settle` 是对全部元件的朴素定点迭代，没有网络或节点抽象；
- 编辑器已按 ADR 0007 持有"稳定 Editor ID → 临时 Engine ID"的映射；
- 项目文件格式尚未设计（Phase 5）。

本 ADR 定义 Subcircuit 的领域语义；递归读取、局部投影、稳定扁平身份和来源映射的实现细化见 [ADR 0022](0022-hierarchy-flattening-projection.md)。

## 决策

### Subcircuit 是引用，不是拷贝

- 父 Project 记录子 Project 文件的相对路径。打开父 Project 时重新读取子 Project 并解析其接口；
- 父 Project 同时缓存子 Project 的端口清单。实际文件为准；文件缺失或校验失败时，用缓存绘制形状与端口名，并把该 Component 标为"未解析"，不参与仿真；
- 子 Project 文件在父 Project 打开期间的变化不自动生效，由用户执行"重新加载子电路"命令，作为一个可撤销的历史帧；
- 重新解析后端口按名字匹配：能对上的 Connection 保留，对不上的成为 DanglingConnection（沿用 ADR 0003）；
- 允许多层嵌套；引用关系成环时，加载该 Component 失败并给出原因。

### 接口只由信号方向决定

- 子 Project 中的 Input 元件成为输入 Port，Output 元件成为输出 Port，其余元件对外不可见；
- Port 名取自 Input / Output 元件的标签，顺序默认按元件在子 Project 中的纵坐标自上而下，子 Project 可以显式覆盖顺序；
- 子 Project 中不允许 Clock，时钟必须由外部通过 Port 传入；允许 DFlipFlop，每个 Subcircuit 使用处各自持有状态；
- 标签为空或重名不阻止保存子 Project，只在它被作为 Subcircuit 加载时校验并报错；
- 画布形状是左进右出的矩形，输入 Port 在左、输出 Port 在右，高度由端口数决定，内部元件的摆放位置不影响外部形状。

### 仿真在加载时展平

- Subcircuit 不进入引擎。加载父 Project 时，每个 Subcircuit 的内部元件和 Connection 被复制为普通元件加入引擎，外部 Port 上的 Connection 改接到内部 Input 的 `out` 或 Output 的 `in`；
- 编辑器的 ID 映射从一对一变为一对多：一个 Subcircuit Editor ID 对应一组 Engine ID；
- 引擎和协议不为此切片新增请求类型。

### 顶层对象与扁平对象的来源映射

- 父 Project 的顶层 `Component` 和 `Connection` 仍保留在 EditorDocument 中，不把扁平副本伪装成新的顶层对象。普通 Component/Connection 通常各自对应一个扁平对象；一个已解析的 Subcircuit Component 可以对应其递归子树中的多个扁平 Component，一个顶层 Connection 也可以因边界端口展开为多个扁平 Connection；未解析的 Subcircuit 没有可推送的扁平对象；
- 来源映射使用稳定的扁平身份，而不是引擎分配的数字 ID。它必须能在多次使用同一子 Project 时区分 occurrence，并支持一次重载替换某个 Subcircuit 所拥有的整棵扁平子树。具体的 `sources.components`、`sources.connections` 与 owner 归属规则见 [ADR 0022](0022-hierarchy-flattening-projection.md)；
- 映射细化到顶层 Subcircuit 的每个 Port：外部输入 Port 记录全部 `inputTargets` 内部端点，外部输出 Port 记录按稳定顺序的全部 `outputSources` 内部端点。仿真读取和驱动都通过这个 Port 级映射完成，不能只保存一个 Component 级的模糊来源；
- 子 Project 中 Input 直接连到 Output 时，不创建虚假的内部边界 Connection，也不把两个边界元件推入引擎。展平器保留并逐层解析输入来源别名：存在内部目标时仍通过 `inputTargets` 驱动；纯直通时，外部输入和输出的 `outputSources` 都指向最终可读的上游扁平端点。这条直通边界仍然是有效接口，但不会凭空增加引擎对象。

### 采用快照，手动重载

- 父 Project 打开或一次重载成功后，采用一份一致的层次快照：当前父文档、已读取的子 Project 内容、端口缓存和扁平投影作为同一次提交使用。之后磁盘上的子 Project 变化，以及其他文档中的未保存变化，都不会自动改变这份快照；
- "重新加载子电路"是重新读取磁盘并递归构造新快照的唯一触发点。新的扁平投影、来源映射、引擎绑定和端口按名字匹配结果以一个可撤销历史帧原子替换；解析失败也只能以完整的未解析状态采用，不能留下半成品子树。该同步语义由 [ADR 0018](0018-subproject-changes-do-not-propagate-automatically.md) 进一步说明。

## 未采用的方案

### 快照拷贝子 Project 内容

不采用。用户修改 ALU 后期望所有使用处随之更新；拷贝会产生多份不再同步的副本，且父文件体积随嵌套层数膨胀。

### 引擎原生层次（新增 `ComponentKind::Subcircuit`）

不采用（现阶段）。它要求引擎先引入数据驱动的端口列表、递归求值和"定义子电路"的协议请求，改动跨三个模块。展平让组合环路检测、fan-out 规则和 DFlipFlop 状态自动正确。若将来需要引擎级层次（例如按层次报错、实例内部信号查询），展平层可以整体删除而不留残余。

### 允许在子 Project 中为每个 Port 指定外部边（上下左右）

不采用（现阶段）。现有渲染没有旋转和"边"的概念，四边布置要先引入这些概念。左进右出矩形正是现有渲染路径已经支持的形状。将来加入"外部边"只是接口上多一个可选属性，不推翻本决策。

### 打开父 Project 时监听子 Project 文件并自动重载

不采用。自动重载会在用户编辑中途改变端口列表并使 Connection 悬空，用户无法预期。

## 后果

- Phase 5 的项目文件格式必须带版本字段，Component 记录必须能承载按类型扩展的数据（引用路径、缓存端口清单、显式端口顺序）；
- `ComponentDefinition` 的端口列表和尺寸从常量变为可按数据计算，现有内置元件不受影响；
- 检查器显示 Subcircuit 的引用路径、解析状态和端口清单；第一版不支持下钻编辑子 Project，也不显示实例内部信号；
- 展平后的性能基准需要按展平后的元件数计算，而不是画布上可见的元件数；
- 本决策不引入多位 Port 或总线；Port 保持有序列表，将来总线只是让单个 Port 变宽，形状规则不变。该预期由 [ADR 0015](0015-width-as-port-attribute.md) 在 Phase 4.5 兑现：位宽成为 Port 的属性，端口清单仍是同一个有序列表，只是每项多一个位宽。
