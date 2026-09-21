/** 标签键盘动作；保持纯函数以便无头测试完整覆盖鼠标之外的交互。 */
export type DocumentTabKeyAction = "activate" | "move" | "none";

export interface DocumentTabKeyResult {
  action: DocumentTabKeyAction;
  index: number;
}

/**
 * 解析标签栏键盘输入。
 * @param key 浏览器 KeyboardEvent.key。
 * @param current 当前标签下标。
 * @param count 标签总数。
 * @returns 激活当前/移动焦点的目标下标；无关按键返回 none。
 */
export function resolveDocumentTabKey(key: string, current: number, count: number): DocumentTabKeyResult {
  if (count <= 0) return { action: "none", index: -1 };
  const bounded = Math.min(Math.max(current, 0), count - 1);
  if (key === "Home") return { action: "move", index: 0 };
  if (key === "End") return { action: "move", index: count - 1 };
  if (key === "ArrowLeft") return { action: "move", index: (bounded - 1 + count) % count };
  if (key === "ArrowRight") return { action: "move", index: (bounded + 1) % count };
  if (key === "Enter" || key === " ") return { action: "activate", index: bounded };
  return { action: "none", index: bounded };
}

