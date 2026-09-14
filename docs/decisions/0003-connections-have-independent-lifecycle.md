# ADR 0003：Connection 独立于 Component 生命周期

删除元件时保留相关 Connection，使 Connection 可以成为悬空连接。这样可以分别操作元件和连接，保留用户的编辑意图，也让“删除元件”和“删除连接”成为两个清晰的领域操作；悬空连接不会参与仿真，但可以被查看、删除或重新连接。

## 输入端占用规则

`Circuit::addConnection` 只有在目标输入端存在一条两端均有效的 live Connection 时才返回 `InputAlreadyConnected`。如果旧 Connection 的来源或目标元件已经删除，它仍保留在 Circuit 中并由 `isDangling` 识别，但不再占用目标输入端，因此可以先连接新的有效来源，再按需清理旧的 dangling Connection。

这一规则保持了 Connection 的独立生命周期，同时避免删除元件后留下的历史连接阻塞编辑器重连。多个有效来源连接到同一有效输入端仍然被拒绝。
