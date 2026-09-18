import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveInputBitKeyboardAction } from "../src/editor/keyboard.ts";
import {
  coerceInputValue,
  inputBitsOf,
  toggledInputBit,
  withInputBit,
} from "../src/workspace/index.ts";

const desktopRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** 组内一次按键的最小输入；只有与断言相关的字段需要显式给出。 */
function keyInput(overrides: Partial<Parameters<typeof resolveInputBitKeyboardAction>[0]> = {}) {
  return {
    key: "",
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    index: 0,
    count: 8,
    columns: 8,
    ...overrides,
  };
}

test("navigates within the bit group and stops at both ends", () => {
  // 左右逐位；两端停住而不是绕回，因此「一直按右」会停在最低位。
  assert.deepEqual(resolveInputBitKeyboardAction(keyInput({ key: "ArrowRight", index: 2 })), { type: "move-bit", index: 3 });
  assert.deepEqual(resolveInputBitKeyboardAction(keyInput({ key: "ArrowLeft", index: 2 })), { type: "move-bit", index: 1 });
  assert.equal(resolveInputBitKeyboardAction(keyInput({ key: "ArrowLeft", index: 0 })), null);
  assert.equal(resolveInputBitKeyboardAction(keyInput({ key: "ArrowRight", index: 7 })), null);

  // 只有一行时上下无处可去。
  assert.equal(resolveInputBitKeyboardAction(keyInput({ key: "ArrowDown", index: 1 })), null);

  // 两行时上下跨行一整行；跨出组范围时同样停住，不绕到另一行。
  const twoRows = { count: 16 } as const;
  assert.deepEqual(resolveInputBitKeyboardAction(keyInput({ key: "ArrowDown", index: 1, ...twoRows })), { type: "move-bit", index: 9 });
  assert.deepEqual(resolveInputBitKeyboardAction(keyInput({ key: "ArrowUp", index: 9, ...twoRows })), { type: "move-bit", index: 1 });
  assert.equal(resolveInputBitKeyboardAction(keyInput({ key: "ArrowDown", index: 12, ...twoRows })), null);
  assert.equal(resolveInputBitKeyboardAction(keyInput({ key: "ArrowUp", index: 4, ...twoRows })), null);
});

test("sets the focused bit to unknown with the x key", () => {
  assert.deepEqual(resolveInputBitKeyboardAction(keyInput({ key: "x", index: 5 })), { type: "set-bit-unknown" });
  assert.deepEqual(resolveInputBitKeyboardAction(keyInput({ key: "X", index: 5 })), { type: "set-bit-unknown" });
});

test("leaves modified combinations and unrelated keys to the global and canvas bindings", () => {
  // Shift / Alt / Ctrl 的组合已经属于画布与全局，组内一律让位。
  for (const modifier of ["shiftKey", "altKey", "ctrlKey", "metaKey"] as const) {
    assert.equal(resolveInputBitKeyboardAction(keyInput({ key: "ArrowRight", index: 2, [modifier]: true })), null);
    assert.equal(resolveInputBitKeyboardAction(keyInput({ key: "x", index: 2, [modifier]: true })), null);
  }
  assert.equal(resolveInputBitKeyboardAction(keyInput({ key: "Enter", index: 2 })), null);
  assert.equal(resolveInputBitKeyboardAction(keyInput({ key: " ", index: 2 })), null);
});

test("toggles a bit between 0 and 1, treating an unknown bit as non-high", () => {
  assert.equal(toggledInputBit("0"), "1");
  assert.equal(toggledInputBit("1"), "0");
  // 左键的意思是「让这一位变成确定的」，因此未知位被点一下就离开未知。
  assert.equal(toggledInputBit("X"), "1");
});

test("replaces one bit without disturbing the others", () => {
  assert.equal(withInputBit("0000", 1, "1"), "0100");
  assert.equal(withInputBit("0000", 0, "X"), "X000");
  assert.equal(withInputBit("0000", 3, "X"), "000X");
  // 越界下标不是错误，只是不改变任何一位。
  assert.equal(withInputBit("0000", -1, "1"), "0000");
  assert.equal(withInputBit("0000", 4, "1"), "0000");
});

test("aligns a value to the port width and rejects anything that is not bit text", () => {
  assert.equal(coerceInputValue("1010", 4), "1010");
  // 长度对不上就整体回到默认值，与引擎「位宽变化的端口按初值重建」是同一条规则。
  assert.equal(coerceInputValue("1", 4), "0000");
  assert.equal(coerceInputValue("101010", 4), "0000");
  assert.equal(coerceInputValue(undefined, 4), "0000");
  assert.equal(coerceInputValue(undefined, 1), "0");
  // 字符集同样校验：非逐位文本不会被当成合法读数传下去。
  assert.equal(coerceInputValue("10x0", 4), "0000");
  assert.equal(coerceInputValue("", 0), "0");
});

test("splits a value into bits ordered from the most significant one", () => {
  assert.deepEqual(inputBitsOf("10X0"), ["1", "0", "X", "0"]);
  assert.deepEqual(inputBitsOf("1"), ["1"]);
});

/**
 * 下面两条断言的是无头环境够不到的视觉契约：方形、每行八列、标签在位按钮组上方。
 * 它们按 `bottom-panel.test.ts` 的既有做法读源码，因此只断言「结构存在」，不断言渲染结果。
 */
test("renders the bit group as squares, eight per row, with the label above it", async () => {
  const sidebar = await readFile(join(desktopRoot, "src", "components", "WorkspaceSidebar.vue"), "utf8");
  const styles = await readFile(join(desktopRoot, "src", "styles.css"), "utf8");

  // 元件标签（.input-setting-head）在位按钮组（.input-bit-grid）之前的同一块里。
  assert.match(sidebar, /class="input-setting-head"[\s\S]*?class="input-bit-grid"/);
  // 每行八列，方形由 aspect-ratio 保证。
  assert.match(styles, /\.input-bit-grid \{[^}]*grid-template-columns: repeat\(8, 1fr\)/);
  assert.match(styles, /\.input-bit \{[^}]*aspect-ratio: 1/);
  // 两种位宽共用同一套视觉：只有一份位按钮组标记，没有按位宽分叉的模板。
  assert.equal(sidebar.match(/class="input-bit-grid"/g)?.length, 1);
  assert.doesNotMatch(sidebar, /width === 1|\bwidth > 1\b/);
});

test("wires both the mouse and the keyboard paths to the same bit command", async () => {
  const sidebar = await readFile(join(desktopRoot, "src", "components", "WorkspaceSidebar.vue"), "utf8");
  const app = await readFile(join(desktopRoot, "src", "App.vue"), "utf8");

  // 左键在 0 与 1 之间切换，右键把该位设为 X；两条路径都落到同一个 setInputBit 命令上。
  assert.match(sidebar, /@click="emit\('setInputBit', input\.key, bit\.index, toggledInputBit\(bit\.value\)\)"/);
  assert.match(sidebar, /@contextmenu\.prevent="emit\('setInputBit', input\.key, bit\.index, 'X'\)"/);
  // 键盘：组可聚焦（roving tabindex）、组内导航与设为 X 走键盘解析器。
  assert.match(sidebar, /:tabindex="bit\.index === focusedBitIndex\(input\.key\) \? 0 : -1"/);
  assert.match(sidebar, /resolveInputBitKeyboardAction\(/);
  // 组可展开收起。
  assert.match(sidebar, /:aria-expanded="isBitGroupExpanded\(input\.key\)"/);
  // 命令从侧栏接到工作区。
  assert.match(app, /@set-input-bit="setInputBit"/);
});
