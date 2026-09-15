import type { Point } from "./index.ts";

/** Route 端点外侧的最小终端线段长度。 */
export const ROUTE_TERMINAL_LENGTH = 16;

/** 编辑器默认的世界坐标网格间距。 */
export const ROUTE_GRID_SIZE = 16;

export type RouteAxis = "horizontal" | "vertical";
export type PortOutwardDirection = "left" | "right" | "up" | "down";

export interface RouteOptions {
  sourceDirection?: PortOutwardDirection;
  targetDirection?: PortOutwardDirection;
  terminalLength?: number;
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function axisBetween(left: Point, right: Point): RouteAxis | null {
  if (left.y === right.y && left.x !== right.x) return "horizontal";
  if (left.x === right.x && left.y !== right.y) return "vertical";
  return null;
}

function directionSign(left: Point, right: Point, axis: RouteAxis): number {
  const delta = axis === "horizontal" ? right.x - left.x : right.y - left.y;
  return Math.sign(delta);
}

function outwardPoint(point: Point, direction: PortOutwardDirection, distance: number): Point {
  if (direction === "left") return { x: point.x - distance, y: point.y };
  if (direction === "up") return { x: point.x, y: point.y - distance };
  if (direction === "down") return { x: point.x, y: point.y + distance };
  return { x: point.x + distance, y: point.y };
}

function connectOrthogonally(start: Point, end: Point, preferredAxis: RouteAxis = "horizontal"): Point[] {
  if (samePoint(start, end)) return [{ ...start }];
  if (axisBetween(start, end)) return [{ ...start }, { ...end }];
  const bend = preferredAxis === "horizontal"
    ? { x: end.x, y: start.y }
    : { x: start.x, y: end.y };
  return [{ ...start }, bend, { ...end }];
}

/**
 * 规范化正交 Route，只移除重复点和同向共线的中间点。
 * @param points 要规范化的世界坐标点序列。
 * @returns 新数组；不会删除反向回折，也不会重排用户点。
 */
export function normalizeOrthogonalRoute(points: readonly Point[]): Point[] {
  if (points.length === 0) return [];
  const deduplicated: Point[] = [];
  for (const point of points) {
    const copy = { ...point };
    const previous = deduplicated.at(-1);
    if (!previous) {
      deduplicated.push(copy);
      continue;
    }
    if (samePoint(previous, copy)) continue;
    if (previous.x !== copy.x && previous.y !== copy.y) deduplicated.push({ x: copy.x, y: previous.y });
    deduplicated.push(copy);
  }
  const normalized: Point[] = [];
  for (const point of deduplicated) {
    normalized.push(point);
    while (normalized.length >= 3) {
      const previous = normalized.at(-3)!;
      const middle = normalized.at(-2)!;
      const next = normalized.at(-1)!;
      const incoming = axisBetween(previous, middle);
      const outgoing = axisBetween(middle, next);
      if (!incoming || incoming !== outgoing || directionSign(previous, middle, incoming) !== directionSign(middle, next, outgoing)) break;
      normalized.splice(normalized.length - 2, 1);
    }
  }
  return normalized;
}

/**
 * 生成带端点终端线段的默认正交 Route。
 * @param start source Port 世界坐标。
 * @param end target Port 世界坐标。
 * @param options 端口朝外方向和最小终端长度。
 * @returns 首尾为端点、每段水平或垂直的 Route。
 */
export function createDefaultOrthogonalRoute(start: Point, end: Point, options: RouteOptions = {}): Point[] {
  const distance = Math.max(0, options.terminalLength ?? ROUTE_TERMINAL_LENGTH);
  const sourceDirection = options.sourceDirection ?? "right";
  const targetDirection = options.targetDirection ?? "left";
  const sourceTerminal = outwardPoint(start, sourceDirection, distance);
  const targetTerminal = outwardPoint(end, targetDirection, distance);
  const route: Point[] = [{ ...start }, sourceTerminal];
  const middle = connectOrthogonally(sourceTerminal, targetTerminal, "horizontal");
  route.push(...middle.slice(1, -1));
  route.push(targetTerminal, { ...end });
  return normalizeOrthogonalRoute(route);
}

/**
 * 将内部 Waypoint 连接为完整正交 Route；Waypoint 坐标不会被吸附或重排。
 * @param start Route 起点。
 * @param end Route 终点。
 * @param waypoints 有序内部折点。
 * @returns 含端点的完整 Route。
 */
export function routeFromWaypoints(start: Point, end: Point, waypoints: readonly Point[]): Point[] {
  if (waypoints.length === 0) return createDefaultOrthogonalRoute(start, end);
  const route: Point[] = [{ ...start }];
  let previous = start;
  let axis: RouteAxis = "horizontal";
  for (const waypoint of waypoints) {
    const bridge = connectOrthogonally(previous, waypoint, axis);
    route.push(...bridge.slice(1));
    previous = waypoint;
    axis = axis === "horizontal" ? "vertical" : "horizontal";
  }
  route.push(...connectOrthogonally(previous, end, axis).slice(1));
  return normalizeOrthogonalRoute(route);
}

/** 将鼠标坐标吸附到世界网格；Alt 临时关闭吸附。 */
export function snapRoutePoint(point: Point, altKey = false, gridSize = ROUTE_GRID_SIZE): Point {
  if (altKey || gridSize <= 0) return { ...point };
  return { x: Math.round(point.x / gridSize) * gridSize, y: Math.round(point.y / gridSize) * gridSize };
}

/**
 * 拖动内部折点，并同步调整两侧相邻点以维持正交几何。
 * @param route 完整 Route。
 * @param pointIndex 要拖动的内部点下标（不能是端点）。
 * @param delta 世界坐标位移。
 * @param altKey 是否关闭网格吸附。
 * @returns 编辑后的规范化 Route；非法下标原样复制。
 */
export function moveRouteWaypoint(route: readonly Point[], pointIndex: number, delta: Point, altKey = false): Point[] {
  if (pointIndex <= 0 || pointIndex >= route.length - 1) return route.map((point) => ({ ...point }));
  const next = route.map((point) => ({ ...point }));
  const original = next[pointIndex];
  const moved = snapRoutePoint({ x: original.x + delta.x, y: original.y + delta.y }, altKey);
  const incoming = axisBetween(next[pointIndex - 1], original);
  const outgoing = axisBetween(original, next[pointIndex + 1]);
  // 端点坐标由 Port 决定，靠近 Port 的折点只能沿终端段方向移动。
  if (pointIndex - 1 === 0) {
    if (incoming === "horizontal") moved.y = original.y;
    else if (incoming === "vertical") moved.x = original.x;
  }
  if (pointIndex + 1 === next.length - 1) {
    if (outgoing === "horizontal") moved.y = original.y;
    else if (outgoing === "vertical") moved.x = original.x;
  }
  next[pointIndex] = moved;
  if (incoming === "horizontal" && pointIndex - 1 > 0) next[pointIndex - 1].y = moved.y;
  else if (incoming === "vertical" && pointIndex - 1 > 0) next[pointIndex - 1].x = moved.x;
  if (outgoing === "horizontal" && pointIndex + 1 < next.length - 1) next[pointIndex + 1].y = moved.y;
  else if (outgoing === "vertical" && pointIndex + 1 < next.length - 1) next[pointIndex + 1].x = moved.x;
  return normalizeOrthogonalRoute(next);
}

/**
 * 移动一条水平/垂直线段；连接 Port 的首尾终端线段固定，不允许拖动。
 * @param route 完整 Route。
 * @param segmentIndex 线段起点下标。
 * @param offset 沿线段法向的位移（另一轴的分量被忽略）。
 * @param altKey 是否关闭网格吸附。
 * @returns 编辑后的规范化 Route。
 */
export function moveRouteSegment(route: readonly Point[], segmentIndex: number, offset: Point, altKey = false): Point[] {
  if (segmentIndex < 0 || segmentIndex >= route.length - 1) return route.map((point) => ({ ...point }));
  const result = route.map((point) => ({ ...point }));
  const start = result[segmentIndex];
  const end = result[segmentIndex + 1];
  const axis = axisBetween(start, end);
  if (!axis) return result;
  if (segmentIndex === 0 || segmentIndex === result.length - 2) return result;
  const requested = axis === "horizontal" ? offset.y : offset.x;
  const amount = snapRoutePoint({ x: requested, y: requested }, altKey).x;
  if (amount === 0) return result;
  if (axis === "horizontal") {
    result[segmentIndex].y += amount;
    result[segmentIndex + 1].y += amount;
  } else {
    result[segmentIndex].x += amount;
    result[segmentIndex + 1].x += amount;
  }
  return normalizeOrthogonalRoute(result);
}

/** 在无法直接移动的线段旁插入两个折点，保留原端点和方向。 */
export function insertRouteDetour(route: readonly Point[], segmentIndex: number, offset: number, altKey = false): Point[] {
  if (segmentIndex < 0 || segmentIndex >= route.length - 1) return route.map((point) => ({ ...point }));
  const result = route.map((point) => ({ ...point }));
  const start = result[segmentIndex];
  const end = result[segmentIndex + 1];
  const axis = axisBetween(start, end);
  if (!axis) return result;
  const amount = axis === "horizontal" ? snapRoutePoint({ x: offset, y: offset }, altKey).x : snapRoutePoint({ x: offset, y: offset }, altKey).x;
  if (axis === "horizontal") {
    result.splice(segmentIndex + 1, 0, { x: start.x, y: start.y + amount }, { x: end.x, y: end.y + amount });
  } else {
    result.splice(segmentIndex + 1, 0, { x: start.x + amount, y: start.y }, { x: end.x + amount, y: end.y });
  }
  return normalizeOrthogonalRoute(result);
}

/** 删除一个内部折点；相邻斜接会补一个正交桥接点。 */
export function deleteRouteWaypoint(route: readonly Point[], pointIndex: number): Point[] {
  if (pointIndex <= 0 || pointIndex >= route.length - 1) return route.map((point) => ({ ...point }));
  const next = route.map((point) => ({ ...point }));
  next.splice(pointIndex, 1);
  const previous = next[pointIndex - 1];
  const following = next[pointIndex];
  if (previous && following && !axisBetween(previous, following) && !samePoint(previous, following)) {
    next.splice(pointIndex, 0, { x: following.x, y: previous.y });
  }
  return normalizeOrthogonalRoute(next);
}

/** 重建无用户 Waypoint 的默认 Route。 */
export function resetOrthogonalRoute(start: Point, end: Point, options: RouteOptions = {}): Point[] {
  return createDefaultOrthogonalRoute(start, end, options);
}

/** 判断 Route 是否每一段都符合正交约束。 */
export function isOrthogonalRoute(route: readonly Point[]): boolean {
  return route.every((point, index) => index === 0 || Boolean(axisBetween(route[index - 1], point)) || samePoint(route[index - 1], point));
}
