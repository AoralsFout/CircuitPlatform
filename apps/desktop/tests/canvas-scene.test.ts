import assert from "node:assert/strict";
import test from "node:test";
import { createCanvasSceneProjector, createComponentDefinitionRegistry, projectCanvasScene } from "../src/canvas/index.ts";
import type { EditorSnapshot } from "../src/editor/index.ts";

function snapshot(): EditorSnapshot {
  return {
    document: {
      components: [
        { id: "source-17", kind: "input", displayName: "自定义输入", position: { x: 32, y: 48 }, lifecycle: "active" },
        { id: "or-99", kind: "or", displayName: "OR 99", position: { x: 320, y: 80 }, lifecycle: "active" },
        { id: "sink-4", kind: "output", displayName: "自定义输出", position: { x: 600, y: 100 }, lifecycle: "active" },
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

test("registry exposes complete display definitions and searchable aliases", () => {
  const registry = createComponentDefinitionRegistry();
  const and = registry.get("and");
  assert.equal(and?.category, "logic");
  assert.equal(and?.ports.length, 3);
  assert.equal(and?.available, true);
  assert.equal(registry.search("与门").some((definition) => definition.kind === "and"), true);
  // Clock 已经可以添加，描述与「每推进一次翻转一次」的真实行为一致。
  assert.equal(registry.get("clock")?.available, true);
  assert.equal(registry.get("clock")?.disabledReason, null);
  assert.match(registry.get("clock")?.description ?? "", /翻转/);
  assert.equal(registry.get("d_flip_flop")?.available, false);
  assert.equal(typeof registry.get("d_flip_flop")?.disabledReason, "string");
});

test("projects non-default editor identities through explicit routes and signal state", () => {
  const scene = projectCanvasScene(snapshot(), { signals: { "source-17:out": 1, "or-99:out": "X", "sink-4:in": "X" } }, createComponentDefinitionRegistry());
  assert.deepEqual(scene.nodes.map((node) => node.id), ["source-17", "or-99", "sink-4"]);
  assert.equal(scene.nodes.find((node) => node.id === "or-99")?.selected, true);
  assert.equal(scene.nodes.find((node) => node.id === "source-17")?.ports[0].signal, 1);
  assert.deepEqual(scene.wires[0].route, snapshot().document.connections[0].route);
  assert.deepEqual(scene.wires[0].danglingEndpoints, ["target"]);
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

  const signalled = projector.project(base, { signals: { "source-17:out": 1 } });
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

test("derives connected endpoint geometry from the current Component and Port definition", () => {
  const current = structuredClone(snapshot());
  current.document.components[0]!.position = { x: 96, y: 144 };
  current.document.connections[0]!.source.point = { x: -999, y: -999 };
  const scene = projectCanvasScene(current, { signals: {} }, createComponentDefinitionRegistry());
  assert.deepEqual(scene.wires[0]!.source.point, { x: 244, y: 186 });
  assert.deepEqual(scene.wires[0]!.target.point, { x: 320, y: 110 });
});
