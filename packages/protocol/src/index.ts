export type Signal = 0 | 1 | "X";

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
