import { normalizeOrthogonalRoute, ROUTE_GRID_SIZE, ROUTE_TERMINAL_LENGTH, snapRoutePoint, type PortOutwardDirection } from "./route.ts";
import type { Point } from "./index.ts";

/** 连接草稿中可参与匹配的端口；方向是提交时规范化 output → input 的依据。 */
export interface ConnectionDraftPort {
  componentId: string;
  port: string;
  direction: "input" | "output";
  point: Point;
  outward?: PortOutwardDirection;
}

export type ConnectionDraftAxis = "horizontal" | "vertical";
export type ConnectionDraftPhase = "idle" | "drawing" | "failed";

export interface ConnectionDraftError {
  code:
  | "same-port"
  | "same-direction"
  | "input-occupied"
  | "invalid-target"
  | "engine-failed";
  message: string;
}

export interface ConnectionDraftState {
  phase: ConnectionDraftPhase;
  origin: ConnectionDraftPort | null;
  waypoints: readonly Point[];
  cursor: Point | null;
  axis: ConnectionDraftAxis;
  /** 释放到空白处后仍保留的首个折点；用于区分拖拽直连与持续点击布线。 */
  hasPlacedFirstWaypoint: boolean;
  error: ConnectionDraftError | null;
  /** 重接/修复模式下沿用的稳定 Editor Connection ID；创建新连接时为空。 */
  connectionId?: string | null;
}

export type ConnectionDraftAction =
  | { type: "start"; port: ConnectionDraftPort; connectionId?: string }
  | { type: "move"; point: Point; altKey?: boolean }
  | { type: "place-waypoint"; point: Point; altKey?: boolean }
  | { type: "toggle-axis" }
  | { type: "remove-waypoint" }
  | { type: "fail"; error: ConnectionDraftError }
  | { type: "clear-error" }
  | { type: "cancel" };

export interface ConnectionDraftOptions {
  gridSize?: number;
  terminalLength?: number;
}

export const EMPTY_CONNECTION_DRAFT: ConnectionDraftState = {
  phase: "idle",
  origin: null,
  waypoints: [],
  cursor: null,
  axis: "horizontal",
  hasPlacedFirstWaypoint: false,
  error: null,
  connectionId: null,
};

function copyPoint(point: Point): Point {
  return { x: point.x, y: point.y };
}

function copyPort(port: ConnectionDraftPort): ConnectionDraftPort {
  return { ...port, point: copyPoint(port.point) };
}

function copyState(state: ConnectionDraftState): ConnectionDraftState {
  return {
    ...state,
    origin: state.origin ? copyPort(state.origin) : null,
    waypoints: state.waypoints.map(copyPoint),
    cursor: state.cursor ? copyPoint(state.cursor) : null,
    error: state.error ? { ...state.error } : null,
  };
}

function axisPoint(start: Point, end: Point, axis: ConnectionDraftAxis): Point {
  return axis === "horizontal" ? { x: end.x, y: start.y } : { x: start.x, y: end.y };
}

function portTerminal(port: ConnectionDraftPort, distance: number): Point {
  const direction = port.outward ?? (port.direction === "output" ? "right" : "left");
  if (direction === "left") return { x: port.point.x - distance, y: port.point.y };
  if (direction === "up") return { x: port.point.x, y: port.point.y - distance };
  if (direction === "down") return { x: port.point.x, y: port.point.y + distance };
  return { x: port.point.x + distance, y: port.point.y };
}

/** 创建一个尚未开始布线的草稿状态。 */
export function createConnectionDraft(): ConnectionDraftState {
  return copyState(EMPTY_CONNECTION_DRAFT);
}

/** 判断两个端口是否可以成为同一条 Connection 的两端，并返回用户可展示的具体原因。 */
export function validateConnectionDraftTarget(
  origin: ConnectionDraftPort,
  target: ConnectionDraftPort | null | undefined,
  inputOccupied = false,
): ConnectionDraftError | null {
  if (!target) return { code: "invalid-target", message: "请选择一个兼容的输入或输出端口。" };
  if (origin.componentId === target.componentId && origin.port === target.port) {
    return { code: "same-port", message: "不能把端口连接到它自己。" };
  }
  if (origin.direction === target.direction) {
    return { code: "same-direction", message: "连接需要一个输出端口和一个输入端口。" };
  }
  if (inputOccupied && (origin.direction === "input" || target.direction === "input")) {
    return { code: "input-occupied", message: "这个输入端口已经有有效连接。请选择空闲输入端口。" };
  }
  return null;
}

/**
 * 用纯函数推进 ConnectionDraft；移动、加点和 Space 轴向切换只影响临时状态，不写入历史。
 * @param state 当前草稿状态。
 * @param action 指针、点击或键盘产生的动作。
 * @returns 深拷贝后的下一状态，可安全交给 Vue 响应式层。
 */
export function reduceConnectionDraft(
  state: ConnectionDraftState,
  action: ConnectionDraftAction,
  options: ConnectionDraftOptions = {},
): ConnectionDraftState {
  if (action.type === "cancel") return createConnectionDraft();
  if (action.type === "start") {
    return {
      phase: "drawing",
      origin: copyPort(action.port),
      waypoints: [],
      cursor: copyPoint(action.port.point),
      axis: "horizontal",
      hasPlacedFirstWaypoint: false,
      error: null,
      connectionId: action.connectionId ?? null,
    };
  }
  if (state.phase === "idle" || !state.origin) return copyState(state);
  if (action.type === "fail") return { ...copyState(state), phase: "failed", error: { ...action.error } };
  if (action.type === "clear-error") return { ...copyState(state), phase: "drawing", error: null };
  if (action.type === "toggle-axis") return { ...copyState(state), axis: state.axis === "horizontal" ? "vertical" : "horizontal", error: null };
  if (action.type === "remove-waypoint") {
    if (state.waypoints.length === 0) return copyState(state);
    const waypoints = state.waypoints.slice(0, -1);
    return {
      ...copyState(state),
      waypoints,
      cursor: waypoints.at(-1) ? copyPoint(waypoints.at(-1)!) : copyPoint(state.origin.point),
      hasPlacedFirstWaypoint: waypoints.length > 0,
      error: null,
    };
  }
  const gridSize = options.gridSize ?? ROUTE_GRID_SIZE;
  const point = snapRoutePoint(action.point, action.altKey ?? false, gridSize);
  if (action.type === "move") return { ...copyState(state), cursor: point, error: null };
  return {
    ...copyState(state),
    phase: "drawing",
    waypoints: [...state.waypoints, point],
    cursor: point,
    hasPlacedFirstWaypoint: true,
    error: null,
  };
}

/**
 * 计算草稿的正交预览。首段沿端口朝外，空白释放时首个点会被保留为 Waypoint。
 * @param state 当前草稿。
 * @param target 可选的兼容目标端口；提交前也必须再次经过引擎和会话校验。
 * @returns 首尾包含端口、每段水平或垂直的世界坐标点列。
 */
export function connectionDraftRoute(
  state: ConnectionDraftState,
  target?: ConnectionDraftPort | null,
  options: ConnectionDraftOptions = {},
): Point[] {
  if (!state.origin) return [];
  const end = target?.point ?? state.cursor;
  if (!end) return [copyPoint(state.origin.point)];
  const terminalLength = Math.max(ROUTE_TERMINAL_LENGTH, options.terminalLength ?? ROUTE_TERMINAL_LENGTH);
  const originTerminal = portTerminal(state.origin, terminalLength);
  const targetPort = target ?? {
    componentId: "__cursor__",
    port: "__cursor__",
    direction: state.origin.direction === "input" ? "output" : "input",
    point: end,
    outward: state.origin.direction === "input" ? "right" : "left",
  } satisfies ConnectionDraftPort;
  const targetTerminal = portTerminal(targetPort, terminalLength);
  const points: Point[] = [copyPoint(state.origin.point), originTerminal];
  let previous = originTerminal;
  for (const waypoint of state.waypoints) {
    points.push(axisPoint(previous, waypoint, state.axis));
    points.push(copyPoint(waypoint));
    previous = waypoint;
  }
  points.push(axisPoint(previous, targetTerminal, state.axis));
  points.push(targetTerminal, copyPoint(end));
  return normalizeOrthogonalRoute(points);
}

/** 以输出端在前、输入端在后的固定顺序规范化两个端口。 */
export function normalizeConnectionEndpoints(left: ConnectionDraftPort, right: ConnectionDraftPort): {
  source: ConnectionDraftPort;
  target: ConnectionDraftPort;
} {
  return left.direction === "output"
    ? { source: copyPort(left), target: copyPort(right) }
    : { source: copyPort(right), target: copyPort(left) };
}
