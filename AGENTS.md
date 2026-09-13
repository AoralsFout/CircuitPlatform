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
