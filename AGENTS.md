# CircuitPlatform 工程约定

## 项目目标

CircuitPlatform 是一个可运行、可验证、可演进的数字电路仿真应用。任何开发任务都应同时关注功能结果、工程质量和可维护性。

## 工作要求

1. 优先保持模块接口小而清晰，把复杂行为封装在模块内部。
2. 修改代码时同步考虑测试、文档和错误处理。
3. 不跨越任务范围修改无关模块。
4. 重要设计选择记录在 `docs/decisions/` 中。
5. 交付时说明完成内容、验证结果、未完成内容和建议的下一步。
6. 编写或修改函数时，遵守 [协作约定](docs/ai/working-agreement.md) 中的注释规范。

## 目录职责

- `apps/desktop/`：Electron、Vue 和 TypeScript 桌面应用。
- `packages/protocol/`：前端和 C++ 引擎共享的消息协议类型。
- `engine/`：C++ 数字电路仿真引擎。
- `docs/`：项目、架构和协作文档。

## Agent skills

### Issue tracker

Issues 和规格使用 `AoralsFout/CircuitPlatform` 的 GitHub Issues 管理。参见 `docs/agents/issue-tracker.md`。

所有 GitHub 读取和写入操作都使用 `gh` CLI。禁止通过浏览器或浏览器自动化操作 GitHub。在受限执行环境中，直接使用工具提供的提权或沙箱外执行方式运行 `gh`，确保它可以读取用户级 GitHub CLI 配置并访问网络；如果 `gh` 尚未授权，按相同方式运行 `gh auth login`，并由用户完成设备授权。

### Triage labels

使用五种标准 triage 标签：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human` 和 `wontfix`。参见 `docs/agents/triage-labels.md`。

### Domain docs

项目采用单上下文领域文档布局：根目录 `CONTEXT.md` 与 `docs/decisions/`。参见 `docs/agents/domain.md`。
