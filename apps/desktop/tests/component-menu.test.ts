import assert from "node:assert/strict";
import test from "node:test";
import { createComponentDefinitionRegistry } from "../src/canvas/index.ts";
import {
  createComponentMenuGroups,
  positionComponentMenu,
  readRecentComponentKinds,
  rememberComponentKind,
  writeRecentComponentKind,
} from "../src/editor/component-menu.ts";

const definitions = createComponentDefinitionRegistry().list();

test("component menu searches Chinese names and logic aliases", () => {
  assert.equal(createComponentMenuGroups(definitions, [], "与门")[0]?.definitions[0]?.kind, "and");
  assert.equal(createComponentMenuGroups(definitions, [], "XOR")[0]?.definitions[0]?.kind, "xor");
  assert.equal(createComponentMenuGroups(definitions, [], "not")[0]?.definitions[0]?.kind, "not");
});

test("component menu groups recent items before categories and caps them at five", () => {
  const groups = createComponentMenuGroups(definitions, ["xor", "and", "or", "not", "input", "output"]);
  assert.deepEqual(groups[0]?.definitions.map((item) => item.kind), ["xor", "and", "or", "not", "input"]);
  assert.equal(groups.map((group) => group.id).join(","), "recent,input-output,logic,sequential");
});

test("sequential definitions expose a usable clock and d flip-flop", () => {
  const sequential = createComponentMenuGroups(definitions).find((group) => group.id === "sequential");
  // 两个时序元件都已解除禁用：没有禁用原因，描述说明真实行为。
  const clock = sequential?.definitions.find((item) => item.kind === "clock");
  assert.equal(clock?.available, true);
  assert.equal(clock?.disabledReason, null);

  const flipFlop = sequential?.definitions.find((item) => item.kind === "d_flip_flop");
  assert.equal(flipFlop?.available, true);
  assert.equal(flipFlop?.disabledReason, null);
  assert.match(flipFlop?.description ?? "", /上升沿/);
  // 菜单按搜索别名找到它，且不再被键盘导航跳过。
  assert.equal(createComponentMenuGroups(definitions, [], "触发器")[0]?.definitions[0]?.kind, "d_flip_flop");
});

test("menu flips away from viewport edges", () => {
  assert.deepEqual(positionComponentMenu({ x: 790, y: 590 }, { width: 800, height: 600 }, { width: 280, height: 400 }), { x: 510, y: 190 });
  assert.deepEqual(positionComponentMenu({ x: 40, y: 30 }, { width: 800, height: 600 }, { width: 280, height: 400 }), { x: 40, y: 30 });
});

test("recent preferences only change when caller records a successful add", () => {
  const storage = new Map<string, string>();
  const adapter = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) };
  let recent = readRecentComponentKinds(adapter, definitions);
  assert.deepEqual(recent, []);
  recent = rememberComponentKind(recent, "and");
  assert.deepEqual(readRecentComponentKinds(adapter, definitions), []);
  recent = writeRecentComponentKind(adapter, recent, "and");
  assert.deepEqual(readRecentComponentKinds(adapter, definitions), ["and"]);
});
