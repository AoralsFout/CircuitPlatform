export type Signal = 0 | 1 | "X";

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

export interface InputSetResponse {
  type: "input_set";
  requestId: string;
}

export interface SettledResponse {
  type: "settled";
  requestId: string;
  status: "ok";
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
  | SetInputRequest
  | SettleRequest
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
  | InputSetResponse
  | SettledResponse
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
 * 判断未知值是否属于项目当前支持的数字信号值。
 * @param value 待检查的未知值。
 * @returns 当 value 是 0、1 或 X 时返回 true。
 */
export function isSignal(value: unknown): value is Signal {
  return value === 0 || value === 1 || value === "X";
}
