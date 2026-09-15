export type EditorShortcut = "delete-selection" | "undo" | "redo" | "duplicate-selection" | "cancel";

/** 画布键盘导航可执行的最小意图集合；组件只负责把意图映射为 DOM/编辑器动作。 */
export type CanvasKeyboardAction =
  | { type: "open-menu" }
  | { type: "pan"; dx: number; dy: number }
  | { type: "move-draft"; dx: number; dy: number; waypoint: boolean }
  | { type: "toggle-draft-axis" }
  | { type: "finish-draft" }
  | { type: "remove-draft-waypoint" }
  | { type: "next-focus"; delta: number }
  | { type: "select-focus" }
  | { type: "cancel" };

export interface CanvasKeyInput {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  hasDraft: boolean;
  targetIsEditable: boolean;
}

export interface EditorKeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  editableTarget: boolean;
}

/** 判断事件目标是否属于输入控件；编辑器不应截获控件自身的编辑快捷键。 */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  return typeof HTMLElement !== "undefined" && target instanceof HTMLElement && (
    target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

/**
 * 把键盘事件归一为编辑器意图；输入控件中的编辑快捷键始终留给控件自身。
 * @param input 与平台修饰键和目标可编辑状态有关的最小事件数据。
 * @returns 匹配到的编辑器快捷键；普通按键返回 null。
 */
export function resolveEditorShortcut(input: EditorKeyInput): EditorShortcut | null {
  if (input.editableTarget) return null;
  if ((input.ctrlKey || input.metaKey) && input.key.toLowerCase() === "z") {
    return input.shiftKey ? "redo" : "undo";
  }
  if ((input.ctrlKey || input.metaKey) && input.key.toLowerCase() === "d") return "duplicate-selection";
  if (input.key === "Escape") return "cancel";
  if (input.key === "Delete" || input.key === "Backspace") return "delete-selection";
  return null;
}

/**
 * 将画布中的键盘事件归一为可测试的交互意图。
 * 方向键默认移动布线光标；在空闲画布上用于平移，Shift 方向键固定为平移。
 * @param input 事件的按键、修饰键和当前 ConnectionDraft 状态。
 * @returns 画布控制器可以执行的意图；不属于画布语义的按键返回 null。
 */
export function resolveCanvasKeyboardAction(input: CanvasKeyInput): CanvasKeyboardAction | null {
  if (input.targetIsEditable) return null;
  if ((input.key === "F10" && input.shiftKey) || input.key === "ContextMenu") return { type: "open-menu" };
  if (input.key === "Escape") return { type: "cancel" };
  if (input.key === "Tab") return { type: "next-focus", delta: input.shiftKey ? -1 : 1 };
  if (input.key === "Enter" || input.key === " ") {
    if (input.hasDraft) return input.key === " " ? { type: "toggle-draft-axis" } : { type: "finish-draft" };
    return { type: "select-focus" };
  }
  if (input.key === "Backspace" && input.hasDraft) return { type: "remove-draft-waypoint" };
  const direction: Record<string, { dx: number; dy: number }> = {
    ArrowLeft: { dx: -1, dy: 0 },
    ArrowRight: { dx: 1, dy: 0 },
    ArrowUp: { dx: 0, dy: -1 },
    ArrowDown: { dx: 0, dy: 1 },
  };
  const delta = direction[input.key];
  if (!delta) return null;
  if (input.hasDraft) return { type: "move-draft", dx: delta.dx, dy: delta.dy, waypoint: input.shiftKey };
  if (input.shiftKey) return { type: "pan", dx: delta.dx, dy: delta.dy };
  return { type: "next-focus", delta: delta.dx || delta.dy };
}
