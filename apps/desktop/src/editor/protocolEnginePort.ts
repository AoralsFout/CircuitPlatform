import type { EngineResponse } from "@circuit-platform/protocol";
import type { EngineAdapter } from "../workspace";
import type { EngineCallQueue } from "../workspace/engineQueue.ts";
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

async function serializedCall<T>(
  queue: EngineCallQueue,
  action: () => Promise<EngineResponse>,
  read: (response: EngineResponse) => T | null,
): Promise<EngineResult<T>> {
  try {
    const response = await queue.enqueue(action);
    if (response.type === "error") return { ok: false, error: protocolError(response) };
    const value = read(response);
    return value === null
      ? { ok: false, error: unexpectedResponse(response) }
      : { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      error: {
        // 请求未得到协议响应时，Circuit 可能仍在引擎外部；让会话冻结结构事务，
        // 同时保留可重试的本地编辑器状态。协议内的业务 error 不走此分支。
        code: "engine_unavailable",
        message: error instanceof Error ? error.message : "仿真引擎操作失败。",
        retryable: true,
      },
    };
  }
}

/**
 * 把 Electron 协议 adapter 收窄为 EditorSession 所需的结构编辑端口。
 *
 * 每一次调用都排进传入的队列：编辑器的结构提交与工作区的推进、输入提交因此排在同一个队里，
 * 任意两条请求不交错。队列是必填参数而不是可选项——编辑器是另一条独立的引擎调用路径，
 * 少了这个参数，结构提交就又跑到队列外面去与在飞的 tick 并发了。
 * @param adapter 生产 Electron adapter 或测试 fake。
 * @param queue 与工作区共用的同一条引擎调用队列。
 * @returns 统一错误形态且不向编辑器泄露协议响应的端口。
 */
export function createProtocolEnginePort(adapter: EngineAdapter, queue: EngineCallQueue): CircuitEnginePort {
  const call = <T>(
    action: () => Promise<EngineResponse>,
    read: (response: EngineResponse) => T | null,
  ): Promise<EngineResult<T>> => serializedCall(queue, action, read);
  return {
    addComponent: (kind, ports) => call(
      () => adapter.addComponent(kind, ports),
      // 端口清单随响应进入调用方：它是端口名与位宽的唯一权威来源，前端不再内置一份副本。
      (response) => response.type === "component_added"
        ? { componentId: response.componentId, ports: response.ports }
        : null,
    ),
    setPortWidth: (componentId, ports) => call(
      () => adapter.setPortWidth(componentId, ports),
      (response) => response.type === "port_width_set"
        ? { ports: response.ports, danglingConnectionIds: response.danglingConnectionIds }
        : null,
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
    settle: () => call(
      () => adapter.settle(),
      (response) => response.type === "settled" ? { status: "ok" as const } : null,
    ),
  };
}
