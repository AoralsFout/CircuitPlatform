export type Signal = 0 | 1 | "X";

/** 电路中一个输出端口的当前信号；`ticked` 用它一次带回全部读数。 */
export interface SignalSnapshot {
  componentId: number;
  port: string;
  value: Signal;
}

export type ComponentKindName =
  | "input"
  | "output"
  | "and"
  | "or"
  | "nand"
  | "nor"
  | "xor"
  | "xnor"
  | "not"
  | "clock"
  | "d_flip_flop";

export interface HealthCheckRequest {
  type: "health_check";
  requestId: string;
}

export interface HealthCheckResponse {
  type: "health_check_result";
  requestId: string;
  status: "ok";
  engine: string;
}

export interface ComponentAddedResponse {
  type: "component_added";
  requestId: string;
  componentId: number;
}

export interface ConnectionAddedResponse {
  type: "connection_added";
  requestId: string;
  connectionId: number;
}

export interface ComponentRemovedResponse {
  type: "component_removed";
  requestId: string;
  componentId: number;
}

export interface ConnectionRemovedResponse {
  type: "connection_removed";
  requestId: string;
  connectionId: number;
}

export interface InputSetResponse {
  type: "input_set";
  requestId: string;
}

export interface SettledResponse {
  type: "settled";
  requestId: string;
  status: "ok";
}

export interface TickedResponse {
  type: "ticked";
  requestId: string;
  /** 本次推进之后的累计步数。 */
  step: number;
  /** 电路中每一个输出端口的当前值；接收端由前端沿 Connection 推导。 */
  signals: readonly SignalSnapshot[];
}

export interface AddComponentRequest {
  type: "add_component";
  requestId: string;
  kind: ComponentKindName;
}

export interface AddConnectionRequest {
  type: "add_connection";
  requestId: string;
  sourceComponentId: number;
  sourcePort: string;
  targetComponentId: number;
  targetPort: string;
}

export interface RemoveComponentRequest {
  type: "remove_component";
  requestId: string;
  componentId: number;
}

export interface RemoveConnectionRequest {
  type: "remove_connection";
  requestId: string;
  connectionId: number;
}

export interface SetInputRequest {
  type: "set_input";
  requestId: string;
  componentId: number;
  value: Signal;
}

export interface SettleRequest {
  type: "settle";
  requestId: string;
}

export interface TickRequest {
  type: "tick";
  requestId: string;
}

export interface GetSignalRequest {
  type: "get_signal";
  requestId: string;
  componentId: number;
  port: string;
}

export type EngineRequest =
  | HealthCheckRequest
  | AddComponentRequest
  | AddConnectionRequest
  | RemoveComponentRequest
  | RemoveConnectionRequest
  | SetInputRequest
  | SettleRequest
  | TickRequest
  | GetSignalRequest;

export interface ErrorResponse {
  type: "error";
  requestId: string;
  code: string;
  message: string;
}

export interface SignalResponse {
  type: "signal_result";
  requestId: string;
  value: Signal;
}

export type EngineResponse =
  | HealthCheckResponse
  | ComponentAddedResponse
  | ConnectionAddedResponse
  | ComponentRemovedResponse
  | ConnectionRemovedResponse
  | InputSetResponse
  | SettledResponse
  | TickedResponse
  | SignalResponse
  | ErrorResponse;

/**
 * 创建发送给 C++ 引擎的健康检查请求。
 * @param requestId 用于匹配请求和响应的调用方身份。
 * @returns 一个可发送给引擎的健康检查请求。
 */
export function createHealthCheck(requestId: string): HealthCheckRequest {
  return {
    type: "health_check",
    requestId,
  };
}

/**
 * 创建删除 Component 的请求。
 * @param requestId 用于匹配请求和响应的调用方身份。
 * @param componentId 要删除的 Component 身份。
 * @returns 一个可发送给 C++ 引擎的删除 Component 请求。
 */
export function createRemoveComponent(
  requestId: string,
  componentId: number,
): RemoveComponentRequest {
  return {
    type: "remove_component",
    requestId,
    componentId,
  };
}

/**
 * 创建删除 Connection 的请求。
 * @param requestId 用于匹配请求和响应的调用方身份。
 * @param connectionId 要删除的 Connection 身份。
 * @returns 一个可发送给 C++ 引擎的删除 Connection 请求。
 */
export function createRemoveConnection(
  requestId: string,
  connectionId: number,
): RemoveConnectionRequest {
  return {
    type: "remove_connection",
    requestId,
    connectionId,
  };
}

/**
 * 创建推进仿真一个 tick 的请求。
 * @param requestId 用于匹配请求和响应的调用方身份。
 * @returns 一个可发送给 C++ 引擎的推进请求。
 */
export function createTick(requestId: string): TickRequest {
  return {
    type: "tick",
    requestId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRequestWithType(value: unknown, type: string): value is Record<string, unknown> {
  return isRecord(value) && value.type === type && typeof value.requestId === "string";
}

function isValidId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * 判断未知值是否为删除 Component 请求。
 * @param value 待检查的未知值。
 * @returns 当 value 包含有效的请求身份和 Component 身份时返回 true。
 */
export function isRemoveComponentRequest(value: unknown): value is RemoveComponentRequest {
  return isRequestWithType(value, "remove_component") && isValidId(value.componentId);
}

/**
 * 判断未知值是否为删除 Connection 请求。
 * @param value 待检查的未知值。
 * @returns 当 value 包含有效的请求身份和 Connection 身份时返回 true。
 */
export function isRemoveConnectionRequest(value: unknown): value is RemoveConnectionRequest {
  return isRequestWithType(value, "remove_connection") && isValidId(value.connectionId);
}

/**
 * 判断未知值是否为删除 Component 的成功响应。
 * @param value 待检查的未知值。
 * @returns 当 value 是带有 Component 身份的删除成功响应时返回 true。
 */
export function isComponentRemovedResponse(value: unknown): value is ComponentRemovedResponse {
  return isRequestWithType(value, "component_removed") && isValidId(value.componentId);
}

/**
 * 判断未知值是否为删除 Connection 的成功响应。
 * @param value 待检查的未知值。
 * @returns 当 value 是带有 Connection 身份的删除成功响应时返回 true。
 */
export function isConnectionRemovedResponse(value: unknown): value is ConnectionRemovedResponse {
  return isRequestWithType(value, "connection_removed") && isValidId(value.connectionId);
}

/**
 * 判断未知值是否属于项目当前支持的数字信号值。
 * @param value 待检查的未知值。
 * @returns 当 value 是 0、1 或 X 时返回 true。
 */
export function isSignal(value: unknown): value is Signal {
  return value === 0 || value === 1 || value === "X";
}

function isSignalSnapshot(value: unknown): value is SignalSnapshot {
  return (
    isRecord(value) &&
    isValidId(value.componentId) &&
    typeof value.port === "string" &&
    isSignal(value.value)
  );
}

/**
 * 判断未知值是否为一次推进的响应。
 * @param value 待检查的未知值。
 * @returns 当 value 带有非负步数和全部合法的输出端口快照时返回 true。
 */
export function isTickedResponse(value: unknown): value is TickedResponse {
  return (
    isRequestWithType(value, "ticked") &&
    typeof value.step === "number" &&
    Number.isSafeInteger(value.step) &&
    value.step >= 0 &&
    Array.isArray(value.signals) &&
    value.signals.every(isSignalSnapshot)
  );
}
