import type { CanvasHitTarget } from "../canvas/hit-testing";

export type ContextActionId = "copy-component" | "delete-component" | "edit-route" | "reset-route" | "delete-connection";

export interface ContextAction {
  id: ContextActionId;
  label: string;
  destructive?: boolean;
}

/**
 * 生成对象右键菜单动作；Component 和 Wire 的动作严格分开，Port 不打开对象菜单。
 * @param target 统一命中结果。
 * @returns 适用于菜单渲染的只读动作列表；背景和 Port 返回空列表。
 */
export function contextActionsFor(target: CanvasHitTarget): readonly ContextAction[] {
  if (target.kind === "component") {
    return [
      { id: "copy-component", label: "复制" },
      { id: "delete-component", label: "删除", destructive: true },
    ];
  }
  if (target.kind === "wire" || target.kind === "wire-handle") {
    return [
      { id: "edit-route", label: "编辑 Route" },
      { id: "reset-route", label: "重置 Route" },
      { id: "delete-connection", label: "删除 Wire", destructive: true },
    ];
  }
  return [];
}

/** `contextActionsFor` 的语义别名，强调菜单动作来自统一命中对象。 */
export const getContextActions = contextActionsFor;
