import assert from "node:assert/strict";
import test from "node:test";
import { createCanvasSceneProjector, createComponentDefinitionRegistry, isDenseCanvasScene } from "../src/canvas/index.ts";
import { createAndDemoDocument, type EditorDocument, type EditorSnapshot } from "../src/editor/index.ts";
import { portsForAddComponent } from "./fake-ports.ts";

/** 给示例文档补上引擎回传的端口清单：没有清单就画不出端口，性能断言也就无从谈起。 */
function documentWithPorts(): EditorDocument {
  const document = createAndDemoDocument();
  return {
    ...document,
    components: document.components.map((component) => ({
      ...component,
      ports: portsForAddComponent(component.kind),
    })),
  };
}

function snapshot(): EditorSnapshot {
  return {
    document: documentWithPorts(),
    selection: null,
    operation: "idle",
    canUndo: false,
    canRedo: false,
    confirmation: null,
    error: null,
  };
}

test("signal updates reuse cached Route geometry", () => {
  const projector = createCanvasSceneProjector(createComponentDefinitionRegistry());
  const editorSnapshot = snapshot();
  const first = projector.project(editorSnapshot, { signals: { "input-a:out": "0" } });
  const second = projector.project(editorSnapshot, { signals: { "input-a:out": "1" } });

  // The benchmark's hot path must not generate fresh point arrays when only signal state changes.
  assert.strictEqual(second.wires[0]?.route, first.wires[0]?.route);
  assert.notEqual(second.wires[0]?.signal, first.wires[0]?.signal);
  assert.equal(second.nodes[0]?.ports[0]?.signal, "1");
});

test("signal updates reuse Route geometry during a stable route preview", () => {
  const projector = createCanvasSceneProjector(createComponentDefinitionRegistry());
  const editorSnapshot = snapshot();
  const previewRoute = [{ x: 200, y: 80 }, { x: 240, y: 80 }, { x: 240, y: 160 }];
  const previewRoutes = { "wire-a": previewRoute };
  const first = projector.project(editorSnapshot, { signals: { "input-a:out": "0" } }, undefined, previewRoutes);
  const second = projector.project(editorSnapshot, { signals: { "input-a:out": "1" } }, undefined, previewRoutes);

  assert.strictEqual(second.wires[0]?.route, first.wires[0]?.route);
});

test("dense-scene fallback is only a visual-density signal", () => {
  const scene = {
    nodes: Array.from({ length: 501 }, (_, index) => ({ id: String(index) })),
    wires: [],
    bounds: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } },
  } as never;
  assert.equal(isDenseCanvasScene(scene), true);
});
