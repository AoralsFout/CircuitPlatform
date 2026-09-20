import type { ComponentKindName } from "@circuit-platform/protocol";
import type { ComponentDefinition } from "../canvas";

/** 元件菜单中分类的稳定顺序和面向用户的名称。 */
export const COMPONENT_MENU_CATEGORIES = [
  { id: "input-output", label: "输入与输出" },
  { id: "logic", label: "逻辑门" },
  { id: "sequential", label: "时序逻辑" },
  { id: "bus", label: "总线" },
  { id: "subcircuit", label: "子电路" },
] as const;

export type ComponentMenuCategory = (typeof COMPONENT_MENU_CATEGORIES)[number]["id"];

export interface ComponentMenuGroup {
  id: "recent" | "search" | ComponentMenuCategory;
  label: string;
  definitions: readonly ComponentDefinition[];
}

export interface MenuScreenPoint {
  x: number;
  y: number;
}

export interface MenuViewportSize {
  width: number;
  height: number;
}

/** 菜单的保守尺寸，用于打开瞬间还未完成 DOM 测量时的边缘翻转。 */
export const DEFAULT_COMPONENT_MENU_SIZE: MenuViewportSize = { width: 286, height: 430 };
export const COMPONENT_MENU_MARGIN = 8;

/**
 * 计算菜单在画布视口内的位置；靠近右侧或底部时向锚点反方向翻转。
 * @param anchor 打开菜单时的屏幕坐标（相对画布左上角）。
 * @param viewport 当前画布的屏幕尺寸。
 * @param menu 菜单预计尺寸，实测尺寸可用于二次校正。
 * @param margin 菜单与画布边缘的最小间距。
 * @returns 不会超出画布边界的菜单左上角坐标。
 */
export function positionComponentMenu(
  anchor: MenuScreenPoint,
  viewport: MenuViewportSize,
  menu: MenuViewportSize = DEFAULT_COMPONENT_MENU_SIZE,
  margin = COMPONENT_MENU_MARGIN,
): MenuScreenPoint {
  const maxX = Math.max(margin, viewport.width - menu.width - margin);
  const maxY = Math.max(margin, viewport.height - menu.height - margin);
  const flipX = anchor.x + menu.width + margin > viewport.width;
  const flipY = anchor.y + menu.height + margin > viewport.height;
  const candidateX = flipX ? anchor.x - menu.width : anchor.x;
  const candidateY = flipY ? anchor.y - menu.height : anchor.y;
  return {
    x: Math.min(maxX, Math.max(margin, candidateX)),
    y: Math.min(maxY, Math.max(margin, candidateY)),
  };
}

function normalizeQuery(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/**
 * 在显示名称、类型和别名上执行不区分大小写的包含搜索。
 * @param definitions 展示注册表提供的元件定义。
 * @param query 中文名称、英文类型或别名；空值返回原排序。
 * @returns 与查询匹配的定义，不改变输入顺序。
 */
export function searchComponentDefinitions(
  definitions: readonly ComponentDefinition[],
  query: string,
): readonly ComponentDefinition[] {
  const normalized = normalizeQuery(query);
  if (!normalized) return definitions;
  return definitions.filter((definition) => [
    definition.kind,
    definition.displayName,
    ...definition.searchAliases,
  ].some((value) => normalizeQuery(value).includes(normalized)));
}

/**
 * 生成菜单分组；有搜索词时返回单层结果，避免分类折叠阻碍快速定位。
 * @param definitions 展示注册表定义。
 * @param recentKinds 最近成功添加的类型，最多取前五个且忽略不可用类型。
 * @param query 当前搜索词。
 */
export function createComponentMenuGroups(
  definitions: readonly ComponentDefinition[],
  recentKinds: readonly ComponentKindName[] = [],
  query = "",
): readonly ComponentMenuGroup[] {
  const matching = searchComponentDefinitions(definitions, query);
  if (normalizeQuery(query)) return [{ id: "search", label: "搜索结果", definitions: matching }];

  const byKind = new Map(definitions.map((definition) => [definition.kind, definition]));
  const recent = recentKinds
    .slice(0, 5)
    .map((kind) => byKind.get(kind))
    .filter((definition): definition is ComponentDefinition => definition !== undefined);
  const groups: ComponentMenuGroup[] = [];
  if (recent.length > 0) groups.push({ id: "recent", label: "最近使用", definitions: recent });
  for (const category of COMPONENT_MENU_CATEGORIES) {
    const categoryDefinitions = definitions
      .filter((definition) => definition.category === category.id)
      .sort((left, right) => left.sortOrder - right.sortOrder);
    if (categoryDefinitions.length > 0) groups.push({ ...category, definitions: categoryDefinitions });
  }
  return groups;
}

/**
 * 将成功使用的元件移到最近使用列表首位并去重。
 * @param recentKinds 当前偏好列表。
 * @param kind 成功添加的元件类型；失败时不要调用此函数。
 * @param maxItems 最近使用的最大条目数。
 */
export function rememberComponentKind(
  recentKinds: readonly ComponentKindName[],
  kind: ComponentKindName,
  maxItems = 5,
): ComponentKindName[] {
  return [kind, ...recentKinds.filter((item) => item !== kind)].slice(0, Math.max(0, maxItems));
}

export interface ComponentPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const RECENT_COMPONENTS_STORAGE_KEY = "circuit-platform.recent-components";

/** 从本地偏好读取最近使用类型；损坏或未知值会被安全丢弃。 */
export function readRecentComponentKinds(
  storage: ComponentPreferenceStorage | null | undefined,
  definitions: readonly ComponentDefinition[],
  key = RECENT_COMPONENTS_STORAGE_KEY,
): ComponentKindName[] {
  if (!storage) return [];
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? "[]");
    if (!Array.isArray(value)) return [];
    const known = new Set(definitions.map((definition) => definition.kind));
    return value.filter((kind): kind is ComponentKindName => typeof kind === "string" && kind !== "subcircuit" && known.has(kind as ComponentKindName)).slice(0, 5);
  } catch {
    return [];
  }
}

/** 仅在添加命令成功后持久化最近使用类型；本地存储失败不影响已完成的添加。 */
export function writeRecentComponentKind(
  storage: ComponentPreferenceStorage | null | undefined,
  recentKinds: readonly ComponentKindName[],
  kind: ComponentKindName,
  key = RECENT_COMPONENTS_STORAGE_KEY,
): ComponentKindName[] {
  const next = rememberComponentKind(recentKinds, kind);
  try {
    storage?.setItem(key, JSON.stringify(next));
  } catch {
    // 偏好不可写时仍返回内存状态，不能让 UI 把成功的编辑命令标记为失败。
  }
  return next;
}
