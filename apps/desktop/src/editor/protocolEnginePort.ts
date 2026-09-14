import type { EngineResponse } from "@circuit-platform/protocol";
import type { EngineAdapter } from "../workspace";
import type { CircuitEnginePort, EngineError, EngineResult } from ".";

function protocolError(response: Extract<EngineResponse, { type: "error" }>): EngineError {
  return { code: response.code, message: response.message, retryable: true };
}

function unexpectedResponse(response: EngineResponse): EngineError {
  return {
    code: "unexpected_engine_response",
    message: `引擎返回了意外响应：${response.type}`,
    retryable: true,
  };
}

async function call<T>(action: () => Promise<EngineResponse>, read: (response: EngineResponse) => T | null): Promise<EngineResult<T>> {
  try {
    const response = await action();
    if (response.type === "error") return { ok: false, error: protocolError(response) };
    const value = read(response);
    return value === null
      ? { ok: false, error: unexpectedResponse(response) }
      : { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "engine_operation_failed",
        message: error instanceof Error ? error.message : "仿真引擎操作失败。",
        retryable: true,
      },
    };
  }
}

/**
 * 把 Electron 协议 adapter 收窄为 EditorSession 所需的结构编辑端口。
 * @param adapter 生产 Electron adapter 或测试 fake。
 * @returns 统一错误形态且不向编辑器泄露协议响应的端口。
 */
export function createProtocolEnginePort(adapter: EngineAdapter): CircuitEnginePort {
  return {
    addComponent: (kind) => call(
      () => adapter.addComponent(kind),
      (response) => response.type === "component_added" ? { componentId: response.componentId } : null,
    ),
    addConnection: (input) => call(
      () => adapter.addConnection(
        { componentId: input.sourceComponentId, port: input.sourcePort },
        { componentId: input.targetComponentId, port: input.targetPort },
      ),
      (response) => response.type === "connection_added" ? { connectionId: response.connectionId } : null,
    ),
    removeComponent: (componentId) => call(
      () => adapter.removeComponent(componentId),
      (response) => response.type === "component_removed" ? { componentId: response.componentId } : null,
    ),
    removeConnection: (connectionId) => call(
      () => adapter.removeConnection(connectionId),
      (response) => response.type === "connection_removed" ? { connectionId: response.connectionId } : null,
    ),
  };
}
