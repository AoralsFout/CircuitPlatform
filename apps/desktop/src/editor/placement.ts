import type { ComponentKindName } from "@circuit-platform/protocol";
import type { Point } from "./index";

/** CircuitNode 与 Waypoint 的默认世界坐标网格间距。 */
export const EDITOR_GRID_SIZE = 16;

/**
 * 将世界坐标吸附到编辑器网格；Alt 临时关闭吸附并保留精确位置。
 * @param point 待放置的世界坐标。
 * @param altKey 是否按住 Alt。
 * @returns 不修改输入对象的新坐标。
 */
export function snapWorldPoint(point: Point, altKey = false): Point {
  if (altKey) return { ...point };
  return {
    x: Math.round(point.x / EDITOR_GRID_SIZE) * EDITOR_GRID_SIZE,
    y: Math.round(point.y / EDITOR_GRID_SIZE) * EDITOR_GRID_SIZE,
  };
}

/**
 * 计算以 WorldPoint 为中心的 CircuitNode 左上角位置。
 * @param center 用户选择的世界坐标中心。
 * @param size 节点展示定义的世界尺寸。
 * @param altKey 是否跳过中心点网格吸附。
 * @returns 可直接存入 EditorComponent.position 的左上角坐标。
 */
export function positionFromPlacementCenter(
  center: Point,
  size: { width: number; height: number },
  altKey = false,
): Point {
  const snapped = snapWorldPoint(center, altKey);
  return { x: snapped.x - size.width / 2, y: snapped.y - size.height / 2 };
}

/** 描述元件库/上下文菜单统一使用的放置意图。 */
export interface ComponentPlacementIntent {
  kind: ComponentKindName;
  center: Point;
  altKey?: boolean;
  continuous?: boolean;
}
