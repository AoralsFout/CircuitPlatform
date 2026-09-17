import type { Point } from "../editor";

/** CircuitNode 默认使用的世界坐标网格间距。 */
export const NODE_GRID_SIZE = 16;

/** 将节点左上角位置吸附到世界网格；Alt 模式保留指针的精确位置。 */
export function snapNodePosition(position: Point, altKey = false, gridSize = NODE_GRID_SIZE): Point {
  if (altKey || gridSize <= 0) return { ...position };
  return {
    x: Math.round(position.x / gridSize) * gridSize,
    y: Math.round(position.y / gridSize) * gridSize,
  };
}

export interface NodeDragPreview {
  nodeId: string;
  position: Point;
}

export interface NodeDragControllerOptions {
  /** 在一次动画帧中最多调用一次，用于更新临时 InteractionState。 */
  onPreview(preview: NodeDragPreview): void;
  /** 释放后只调用一次；调用者负责提交单个布局历史命令。 */
  onCommit(preview: NodeDragPreview): void;
  /** pointercancel 或 Escape 时调用，不产生历史命令。 */
  onCancel?(): void;
  requestFrame?(callback: FrameRequestCallback): number;
  cancelFrame?(handle: number): void;
}

interface ActiveDrag {
  nodeId: string;
  originalPosition: Point;
  pointerOffset: Point;
  pointerStart: Point;
  pendingPointer: Point;
  pendingPosition: Point;
  pendingAltKey: boolean;
  preview: NodeDragPreview;
}

function defaultRequestFrame(callback: FrameRequestCallback): number {
  if (typeof globalThis.requestAnimationFrame === "function") return globalThis.requestAnimationFrame(callback);
  return setTimeout(() => callback(Date.now()), 0) as unknown as number;
}

function defaultCancelFrame(handle: number): void {
  if (typeof globalThis.cancelAnimationFrame === "function") globalThis.cancelAnimationFrame(handle);
  else clearTimeout(handle);
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

/**
 * 创建节点拖动的临时状态机。
 * pointer move 只覆盖待处理坐标并由 RAF 合并，绝不调用 EditorSession；释放时才提交一次布局意图。
 */
export function createNodeDragController(options: NodeDragControllerOptions) {
  const requestFrame = options.requestFrame ?? defaultRequestFrame;
  const cancelFrame = options.cancelFrame ?? defaultCancelFrame;
  let active: ActiveDrag | null = null;
  let frameHandle: number | null = null;

  const flush = (): void => {
    frameHandle = null;
    if (!active) return;
    const position = snapNodePosition(active.pendingPosition, active.pendingAltKey);
    active.preview = { nodeId: active.nodeId, position };
    options.onPreview(active.preview);
  };

  const schedule = (): void => {
    if (frameHandle !== null) return;
    frameHandle = requestFrame(() => flush());
  };

  return {
    /** 开始拖动；pointerOffset 保持节点相对指针位置，避免节点跳动。 */
    start(nodeId: string, originalPosition: Point, pointerWorld: Point): void {
      if (frameHandle !== null) cancelFrame(frameHandle);
      frameHandle = null;
      active = {
        nodeId,
        originalPosition: { ...originalPosition },
        pointerOffset: { x: pointerWorld.x - originalPosition.x, y: pointerWorld.y - originalPosition.y },
        pointerStart: { ...pointerWorld },
        pendingPointer: { ...pointerWorld },
        pendingPosition: { ...originalPosition },
        pendingAltKey: false,
        preview: { nodeId, position: { ...originalPosition } },
      };
    },
    /** 覆盖本帧待处理位置；多次调用会在下一帧合并为一次预览。 */
    move(pointerWorld: Point, altKey = false): void {
      if (!active) return;
      active.pendingPosition = {
        x: pointerWorld.x - active.pointerOffset.x,
        y: pointerWorld.y - active.pointerOffset.y,
      };
      active.pendingPointer = { ...pointerWorld };
      active.pendingAltKey = altKey;
      schedule();
    },
    /**
     * 刷新最后一次 pointer move 并提交一次；没有实际位移时不产生历史。
     * 无论是否提交都会调用 `onCommit` 或 `onCancel` 之一，调用者据此清掉临时预览。
     */
    end(): void {
      if (!active) return;
      if (frameHandle !== null) cancelFrame(frameHandle);
      frameHandle = null;
      flush();
      const completed = active;
      active = null;
      if (!samePoint(completed.pointerStart, completed.pendingPointer) && !samePoint(completed.originalPosition, completed.preview.position)) {
        options.onCommit(completed.preview);
        return;
      }
      // 没有位移的一次按下同样结束了一次拖动，预览必须被回收。
      options.onCancel?.();
    },
    /** 取消临时预览，不调用提交回调。 */
    cancel(): void {
      if (frameHandle !== null) cancelFrame(frameHandle);
      frameHandle = null;
      active = null;
      options.onCancel?.();
    },
    /** 当前是否处于 pointer drag。 */
    isDragging(): boolean {
      return active !== null;
    },
  };
}

export type NodeDragController = ReturnType<typeof createNodeDragController>;
