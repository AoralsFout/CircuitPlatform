# ADR 0004：使用 JSON Lines 暴露单会话引擎协议

## 状态

已接受

## 背景

Electron 需要调用 C++ 引擎，同时保持 Circuit 结构和 Simulation 运行状态。若每次调用都创建新进程，结构和输入状态会丢失；若把 C++ 领域对象直接暴露给桌面层，模块边界会变得难以测试和替换。

## 决策

使用 stdin/stdout 上的 JSON Lines 协议，并由 Electron 主进程持有一个长连接客户端。C++ 主程序在进程生命周期内保存 `Circuit`，通过明确的请求处理器调用领域接口；Electron 渲染进程只通过 preload 暴露的业务方法访问主进程。

当前结构变化后重建 Simulation 快照，作为第一版简单且可解释的运行时规则。（**已由 [ADR 0019](0019-tick-driven-by-protocol-and-state-kept-by-identity.md) 修订**：结构变更改为按元件身份保留运行时状态，见下文「后续变更」。）

## 结果

- 可以用管道直接复现协议交互，便于调试和集成测试；
- `requestId` 让客户端可以安全匹配异步响应；
- 协议层、桌面桥接层和仿真核心可以分别测试；
- 当前结构修改会重置运行时状态，后续需要在引入时序逻辑前明确更细的 reset 语义（**已由 [ADR 0019](0019-tick-driven-by-protocol-and-state-kept-by-identity.md) 兑现**：结构变更保留状态，`reset` 是独立的显式请求）；
- 需要同步维护 TypeScript 类型、C++ 处理器和协议文档。

## 后续变更

2026-09-18 在 Phase 4 落地：本 ADR 关于「结构变化后重建 `Simulation` 快照」的那条第一版规则被 [ADR 0019](0019-tick-driven-by-protocol-and-state-kept-by-identity.md) 修订。

修订的原因是时序逻辑：只有组合逻辑时，重建的代价是「输入被重置」这种可以忍受的小事；引入 D Flip-Flop 之后，它变成「删掉一个无关的 Output 也会把触发器里保存的位清空」。现在结构变更按元件身份重新推导仿真状态——仍然存在的 `PortId` 保留当前值，消失的连同它的值一起丢弃，新出现的按初始值建立，仍然存在的 DFlipFlop 保留它的 `q` 与时钟前值。清空全部运行时状态改由一条独立的 `reset` 请求表达，两者因此可以分别测试。

本 ADR 关于 JSON Lines 单会话协议、`requestId` 匹配与长连接客户端的决策不受影响：引擎进程仍然在整个生命周期内持有一份 `Circuit` 和一份仿真状态，结构变更与 `reset` 都只是这份状态上的动作。

