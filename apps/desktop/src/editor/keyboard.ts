export type EditorShortcut =
  | "delete-selection"
  | "undo"
  | "redo"
  | "duplicate-selection"
  | "cancel"
  | "zoom-in"
  | "zoom-out"
  | "zoom-fit"
  | "start-or-resume-simulation"
  | "pause-simulation"
  | "step-simulation"
  | "reset-simulation"
  | "new-document"
  | "open-document"
  | "save"
  | "save-as";

/** 画布键盘导航可执行的最小意图集合；组件只负责把意图映射为 DOM/编辑器动作。 */
export type CanvasKeyboardAction =
  | { type: "open-menu" }
  | { type: "pan"; dx: number; dy: number }
  | { type: "nudge-component"; dx: number; dy: number }
  | { type: "nudge-route"; dx: number; dy: number }
  | { type: "move-draft"; dx: number; dy: number; waypoint: boolean }
  | { type: "toggle-draft-axis" }
  | { type: "finish-draft" }
  | { type: "remove-draft-waypoint" }
  | { type: "next-focus"; delta: number }
  | { type: "select-focus" }
  | { type: "cancel" };

/** 画布内可聚焦对象的类型；`route-*` 只进入方向键导航环，不占用 Tab 序。 */
export type CanvasFocusKind = "component" | "port" | "connection" | "route-waypoint" | "route-segment";

/**
 * 输入设置的位按钮组内可执行的意图集合。
 * 切换 `0` / `1` 不在这里：位按钮是原生按钮，`Space` 与 `Enter` 的激活语义由它自己承担，
 * 这里只补上原生按钮没有的两件事——组内导航，以及把一位设为 `X`。
 */
export type InputBitKeyboardAction =
  | { type: "move-bit"; index: number }
  | { type: "set-bit-unknown" };

export interface InputBitKeyInput {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  /** 组内当前聚焦位的下标。 */
  index: number;
  /** 组内的位数量。 */
  count: number;
  /** 位按钮组的列数；上下方向键按它跨行。 */
  columns: number;
}

/**
 * 把键盘事件归一为位按钮组的意图。
 *
 * 方向键在组内移动焦点：左右逐位、上下跨行。两者都在两端停住而不是绕回，「一直按右」因此会停在
 * 最低位，而不是悄悄跳回最高位。带修饰键的组合一律不处理——`Shift + 方向键` 与
 * `Alt + 方向键` 已经属于画布，组内让位给它们。
 * @param input 事件按键、修饰键与组内焦点位置。
 * @returns 组可以执行的意图；不属于位按钮组的按键返回 null。
 */
export function resolveInputBitKeyboardAction(input: InputBitKeyInput): InputBitKeyboardAction | null {
  if (input.ctrlKey || input.metaKey || input.altKey || input.shiftKey) return null;
  if (input.key.toLowerCase() === "x") return { type: "set-bit-unknown" };
  const step: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -input.columns,
    ArrowDown: input.columns,
  };
  const delta = step[input.key];
  if (delta === undefined) return null;
  const next = input.index + delta;
  if (next < 0 || next >= input.count) return null;
  return { type: "move-bit", index: next };
}

export interface CanvasKeyInput {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  hasDraft: boolean;
  targetIsEditable: boolean;
  /** 当前聚焦对象的类型；没有画布焦点时省略。 */
  focusedKind?: CanvasFocusKind | null;
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

/** Space 与 Enter 会触发元素默认动作的那几类元素；与 `isNativeActivationTarget` 配套。 */
const NATIVE_ACTIVATION_SELECTOR = [
  "button",
  "a[href]",
  "summary",
  // 勾选类与按钮类 input 的激活同样发生在默认动作里；纯文本输入框由
  // `isEditableKeyboardTarget` 负责，不在这里。
  "input[type=checkbox]",
  "input[type=radio]",
  "input[type=button]",
  "input[type=submit]",
  "input[type=reset]",
].join(",");

/**
 * 判断事件目标是不是一个「Space / Enter 由浏览器完成激活」的控件。
 *
 * 原生可激活控件的 Space 与 Enter 不需要任何脚本：浏览器自己完成激活，而这一步只在 `keydown`
 * 没有被 `preventDefault()` 时发生。挂在 window 上的全局处理器会看到从这些控件冒泡上来的按键，
 * 因此必须先问一句「这个键在这个作用域里是谁的」——ADR 0012 的规则是同一按键在不同作用域下
 * 含义不同时按焦点所在的作用域分派。画布把 Space 用作草稿轴向与平移修饰，那是**画布**作用域里
 * 的含义；焦点在位按钮、元件库条目或运行控制上时，这个键属于那个控件。
 *
 * 用 `closest` 而不是直接比较 `target`：点在按钮内的文字或图标上时事件目标是子节点，浏览器
 * 激活的仍然是那个按钮。
 * @param target 键盘事件的目标。
 * @returns 目标是原生可激活控件（或它的子节点）时返回 true。
 */
export function isNativeActivationTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return false;
  return target.closest(NATIVE_ACTIVATION_SELECTOR) !== null;
}

/**
 * 把键盘事件归一为编辑器意图；输入控件中的编辑快捷键始终留给控件自身。
 * @param input 与平台修饰键和目标可编辑状态有关的最小事件数据。
 * @returns 匹配到的编辑器快捷键；普通按键返回 null。
 */
export function resolveEditorShortcut(input: EditorKeyInput): EditorShortcut | null {
  // 文件操作键位先于输入控件判定（与保存键位同一条取舍）：文件操作在控件内没有本地含义，
  // 而应用菜单已移除，没有其它处理器会接住这些组合键，焦点在哪都应当能到达文件操作。
  if (input.ctrlKey || input.metaKey) {
    const key = input.key.toLowerCase();
    if (key === "s") return input.shiftKey ? "save-as" : "save";
    if (key === "n") return "new-document";
    if (key === "o") return "open-document";
  }
  if (input.editableTarget) return null;
  // 运行控制占用功能键簇：开始与继续是同一个「运行」意图，由调用方按当前运行态分派。
  if (input.key === "F5") return "start-or-resume-simulation";
  if (input.key === "F6") return "pause-simulation";
  if (input.key === "F7") return "step-simulation";
  if (input.key === "F8") return "reset-simulation";
  if ((input.ctrlKey || input.metaKey) && input.key.toLowerCase() === "z") {
    return input.shiftKey ? "redo" : "undo";
  }
  if ((input.ctrlKey || input.metaKey) && input.key.toLowerCase() === "d") return "duplicate-selection";
  if (input.ctrlKey || input.metaKey) {
    // `+` 需要 Shift，`_` 是 Shift+`-`；两者都按同一意图处理。
    if (input.key === "=" || input.key === "+") return "zoom-in";
    if (input.key === "-" || input.key === "_") return "zoom-out";
    if (input.key === "0") return "zoom-fit";
  }
  if (input.key === "Escape") return "cancel";
  if (input.key === "Delete" || input.key === "Backspace") return "delete-selection";
  return null;
}

/**
 * 将画布中的键盘事件归一为可测试的交互意图。
 * 方向键按上下文分层：布线中移动草稿光标，`Shift` 固定为平移，
 * 聚焦 Route 折点/线段时微调该手柄，聚焦 Component 时 `Alt` 微调该元件，
 * 其余情况移动焦点。
 * @param input 事件的按键、修饰键、ConnectionDraft 状态和当前焦点类型。
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
  // Shift 仍然固定为平移，因此它先于两个微调分支判定。
  if (input.shiftKey) return { type: "pan", dx: delta.dx, dy: delta.dy };
  if (input.focusedKind === "route-waypoint" || input.focusedKind === "route-segment") {
    return { type: "nudge-route", dx: delta.dx, dy: delta.dy };
  }
  if (input.altKey && input.focusedKind === "component") {
    return { type: "nudge-component", dx: delta.dx, dy: delta.dy };
  }
  return { type: "next-focus", delta: delta.dx || delta.dy };
}
