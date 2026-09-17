# 项目路线图

## 当前状态

路线按照“可运行交付物 → 自动化测试 → 复盘”的方式推进。当前状态如下：

- Phase 0：脚手架，已完成；
- Phase 1：领域模型，已完成；
- Phase 2：组合逻辑，已完成；
- Phase 2.5：跨进程协议，已完成；
- Phase 3：图形编辑器，进行中；
- Phase 4：时序逻辑，未开始；
- Phase 5：波形和持久化，未开始；
- Phase 5.5：层次化电路，未开始；
- Phase 6：工程化和发布，未开始。

Phase 0–2.5 已建立 C++ 电路模型、组合逻辑求值、组合环路检测，以及 Electron 与 C++ 引擎之间可复现的 JSON Lines 会话。Phase 3 的前端结构重构已经完成，当前画布仍主要是可运行 AND 示例的编辑器式展示，真正的通用编辑操作按下列切片继续推进。

## Phase 3：图形编辑器

阶段目标是使用 SVG 实现 Component 拖动、选择、连线和属性编辑，同时保持编辑器模型与 `Circuit`、`SimulationState` 的职责分离。Component 位置、选中状态和视觉 Wire 只保存在编辑器模型中；仿真规则仍由 C++ 引擎负责。

### 前端结构重构验收

以下项目属于已经落地的工作区结构和基础体验：

- [x] `App.vue` 只负责页面编排，工作区行为、主题和编辑器局部状态由独立模块管理；
- [x] 引擎 adapter 可由测试 fake 替换，前端行为测试覆盖示例创建、协议错误、输入切换和波形记录；
- [x] 主页面采用顶部项目栏、工具轨道、可折叠侧栏、编辑工具栏、中央画布和底部结果面板的编辑器式结构；
- [x] 画布使用网格、CircuitNode 投影、正交 SVG 连线和选中外轮廓表达电路关系；
- [x] 提供元件库、输入设置、层级、检查器、输出和波形面板的页面入口；
- [x] 支持深色、浅色和跟随系统主题，并持久化用户主题选择；
- [x] 首次启动在引擎可用时创建并运行 AND 示例；
- [x] `0 / 1 / X` 在 Component 投影、端口、连线图例和波形中同时使用文字与语义样式表达；
- [x] 提供“运行一次”、引擎状态、输出结果和波形历史的基础反馈；
- [x] 提供可见键盘焦点和 `prefers-reduced-motion` 样式支持。

以下项目尚未因结构重构而自动完成，不能视为 Phase 3 已完成：

- [ ] 元件库中的元件可以真正添加到画布并维护编辑器位置；
- [ ] 画布支持平移、Component 拖动和端口命中区域；
- [ ] 端口连线调用协议并展示非法连接原因；
- [x] 删除、清空、撤销和重做形成可恢复的编辑操作；
- [ ] 连续运行、暂停和继续仿真具有真实状态转换；
- [ ] 保存和加载项目文件。

### 后续切片顺序

#### 1. 删除协议（已完成）

先补齐 `remove_component` 和 `remove_connection` 的端到端协议，包括 TypeScript 类型、C++ 请求处理、Electron IPC、协议测试和文档。

验收标准：

- 删除 Component 后，领域层保留相关 Connection，并将其识别为 dangling；
- 删除 Connection 不删除两端 Component；
- 结构修改后重建 `Simulation` 快照；
- 悬空连接不参与仿真，但可以查询、删除或重新连接；
- 不存在的身份和缺失字段返回稳定、可展示的错误。

#### 2. 画布删除与撤销（已完成）

将协议删除能力接入编辑器模型，实现 Delete/Backspace 删除选中对象、清空确认以及 Ctrl/Cmd+Z 撤销。编辑器可以把“删除元件并更新相关视觉连线状态”作为一个可恢复的复合命令；底层领域操作仍必须保持 Connection 独立生命周期的规则。

设计采用 `EditorSession` 深模块（见 [ADR 0007](decisions/0007-editor-session-and-stable-editor-ids.md)）：Vue 只使用稳定的 editor ID 和 `deleteSelection()` / `undo()`，不接触临时 engine ID 或原始协议响应。删除 Component 时引擎保留相关 dangling Connection，编辑器在最后端口位置继续显示对应悬空 Wire；撤销先使用新的 engine ID 重建 Component 和 Connection，全部成功后再清理旧 dangling Connection。删除和撤销命令串行执行，协议失败通过补偿处理；补偿失败时进入恢复状态，不静默覆盖编辑器快照。

该设计依赖 ADR 0003 的 dangling Connection 不占用 live 输入端口语义。当前固定 AND 示例已实现单选择删除、带确认的清空事务、撤销和重做；确认前不调用引擎，清空作为单个历史帧提交，部分失败执行补偿，补偿失败进入恢复状态。多选和项目加载沿用同一 Interface 继续扩展。

验收标准：

- 删除 Component 后画布立即更新，相关视觉连线保留并明确显示悬空端点；
- 撤销恢复 Component、位置、属性和相关连接；
- 清空画布需要确认，Esc 可以取消清空确认或当前选择；连接草稿的 Esc 取消随下一切片交付；
- 领域层的 dangling Connection 规则不被 UI 逻辑绕过。

#### 3. 通用画布、添加 Component 与手工布线

按照 [ADR 0008](decisions/0008-layered-canvas-scene-rendering.md) 和 [ADR 0009](decisions/0009-manual-orthogonal-wire-routes.md)，把固定 AND 模板替换为数据驱动的场景投影和共享视口变换，在现有工作区骨架上接入 Component 添加、Component 拖动、画布平移、双向端口连线和可持久化的手工正交 Route。连接创建和画布交互由编辑器控制器负责，仿真由工作区编排层触发；`CircuitNode` 只负责展示和抛出事件。检查器显示只读对象详情，第一版不引入没有实际用例的可编辑属性。

工程上按以下顺序交付，但全部完成后才视为本切片完成：

1. 建立 `ComponentDefinitionRegistry`、世界/屏幕坐标、Route 几何和单元测试；
2. 建立通用 `CanvasScene` 投影、DOM/SVG 分层渲染、视口与 Component 拖动；
3. 完成分级上下文菜单、元件库放置、复制和添加补偿事务；
4. 完成 ConnectionDraft、双向发起、手工 Route 编辑、重接和失败恢复；
5. 补齐键盘操作、截图回归和 500 个 Component / 1,000 条 Wire 的性能基准；
6. 删除固定示例投影，使 AND 示例完全通过通用文档和渲染路径运行。

验收标准：

- 从右键分级菜单或元件库添加的 Component 拥有稳定 Editor ID、独立世界坐标和可撤销历史，移动不会改变仿真结果；
- 用户可以从输入或输出 Port 发起 Connection，并通过点击或拖拽创建、编辑和重接手工正交 Route；
- 非法方向、重复输入和不存在 Port 均显示原因；取消或提交失败保留可恢复路径，不发布半成品快照；
- 删除 Component 后保留的 DanglingConnection 继续显示冻结端点，并可通过悬空端点重接；
- 检查器显示选中 Component 或 Wire 的类型、Port、连接和仿真状态，不重复提供右键“查看属性”；
- 平移、缩放、添加、拖动、布线和 Route 编辑提供键盘等价路径；
- 在 1920×1080、500 个 Component 和 1,000 条 Wire 下连续交互 5 秒，第 95 百分位帧耗时不超过 20ms；
- 类型检查和非视觉自动化测试通过 `pnpm verify`，视觉与性能基准独立执行。

## 后续阶段

### Phase 4：时序逻辑

实现 Clock、D Flip-Flop、离散 tick、上升沿、reset 和状态快照。时序行为完成前，`clock` 和 `d_flip_flop` 只作为结构元件，不应在 UI 中伪装成可运行的时序仿真。

### Phase 5：波形和持久化

实现由仿真状态产生的简单波形、项目文件、版本字段和加载校验。当前前端中的波形历史是示例交互反馈，不能替代这一阶段的持久化和真实时序波形。

项目文件格式设计时必须满足 Phase 5.5 的前提：文件带版本字段，Component 记录能承载按类型扩展的数据（例如 Subcircuit 的引用路径、缓存端口清单和显式端口顺序）。具体字段由本阶段决定。

### Phase 5.5：层次化电路

阶段目标是把一个已保存的 Project 作为 Subcircuit 放入另一份 Circuit 中复用，术语见 `CONTEXT.md`，设计取舍见 [ADR 0014](decisions/0014-subcircuit-by-reference-flattened-simulation.md)。依赖 Phase 4（子 Project 内允许 DFlipFlop）和 Phase 5（项目文件）。

核心规则：

- Subcircuit 按相对路径引用，父 Project 缓存端口清单；文件缺失或校验失败显示为"未解析"并不参与仿真；
- 子 Project 的 Input / Output 元件构成对外 Port，名字取自标签，默认按纵坐标排序，可显式覆盖；不允许 Clock；
- 画布形状为左进右出的矩形，端口间距 32，最小宽度 148，宽度按最长端口名自适应并向上取整到网格；标签显示 Project 文件名；
- 仿真在加载时展平为普通元件，引擎和协议不新增请求类型；
- 允许多层嵌套，引用成环时拒绝加载该 Component；
- 子 Project 变化通过手动"重新加载子电路"命令生效，作为可撤销历史帧；端口按名字匹配，对不上的 Connection 变为悬空。

交付切片，全部完成后才视为本阶段完成：

1. 纯 TypeScript 展平函数与单元测试：输入父文档与子文档，输出扁平元件、Connection 列表和外部 Port 映射，含引用环检测和接口校验（空标签、重名、含 Clock）；
2. `ComponentDefinition` 支持数据驱动的端口列表与尺寸计算，画布按上述形状规则渲染 Subcircuit，Editor ID 到 Engine ID 的映射支持一对多；
3. 元件库新增"子电路"分类，通过文件选择器添加 Subcircuit，支持删除、撤销和重做；
4. 保存加载时的引用解析、端口清单缓存、"未解析"状态、按名字匹配 Connection 和手动重载命令；
5. 端到端：多层嵌套的 ALU 示例 Project 跑通仿真，检查器显示引用路径、解析状态和端口清单，补齐回归测试。

验收标准：

- 同一子 Project 在父 Circuit 中放入多份时，各自独立仿真，DFlipFlop 状态互不影响；
- 修改子 Project 并在父 Project 中重新加载后，名字未变的 Port 上的 Connection 保留，其余变为 DanglingConnection 并可重接；
- 子 Project 文件缺失时父 Project 仍能打开，Subcircuit 以缓存端口显示并标记为未解析；
- 引用成环、空标签、重名标签、内部含 Clock 均给出可展示的原因，不产生半成品快照；
- 展平后达到 500 个 Component / 1,000 条 Wire 时，仍满足 Phase 3 的帧耗时基准；
- 类型检查和非视觉自动化测试通过 `pnpm verify`。

第一版明确不做：下钻编辑子 Project、查看某个 Subcircuit 内部实时信号、四边端口布置、自动扫描库目录。

### Phase 6：工程化和发布

完善 CI、日志、错误处理、打包、发布文档和回归测试。

## 后续方向

以下方向已确认要做，但尚未排入阶段，也没有验收标准。

- **多位 Port 与总线**：让单个 Port 和 Connection 承载多位信号，减少 ALU 这类 Subcircuit 的端口数量。涉及引擎信号值、协议、波形和 Wire 渲染。Subcircuit 的 Port 保持有序列表，总线加入后形状规则不变。
- **多文档与下钻**：同时打开多个 Project，双击 Subcircuit 打开其子 Project；在此基础上以只读方式查看某个 Subcircuit 实例内部的实时信号。这是独立的工作区改动，不与 Phase 5.5 捆绑。

## 阶段交付门槛

每个切片都必须同时提供可运行交付物、自动化测试、必要的协议或架构文档更新，以及对未完成项和下一步的明确记录。
