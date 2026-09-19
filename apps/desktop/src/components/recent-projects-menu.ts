/**
 * 最近项目下拉菜单的键盘语义。条目是原生按钮：`Tab` 按文档顺序可达、`Enter`/`Space`
 * 走原生激活，这里只补菜单惯用的方向键导航与 `Esc` 关闭（键位登记见 ADR 0012）。
 */

/** 面板内一次按键解析出的动作；`none` 表示交给按钮的原生行为。 */
export type RecentProjectsMenuKeyAction = "focus-next" | "focus-previous" | "close" | "none";

/**
 * 把菜单内的一次按键解析成动作。
 * @param key `KeyboardEvent.key` 的原始值。
 * @returns 解析出的动作；其它按键（含 `Tab`、`Enter`）返回 `none`。
 */
export function resolveRecentProjectsMenuKeyAction(key: string): RecentProjectsMenuKeyAction {
  if (key === "ArrowDown") return "focus-next";
  if (key === "ArrowUp") return "focus-previous";
  if (key === "Escape") return "close";
  return "none";
}

/**
 * 计算方向键移动后的焦点下标：在列表内循环移动、两端绕回；焦点不在列表内时从端点进入。
 * @param currentIndex 当前焦点下标；焦点不在列表内时为负数。
 * @param count 条目总数。
 * @param action 移动方向。
 * @returns 目标下标；列表为空时返回 -1（没有可聚焦的条目）。
 */
export function moveRecentProjectsMenuFocus(currentIndex: number, count: number, action: "focus-next" | "focus-previous"): number {
  if (count <= 0) return -1;
  if (currentIndex < 0) return action === "focus-next" ? 0 : count - 1;
  return action === "focus-next" ? (currentIndex + 1) % count : (currentIndex - 1 + count) % count;
}
