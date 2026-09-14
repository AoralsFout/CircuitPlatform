import type { Point } from "../editor";
import type { CanvasNode, CanvasScene, CanvasWire } from "./index";

/** 画布统一命中的对象；命中函数只返回一个最高优先级对象。 */
export type CanvasHitTarget =
  | { kind: "port"; nodeId: string; portId: string }
  | { kind: "wire-handle"; connectionId: string; handle: "waypoint" | "segment"; index: number }
  | { kind: "component"; nodeId: string }
  | { kind: "wire"; connectionId: string }
  | { kind: "background" };

export interface HitTestOptions {
  /** 当前视口缩放；命中宽度以屏幕像素定义，默认按 100% 计算。 */
  zoom?: number;
  /** 端口半径，单位为世界坐标；默认保证 24px 的屏幕命中区域。 */
  portRadius?: number;
  /** Wire 透明命中描边的半宽，默认 8 世界单位（16px 命中宽度）。 */
  wireHitRadius?: number;
  /** 选中 Wire；未传时使用场景中的 selected 标记。 */
  selectedConnectionId?: string | null;
  /** 选中 Wire 手柄的半径，单位为世界坐标。 */
  handleRadius?: number;
};

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function pointInNode(point: Point, node: CanvasNode): boolean {
  return point.x >= node.position.x && point.x <= node.position.x + node.size.width &&
    point.y >= node.position.y && point.y <= node.position.y + node.size.height;
}

function wireAt(point: Point, wire: CanvasWire, radius: number): boolean {
  return wire.route.some((start, index) => index < wire.route.length - 1 && distanceToSegment(point, start, wire.route[index + 1]) <= radius);
}

/**
 * 按 Port > 选中 Wire 手柄 > CircuitNode > Wire > 背景统一命中画布对象。
 * @param scene 当前场景投影，坐标必须使用同一套世界坐标。
 * @param point 待检测的世界坐标点。
 * @param options 命中区域和选中 Wire 配置。
 * @returns 最高优先级命中对象；未命中对象时返回 background。
 */
export function hitTestCanvas(scene: CanvasScene, point: Point, options: HitTestOptions = {}): CanvasHitTarget {
  const zoom = Math.max(options.zoom ?? 1, 0.01);
  const portRadius = options.portRadius ?? 12 / zoom;
  const wireHitRadius = options.wireHitRadius ?? 8 / zoom;
  const handleRadius = options.handleRadius ?? 10 / zoom;

  // 端口覆盖在节点和 Wire 之上，先扫描全部节点，避免 SVG 层抢走端口操作。
  for (const node of scene.nodes) {
    for (const port of node.ports) {
      if (Math.hypot(point.x - port.point.x, point.y - port.point.y) <= portRadius) {
        return { kind: "port", nodeId: node.id, portId: port.id };
      }
    }
  }

  const selectedWireId = options.selectedConnectionId !== undefined
    ? options.selectedConnectionId
    : scene.wires.find((wire) => wire.selected)?.id ?? null;
  const selectedWire = selectedWireId ? scene.wires.find((wire) => wire.id === selectedWireId) : undefined;
  if (selectedWire) {
    for (let index = 1; index < selectedWire.route.length - 1; index += 1) {
      const waypoint = selectedWire.route[index];
      if (Math.hypot(point.x - waypoint.x, point.y - waypoint.y) <= handleRadius) {
        return { kind: "wire-handle", connectionId: selectedWire.id, handle: "waypoint", index };
      }
    }
    for (let index = 0; index < selectedWire.route.length - 1; index += 1) {
      if (distanceToSegment(point, selectedWire.route[index], selectedWire.route[index + 1]) <= wireHitRadius) {
        return { kind: "wire-handle", connectionId: selectedWire.id, handle: "segment", index };
      }
    }
  }

  for (const node of scene.nodes) {
    if (pointInNode(point, node)) return { kind: "component", nodeId: node.id };
  }
  for (const wire of scene.wires) {
    if (wireAt(point, wire, wireHitRadius)) return { kind: "wire", connectionId: wire.id };
  }
  return { kind: "background" };
}

/** `hitTestCanvas` 的短别名，供交互控制器和测试使用。 */
export const hitTest = hitTestCanvas;
