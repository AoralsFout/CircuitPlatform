import assert from "node:assert/strict";
import test from "node:test";
import { createCanvasSceneProjector, createComponentDefinitionRegistry, isDenseCanvasScene } from "../src/canvas/index.ts";
import { createAndDemoDocument, type EditorSnapshot } from "../src/editor/index.ts";

function snapshot(): EditorSnapshot {
  return {
    document: createAndDemoDocument(),
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
  const first = projector.project(editorSnapshot, { signals: { "input-a:out": 0 } });
  const second = projector.project(editorSnapshot, { signals: { "input-a:out": 1 } });

  // The benchmark's hot path must not generate fresh point arrays when only signal state changes.
  assert.strictEqual(second.wires[0]?.route, first.wires[0]?.route);
  assert.notEqual(second.wires[0]?.signal, first.wires[0]?.signal);
  assert.equal(second.nodes[0]?.ports[0]?.signal, 1);
});

test("dense-scene fallback is only a visual-density signal", () => {
  const scene = {
    nodes: Array.from({ length: 501 }, (_, index) => ({ id: String(index) })),
    wires: [],
    bounds: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } },
  } as never;
  assert.equal(isDenseCanvasScene(scene), true);
});
