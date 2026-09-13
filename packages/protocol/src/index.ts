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

export function createHealthCheck(requestId: string): HealthCheckRequest {
  return {
    type: "health_check",
    requestId,
  };
}

export function isSignal(value: unknown): value is Signal {
  return value === 0 || value === 1 || value === "X";
}
