import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentKindName, PortSpec } from "@circuit-platform/protocol";
import {
  circuitPortLabel,
  createCanvasSceneProjector,
  createComponentDefinitionRegistry,
  portLayoutFor,
  projectCanvasScene,
  type ComponentDefinition,
} from "../src/canvas/index.ts";
import type { EditorComponent, EditorSnapshot, Point } from "../src/editor/index.ts";
import { BUILT_IN_PORTS } from "./fake-ports.ts";

/** 给一个元件补上内置端口清单，模拟 `component_added` 回传的那一份。 */
function withPorts(component: EditorComponent, ports: readonly PortSpec[]): EditorComponent {
  return { ...component, ports };
}

function snapshot(): EditorSnapshot {
  return {
    document: {
      components: [
        { id: "source-17", kind: "input", displayName: "自定义输入", position: { x: 32, y: 48 }, lifecycle: "active", ports: BUILT_IN_PORTS.input },
        { id: "or-99", kind: "or", displayName: "OR 99", position: { x: 320, y: 80 }, lifecycle: "active", ports: BUILT_IN_PORTS.or },
        { id: "sink-4", kind: "output", displayName: "自定义输出", position: { x: 600, y: 100 }, lifecycle: "active", ports: BUILT_IN_PORTS.output },
      ],
      connections: [{
        id: "connection-88",
        source: { componentId: "source-17", port: "out", point: { x: 180, y: 90 } },
        target: { componentId: "or-99", port: "in1", point: { x: 320, y: 110 } },
        route: [{ x: 180, y: 90 }, { x: 250, y: 90 }, { x: 250, y: 110 }, { x: 320, y: 110 }],
        lifecycle: "visible",
        danglingEndpoints: ["target"],
      }],
    },
    selection: { kind: "component", id: "or-99" },
    operation: "idle",
    canUndo: false,
    canRedo: false,
    confirmation: null,
    error: null,
  };
}

test("registry exposes display metadata without carrying a port list", () => {
  const registry = createComponentDefinitionRegistry();
  const and = registry.get("and");
  assert.equal(and?.category, "logic");
  assert.equal(and?.available, true);
  // 端口从哪来、有多宽都由引擎回传的端口清单决定；展示定义不再声明一份无人校验的副本。
  assert.equal(Object.hasOwn(and ?? {}, "ports"), false);
  assert.equal(registry.search("与门").some((definition) => definition.kind === "and"), true);
  // Clock 已经可以添加，描述与「每推进一次翻转一次」的真实行为一致。
  assert.equal(registry.get("clock")?.available, true);
  assert.equal(registry.get("clock")?.disabledReason, null);
  assert.match(registry.get("clock")?.description ?? "", /翻转/);
  // D Flip-Flop 也已解除禁用，描述与「只在 clock 上升沿采样」的真实行为一致。
  assert.equal(registry.get("d_flip_flop")?.available, true);
  assert.equal(registry.get("d_flip_flop")?.disabledReason, null);
  assert.match(registry.get("d_flip_flop")?.description ?? "", /上升沿/);
});

/** 展示布局按引擎端口名索引，因此 `clock` 这个端口名在两边必须一致。 */
test("d flip-flop looks up its layout by the engine clock port name", () => {
  const registry = createComponentDefinitionRegistry();
  const definition = registry.get("d_flip_flop") as ComponentDefinition;
  const ports = BUILT_IN_PORTS.d_flip_flop;
  assert.deepEqual(ports.map((port) => port.name), ["d", "clock", "q"]);
  assert.deepEqual(ports.map((port) => port.direction), ["input", "input", "output"]);
  // `CLK` 只是显示标签，与发给引擎的端口名分开。
  assert.equal(portLayoutFor(definition, "clock", "input", 1, 2).label, "CLK");
  assert.deepEqual(portLayoutFor(definition, "clock", "input", 1, 2).offset, { x: 0, y: 54 });
});

/**
 * 通用排布规则必须复现既有元件的每一个端口坐标，否则改宽这条改造就会顺手改掉画布外观。
 * 期望值逐项抄自本票之前展示定义里写死的那份坐标，因此这是一条回归基线而不只是自洽断言。
 */
test("the layout rule reproduces every built-in component's existing coordinates", () => {
  const registry = createComponentDefinitionRegistry();
  const expected: Record<ComponentKindName, Record<string, Point>> = {
    input: { out: { x: 148, y: 42 } },
    output: { in: { x: 0, y: 42 } },
    and: { in1: { x: 0, y: 30 }, in2: { x: 0, y: 54 }, out: { x: 148, y: 42 } },
    or: { in1: { x: 0, y: 30 }, in2: { x: 0, y: 54 }, out: { x: 148, y: 42 } },
    nand: { in1: { x: 0, y: 30 }, in2: { x: 0, y: 54 }, out: { x: 148, y: 42 } },
    nor: { in1: { x: 0, y: 30 }, in2: { x: 0, y: 54 }, out: { x: 148, y: 42 } },
    xor: { in1: { x: 0, y: 30 }, in2: { x: 0, y: 54 }, out: { x: 148, y: 42 } },
    xnor: { in1: { x: 0, y: 30 }, in2: { x: 0, y: 54 }, out: { x: 148, y: 42 } },
    not: { in: { x: 0, y: 42 }, out: { x: 148, y: 42 } },
    clock: { out: { x: 148, y: 42 } },
    // D Flip-Flop 是唯一一个通用规则复现不了的形状：`q` 与 `d` 对齐而不是垂直居中。
    d_flip_flop: { d: { x: 0, y: 30 }, clock: { x: 0, y: 54 }, q: { x: 148, y: 30 } },
  };

  for (const [kind, ports] of Object.entries(expected) as [ComponentKindName, Record<string, Point>][]) {
    const definition = registry.get(kind);
    assert.ok(definition, kind);
    const list = BUILT_IN_PORTS[kind];
    const sideCounts = {
      input: list.filter((port) => port.direction === "input").length,
      output: list.filter((port) => port.direction === "output").length,
    };
    const sideIndexes = { input: 0, output: 0 };
    for (const port of list) {
      const layout = portLayoutFor(definition, port.name, port.direction, sideIndexes[port.direction]++, sideCounts[port.direction]);
      assert.deepEqual(layout.offset, ports[port.name], `${kind}.${port.name}`);
    }
  }
});

/** 位宽为 1 且没有位区间的端口显示得与引入位宽之前一字不差；再宽或带区间才补上位区间。 */
test("port labels stay unchanged at width one and show the bit range above it", () => {
  assert.equal(circuitPortLabel("out", { width: 1 }), "out");
  assert.equal(circuitPortLabel("out", { width: 8 }), "out[7:0]");
  assert.equal(circuitPortLabel("Q", { width: 4 }), "Q[3:0]");
  // 显式位区间优先：拆线器的分支端口落在宿主总线的哪一段由它说了算。
  assert.equal(circuitPortLabel("out0", { width: 4, bitRange: { msb: 7, lsb: 4 } }), "out0[7:4]");
  assert.equal(circuitPortLabel("out0", { width: 1, bitRange: { msb: 3, lsb: 3 } }), "out0[3:3]");
});

test("projects a connection onto the d flip-flop clock port", () => {
  const projector = createCanvasSceneProjector(createComponentDefinitionRegistry());
  const scene = projector.project({
    document: {
      components: [
        { id: "clock-1", kind: "clock", displayName: "Clock", position: { x: 32, y: 48 }, lifecycle: "active", ports: BUILT_IN_PORTS.clock },
        { id: "dff-1", kind: "d_flip_flop", displayName: "D Flip-Flop", position: { x: 320, y: 80 }, lifecycle: "active", ports: BUILT_IN_PORTS.d_flip_flop },
      ],
      connections: [{
        id: "connection-1",
        source: { componentId: "clock-1", port: "out", point: { x: 180, y: 90 } },
        target: { componentId: "dff-1", port: "clock", point: { x: 320, y: 134 } },
        route: [{ x: 180, y: 90 }, { x: 250, y: 90 }, { x: 250, y: 134 }, { x: 320, y: 134 }],
        lifecycle: "visible",
        danglingEndpoints: [],
      }],
    },
    selection: null,
    operation: "idle",
    canUndo: false,
    canRedo: false,
    confirmation: null,
    error: null,
  }, { signals: { "clock-1:out": "1" } });

  const clockPort = scene.nodes.find((node) => node.id === "dff-1")?.ports.find((port) => port.id === "clock");
  assert.equal(clockPort?.direction, "input");
  assert.equal(clockPort?.dangling, false);
  assert.equal(scene.wires[0].target.port, "clock");
});

test("projects non-default editor identities through explicit routes and signal state", () => {
  const scene = projectCanvasScene(snapshot(), { signals: { "source-17:out": "1", "or-99:out": "X", "sink-4:in": "X" } }, createComponentDefinitionRegistry());
  assert.deepEqual(scene.nodes.map((node) => node.id), ["source-17", "or-99", "sink-4"]);
  assert.equal(scene.nodes.find((node) => node.id === "or-99")?.selected, true);
  assert.equal(scene.nodes.find((node) => node.id === "source-17")?.ports[0].signal, "1");
  assert.deepEqual(scene.wires[0].route, snapshot().document.connections[0].route);
  assert.deepEqual(scene.wires[0].danglingEndpoints, ["target"]);
  assert.equal(scene.wires[0].dangling, true);
  assert.equal(scene.wires[0].color, "blue");
  assert.equal(scene.wires[0].selected, false);
});

/** 画布按对象身份跳过重建与 DOM patch，投影器必须为未变化的对象保留身份。 */
test("keeps unchanged entity identity so the canvas can skip repatching", () => {
  const projector = createCanvasSceneProjector(createComponentDefinitionRegistry());
  const base = snapshot();
  const first = projector.project(base, { signals: {} });

  // 输入未变时连场景容器都复用，依赖场景引用的观察者不会被打扰。
  assert.equal(projector.project(base, { signals: {} }), first);

  // 拖动一个 Component：只有它和与它相连的 Wire 变化，其余节点保持对象身份。
  const dragged = projector.project(base, { signals: {} }, { "source-17": { x: 64, y: 48 } });
  assert.notEqual(dragged, first);
  assert.notEqual(dragged.nodes.find((node) => node.id === "source-17"), first.nodes.find((node) => node.id === "source-17"));
  assert.notEqual(dragged.wires[0], first.wires[0]);
  assert.equal(dragged.nodes.find((node) => node.id === "or-99"), first.nodes.find((node) => node.id === "or-99"));
  assert.equal(dragged.nodes.find((node) => node.id === "sink-4"), first.nodes.find((node) => node.id === "sink-4"));
});

/** 复用基线永远是上一次投影的结果，因此每组断言都用独立的投影器。 */
test("a signal update replaces only the entities carrying that signal", () => {
  const projector = createCanvasSceneProjector(createComponentDefinitionRegistry());
  const base = snapshot();
  const first = projector.project(base, { signals: {} });

  const signalled = projector.project(base, { signals: { "source-17:out": "1" } });
  assert.notEqual(signalled, first);
  assert.notEqual(signalled.wires[0], first.wires[0]);
  assert.notEqual(signalled.nodes.find((node) => node.id === "source-17"), first.nodes.find((node) => node.id === "source-17"));
  assert.equal(signalled.nodes.find((node) => node.id === "sink-4"), first.nodes.find((node) => node.id === "sink-4"));
});

test("a selection change replaces only the two affected nodes", () => {
  const projector = createCanvasSceneProjector(createComponentDefinitionRegistry());
  const base = snapshot();
  const first = projector.project(base, { signals: {} });

  const reselected = structuredClone(base);
  reselected.selection = { kind: "component", id: "sink-4" };
  const second = projector.project(reselected, { signals: {} });
  assert.notEqual(second.nodes.find((node) => node.id === "or-99"), first.nodes.find((node) => node.id === "or-99"));
  assert.notEqual(second.nodes.find((node) => node.id === "sink-4"), first.nodes.find((node) => node.id === "sink-4"));
  assert.equal(second.nodes.find((node) => node.id === "source-17"), first.nodes.find((node) => node.id === "source-17"));
});

/** 位宽不再匹配的连接与端点缺失的连接共用一种悬空外观，位宽匹配后自动恢复。 */
test("marks a width-mismatched connection dangling without freezing its endpoints", () => {
  const cloned = structuredClone(snapshot());
  const document: EditorSnapshot = {
    ...cloned,
    document: {
      ...cloned.document,
      // 8 位输出接 1 位输入：两端位宽不同，但两个端点都还解析得到。
      components: [
        withPorts(cloned.document.components[0]!, [{ name: "out", direction: "output", width: 8 }]),
        cloned.document.components[1]!,
        cloned.document.components[2]!,
      ],
      connections: cloned.document.connections.map((connection) => ({ ...connection, danglingEndpoints: [] })),
    },
  };

  const scene = projectCanvasScene(document, { signals: {} }, createComponentDefinitionRegistry());

  assert.equal(scene.wires[0]!.dangling, true);
  // 位宽不匹配不是端点缺失：两端仍然跟着元件位置走，因此不会被冻结在原坐标上。
  assert.deepEqual(scene.wires[0]!.danglingEndpoints, []);
  assert.deepEqual(scene.wires[0]!.source.point, { x: 180, y: 90 });
});

test("derives connected endpoint geometry from the current Component and Port definition", () => {
  const current = structuredClone(snapshot());
  current.document.components[0]!.position = { x: 96, y: 144 };
  current.document.connections[0]!.source.point = { x: -999, y: -999 };
  const scene = projectCanvasScene(current, { signals: {} }, createComponentDefinitionRegistry());
  assert.deepEqual(scene.wires[0]!.source.point, { x: 244, y: 186 });
  assert.deepEqual(scene.wires[0]!.target.point, { x: 320, y: 110 });
});
