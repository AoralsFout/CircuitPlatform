# Domain Docs

本项目采用单上下文领域文档布局。

## 开始探索代码前

1. 阅读仓库根目录的 `CONTEXT.md`。
2. 阅读 `docs/decisions/` 中与当前任务有关的 ADR。
3. 阅读根目录 `AGENTS.md` 和其中引用的协作约定。

如果相关文件不存在，静默继续；不要提前创建空白领域文档。领域术语或重要决策真正形成时，再通过 domain-modeling 流程更新。

## 文件结构

```text
/
├── CONTEXT.md
├── docs/
│   ├── decisions/
│   │   ├── 0001-initial-architecture.md
│   │   └── ...
│   └── agents/
│       ├── issue-tracker.md
│       ├── triage-labels.md
│       └── domain.md
├── apps/
├── packages/
└── engine/
```

`apps/desktop/`、`packages/protocol/` 和 `engine/` 是同一数字电路领域的不同技术模块，不分别建立领域上下文。

## 使用领域词汇

Issue 标题、规格、实现计划、测试名称和代码评审应使用 `CONTEXT.md` 定义的领域语言。

尤其保持以下边界：

- `Component` 是领域元件，不使用 `Node` 作为同义词。
- `Connection` 是领域连接记录。
- `Wire` 只表示 Connection 在编辑器中的视觉投影。
- `Circuit`、编辑器模型和 `SimulationState` 分别保存结构、画布展示和仿真状态。

如果需要的概念尚未进入词汇表，应重新检查是否正在引入不必要的同义词；确有领域缺口时，通过 domain-modeling 补充。

## ADR 冲突

如果新规格或实现与现有 ADR 冲突，必须明确指出，不得静默覆盖：

> 与 ADR 0007 的稳定 Editor ID 决策冲突；建议重新开启该决策，因为……

新的重要设计选择记录在 `docs/decisions/`。
