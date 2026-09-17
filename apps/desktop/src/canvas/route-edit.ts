import type { Point } from "../editor";
import { moveRouteSegment, moveRouteWaypoint } from "../editor/route.ts";

export type RouteEditTarget =
  | { kind: "waypoint"; index: number }
  | { kind: "segment"; index: number };

export interface RouteEditPreview {
  connectionId: string;
  route: readonly Point[];
}

export interface RouteEditControllerOptions {
  onPreview(preview: RouteEditPreview): void;
  onCommit(preview: RouteEditPreview): void;
  onCancel?(): void;
  requestFrame?(callback: FrameRequestCallback): number;
  cancelFrame?(handle: number): void;
}

function requestFrame(callback: FrameRequestCallback): number {
  if (typeof globalThis.requestAnimationFrame === "function") return globalThis.requestAnimationFrame(callback);
  return setTimeout(() => callback(Date.now()), 0) as unknown as number;
}

function cancelFrame(handle: number): void {
  if (typeof globalThis.cancelAnimationFrame === "function") globalThis.cancelAnimationFrame(handle);
  else clearTimeout(handle);
}

function sameRoute(left: readonly Point[], right: readonly Point[]): boolean {
  return left.length === right.length && left.every((point, index) => point.x === right[index].x && point.y === right[index].y);
}

/**
 * 创建 Wire Route 的 RAF 合并拖动控制器。
 * pointer move 只更新临时预览，释放时提交一次编辑器历史命令。
 */
export function createRouteEditController(options: RouteEditControllerOptions) {
  const scheduleFrame = options.requestFrame ?? requestFrame;
  const stopFrame = options.cancelFrame ?? cancelFrame;
  let active: { connectionId: string; route: Point[]; startRoute: Point[]; target: RouteEditTarget; start: Point; current: Point; altKey: boolean } | null = null;
  let frame: number | null = null;

  const flush = (): void => {
    frame = null;
    if (!active) return;
    const delta = { x: active.current.x - active.start.x, y: active.current.y - active.start.y };
    active.route = active.target.kind === "waypoint"
      ? moveRouteWaypoint(active.startRoute, active.target.index, delta, active.altKey)
      : moveRouteSegment(active.startRoute, active.target.index, delta, active.altKey);
    options.onPreview({ connectionId: active.connectionId, route: active.route.map((point) => ({ ...point })) });
  };

  const schedule = (): void => {
    if (frame === null) frame = scheduleFrame(() => flush());
  };

  return {
    /** 开始一次折点或线段拖动。 */
    start(connectionId: string, route: readonly Point[], target: RouteEditTarget, pointerWorld: Point): void {
      if (frame !== null) stopFrame(frame);
      frame = null;
      active = {
        connectionId,
        route: route.map((point) => ({ ...point })),
        startRoute: route.map((point) => ({ ...point })),
        target,
        start: { ...pointerWorld },
        current: { ...pointerWorld },
        altKey: false,
      };
    },
    /** 覆盖当前指针位置，下一帧只发布一次预览。 */
    move(pointerWorld: Point, altKey = false): void {
      if (!active) return;
      active.current = { ...pointerWorld };
      active.altKey = altKey;
      schedule();
    },
    /**
     * 刷新最终预览并提交一条 Route 历史命令。
     * 无论是否提交都会调用 `onCommit` 或 `onCancel` 之一，调用者据此清掉临时预览。
     */
    end(): void {
      if (!active) return;
      if (frame !== null) stopFrame(frame);
      frame = null;
      flush();
      const completed = active;
      active = null;
      if (!sameRoute(completed.startRoute, completed.route)) {
        options.onCommit({ connectionId: completed.connectionId, route: completed.route });
        return;
      }
      // 路由没有实际改变时同样结束了一次编辑，预览必须被回收。
      options.onCancel?.();
    },
    /** 取消当前临时编辑，不写入历史。 */
    cancel(): void {
      if (frame !== null) stopFrame(frame);
      frame = null;
      active = null;
      options.onCancel?.();
    },
    isEditing(): boolean {
      return active !== null;
    },
  };
}

export type RouteEditController = ReturnType<typeof createRouteEditController>;
