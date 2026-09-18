import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentKindName, PortSpec } from "@circuit-platform/protocol";
import { createComponentDefinitionRegistry, projectCanvasScene } from "../src/canvas/index.ts";
import type { EditorComponent, EditorSnapshot, Point } from "../src/editor/index.ts";
import { createWaveformRows } from "../src/editor/waveform.ts";
import { BUILT_IN_PORTS } from "./fake-ports.ts";

const at = (x: number, y: number): Point => ({ x, y });

/** 端口清单与真实路径一样来自引擎回传的那一份；这里用内置定义扮演引擎的回退结果。 */
function component(
  id: string,
  kind: ComponentKindName,
  displayName: string,
  position: Point,
  ports: readonly PortSpec[] = BUILT_IN_PORTS[kind],
): EditorComponent {
  return { id, kind, displayName, position, lifecycle: "active", ports };
}

function snapshot(components: readonly EditorComponent[]): EditorSnapshot {
  return {
    document: { components, connections: [] },
    selection: null,
    operation: "idle",
    canUndo: false,
    canRedo: false,
    confirmation: null,
    error: null,
  };
}

/** 走真实路径取行：先由文档投影出场景，再从场景节点生成行。 */
function rowsOf(components: readonly EditorComponent[]): readonly { label: string; key: string }[] {
  const scene = projectCanvasScene(snapshot(components), { signals: {} }, createComponentDefinitionRegistry());
  return createWaveformRows(scene.nodes);
}

const SOURCE = component("source", "input", "输入 A", at(0, 0));
const SOURCE_B = component("source-b", "input", "输入 B", at(0, 200));
const GATE = component("gate", "and", "与门", at(200, 0));
const SINK = component("sink", "output", "输出", at(400, 0));

test("derives one row per observable port from the scene projection", () => {
  const rows = rowsOf([SOURCE, SOURCE_B, GATE, SINK]);

  // Input 读自己的驱动端口，Output 读接收端，其余元件读自己的输出端口；键与画布共用同一套
  // `${editorComponentId}:${portId}`，因此波形不需要第二套索引。
  assert.deepEqual(rows, [
    { key: "source:out", label: "输入 A" },
    { key: "source-b:out", label: "输入 B" },
    { key: "gate:out", label: "与门" },
    { key: "sink:in", label: "输出" },
  ]);
});

test("covers every Input and every Output instead of the first two inputs", () => {
  // 四个 Input、三个 Output 外加一个 Clock：行的集合随电路增长，不再写死在「输入 A / 输入 B /
  // 输出」三行上，也不再局限于前两个输入。
  const rows = rowsOf([
    SOURCE,
    SOURCE_B,
    component("source-c", "input", "输入 C", at(0, 400)),
    component("tick", "clock", "时钟", at(0, 600)),
    GATE,
    component("sink-b", "output", "输出 B", at(400, 200)),
    component("sink-c", "output", "输出 C", at(400, 400)),
  ]);

  assert.deepEqual(rows.map((row) => row.key), [
    "source:out",
    "source-b:out",
    "source-c:out",
    "tick:out",
    "gate:out",
    "sink-b:in",
    "sink-c:in",
  ]);
});

test("follows the scene when a Component is added or removed", () => {
  // 增删元件后行跟着变：删掉的元件不会留下指向已经不存在的信号的行。
  assert.deepEqual(rowsOf([SOURCE, SINK]).map((row) => row.key), ["source:out", "sink:in"]);
  assert.deepEqual(
    rowsOf([SOURCE, SOURCE_B, SINK]).map((row) => row.key),
    ["source:out", "source-b:out", "sink:in"],
  );
  assert.deepEqual(rowsOf([SOURCE]).map((row) => row.key), ["source:out"]);
  assert.deepEqual(rowsOf([]), []);
});

test("qualifies the port label only when a Component has several observable ports", () => {
  // 数据驱动的元件（Phase 4.5 的拆线器）会有多个输出端口，此时端口标签把同一元件的行区分开。
  const branches: readonly PortSpec[] = [
    { name: "out0", direction: "output", width: 4, bitRange: { msb: 7, lsb: 4 } },
    { name: "out1", direction: "output", width: 4, bitRange: { msb: 3, lsb: 0 } },
  ];
  const rows = rowsOf([component("split", "and", "拆线器", at(0, 0), branches)]);

  assert.deepEqual(rows.map((row) => row.key), ["split:out0", "split:out1"]);
  assert.deepEqual(rows.map((row) => row.label), ["拆线器 · out0[7:4]", "拆线器 · out1[3:0]"]);
});

test("keeps a width-1 circuit on the same rows as before", () => {
  // 位宽为 1 的既有电路逐行不变：单端口元件只显示元件名，不带端口后缀。
  const rows = rowsOf([SOURCE, GATE, SINK]);
  assert.equal(rows.every((row) => !row.label.includes("·")), true);
  assert.deepEqual(rows.map((row) => row.key), ["source:out", "gate:out", "sink:in"]);
});
