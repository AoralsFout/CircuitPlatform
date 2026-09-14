import type { Point } from "../editor";

/** 视口允许的缩放范围；用小数表示比例而不是百分数。 */
export const MIN_VIEWPORT_ZOOM = 0.25;
export const MAX_VIEWPORT_ZOOM = 4;
export const DEFAULT_VIEWPORT_ZOOM = 1;
export const DEFAULT_VIEWPORT_PADDING = 64;

export interface ViewportSize {
  width: number;
  height: number;
}

export interface ViewportBounds {
  min: Point;
  max: Point;
}

/**
 * 统一描述世界坐标到画布屏幕坐标的仿射变换。
 * x/y 是屏幕像素中的平移量，zoom 是世界单位对应的屏幕像素比例。
 */
export interface ViewportTransform {
  x: number;
  y: number;
  zoom: number;
}

export interface ViewportState extends ViewportTransform {
  /** 当前画布的 CSS 像素尺寸；视口状态不属于 EditorDocument。 */
  visibleRect: ViewportSize;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** 将任意缩放值限制在支持的 25%–400% 区间。 */
export function clampViewportZoom(zoom: number): number {
  return Math.min(MAX_VIEWPORT_ZOOM, Math.max(MIN_VIEWPORT_ZOOM, finiteOr(zoom, DEFAULT_VIEWPORT_ZOOM)));
}

/** 创建独立于编辑器文档的临时视口状态。 */
export function createViewportState(
  visibleRect: ViewportSize = { width: 1000, height: 560 },
  initial: Partial<ViewportTransform> = {},
): ViewportState {
  return {
    x: finiteOr(initial.x ?? 0, 0),
    y: finiteOr(initial.y ?? 0, 0),
    zoom: clampViewportZoom(initial.zoom ?? DEFAULT_VIEWPORT_ZOOM),
    visibleRect: {
      width: Math.max(0, finiteOr(visibleRect.width, 0)),
      height: Math.max(0, finiteOr(visibleRect.height, 0)),
    },
  };
}

/** 将一个世界坐标点投影到视口屏幕坐标。 */
export function worldToScreen(point: Point, transform: ViewportTransform): Point {
  return {
    x: point.x * transform.zoom + transform.x,
    y: point.y * transform.zoom + transform.y,
  };
}

/** 将一个视口屏幕坐标还原为世界坐标。 */
export function screenToWorld(point: Point, transform: ViewportTransform): Point {
  const zoom = clampViewportZoom(transform.zoom);
  return {
    x: (point.x - transform.x) / zoom,
    y: (point.y - transform.y) / zoom,
  };
}

/** 返回平移后的视口；平移量以屏幕像素表示，适合 pointer/wheel 输入。 */
export function panViewport(state: ViewportState, delta: Point): ViewportState {
  return {
    ...state,
    x: state.x + finiteOr(delta.x, 0),
    y: state.y + finiteOr(delta.y, 0),
    visibleRect: { ...state.visibleRect },
  };
}

/**
 * 在指定屏幕锚点周围设置缩放，使锚点下的世界坐标保持不动。
 * @param zoom 目标缩放比例，而非百分数；会被限制到 0.25–4。
 */
export function setViewportZoomAt(state: ViewportState, zoom: number, anchor: Point): ViewportState {
  const nextZoom = clampViewportZoom(zoom);
  const worldAnchor = screenToWorld(anchor, state);
  return {
    ...state,
    x: anchor.x - worldAnchor.x * nextZoom,
    y: anchor.y - worldAnchor.y * nextZoom,
    zoom: nextZoom,
    visibleRect: { ...state.visibleRect },
  };
}

/** `setViewportZoomAt` 的语义别名，便于交互控制器表达“在锚点缩放”。 */
export const zoomAt = setViewportZoomAt;

/** 以乘数在指针位置缩放，例如 1.1 放大、0.9 缩小。 */
export function zoomViewportAt(state: ViewportState, factor: number, anchor: Point): ViewportState {
  return setViewportZoomAt(state, state.zoom * finiteOr(factor, 1), anchor);
}

/** 以视口中心缩放，供工具栏按钮使用。 */
export function zoomViewportAtCenter(state: ViewportState, factor: number): ViewportState {
  return zoomViewportAt(state, factor, {
    x: state.visibleRect.width / 2,
    y: state.visibleRect.height / 2,
  });
}

/**
 * 在窗口大小变化后保持原来视口中心所对应的世界坐标不变。
 * 这样 resize 不会让节点、Port 和 Wire 相互错位或突然跳到左上角。
 */
export function resizeViewport(state: ViewportState, visibleRect: ViewportSize): ViewportState {
  const oldCenter = {
    x: state.visibleRect.width / 2,
    y: state.visibleRect.height / 2,
  };
  const worldCenter = screenToWorld(oldCenter, state);
  const nextSize = {
    width: Math.max(0, finiteOr(visibleRect.width, 0)),
    height: Math.max(0, finiteOr(visibleRect.height, 0)),
  };
  return {
    ...state,
    x: nextSize.width / 2 - worldCenter.x * state.zoom,
    y: nextSize.height / 2 - worldCenter.y * state.zoom,
    visibleRect: nextSize,
  };
}

/**
 * 计算能完整容纳 Circuit 的视口，保留稳定的屏幕边距并将 Circuit 居中。
 * 空 Circuit 使用 100% 缩放并将世界原点放在窗口中心。
 */
export function fitViewportToBounds(
  state: ViewportState,
  bounds: ViewportBounds,
  padding = DEFAULT_VIEWPORT_PADDING,
): ViewportState {
  const width = Math.max(0, bounds.max.x - bounds.min.x);
  const height = Math.max(0, bounds.max.y - bounds.min.y);
  const availableWidth = Math.max(1, state.visibleRect.width - padding * 2);
  const availableHeight = Math.max(1, state.visibleRect.height - padding * 2);
  const fitScale = width === 0 && height === 0
    ? DEFAULT_VIEWPORT_ZOOM
    : Math.min(
      width === 0 ? Number.POSITIVE_INFINITY : availableWidth / width,
      height === 0 ? Number.POSITIVE_INFINITY : availableHeight / height,
    );
  const zoom = clampViewportZoom(fitScale);
  const center = {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
  };
  return {
    ...state,
    zoom,
    x: state.visibleRect.width / 2 - center.x * zoom,
    y: state.visibleRect.height / 2 - center.y * zoom,
    visibleRect: { ...state.visibleRect },
  };
}

/** `fitViewportToBounds` 的窗口操作别名；不会修改传入的视口对象。 */
export const fitToWindow = fitViewportToBounds;

export interface WheelViewportInput {
  deltaX: number;
  deltaY: number;
  deltaMode?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

/** 将 WheelEvent 的增量归一化为屏幕像素，兼容行/页两种 deltaMode。 */
export function normalizeWheelDelta(input: WheelViewportInput, lineHeight = 16): Point {
  const multiplier = input.deltaMode === 1 ? lineHeight : input.deltaMode === 2 ? 1 : 1;
  return {
    x: finiteOr(input.deltaX, 0) * multiplier,
    y: finiteOr(input.deltaY, 0) * multiplier,
  };
}

/**
 * 应用滚轮浏览行为：普通滚轮纵向平移，Shift 滚轮横向平移，
 * Ctrl/Cmd（也覆盖触控板捏合产生的 ctrlKey）围绕指针缩放。
 */
export function applyWheelViewport(
  state: ViewportState,
  input: WheelViewportInput,
  pointer: Point,
  zoomSensitivity = 0.0025,
): ViewportState {
  const delta = normalizeWheelDelta(input);
  if (input.ctrlKey || input.metaKey) {
    const factor = Math.exp(-delta.y * zoomSensitivity);
    return zoomViewportAt(state, factor, pointer);
  }
  if (input.shiftKey) {
    return panViewport(state, { x: delta.y || delta.x, y: 0 });
  }
  return panViewport(state, { x: 0, y: delta.y || delta.x });
}

/** `applyWheelViewport` 的交互层别名。 */
export const applyViewportWheel = applyWheelViewport;

/** 便于交互层判断 pointer 是否代表中键或 Space+左键平移。 */
export function isViewportPanPointer(button: number, spacePressed: boolean): boolean {
  return button === 1 || (button === 0 && spacePressed);
}
