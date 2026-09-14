export type EditorShortcut = "delete-selection" | "undo" | "redo" | "duplicate-selection" | "cancel";

export interface EditorKeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  editableTarget: boolean;
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
