import assert from "node:assert/strict";
import test from "node:test";
import { createComponentDefinitionRegistry, hitTestCanvas, type CanvasScene } from "../src/canvas/index.ts";
import { contextActionsFor } from "../src/editor/context-menu.ts";
import { createInspectorModel } from "../src/editor/inspector.ts";

function scene(): CanvasScene {
  return {
    nodes: [{
      id: "and-1", kind: "and", displayName: "AND 1", symbol: "&", description: "所有输入为 1 时输出 1。",
      position: { x: 100, y: 100 }, size: { width: 148, height: 84 }, selected: true,
      ports: [
        { id: "in1", name: "in1", direction: "input", point: { x: 100, y: 130 }, offset: { x: 0, y: 30 }, signal: 1, dangling: false },
        { id: "out", name: "out", direction: "output", point: { x: 248, y: 142 }, offset: { x: 148, y: 42 }, signal: 1, dangling: false },
      ],
    }],
    wires: [{
      id: "wire-1", source: { componentId: "source", port: "out", point: { x: 0, y: 142 } },
      target: { componentId: "and-1", port: "in1", point: { x: 100, y: 130 } },
      route: [{ x: 0, y: 142 }, { x: 50, y: 142 }, { x: 50, y: 130 }, { x: 100, y: 130 }],
      waypoints: [{ x: 50, y: 142 }, { x: 50, y: 130 }],
      signal: 1, danglingEndpoints: [], selected: false,
    }],
    bounds: { min: { x: 0, y: 100 }, max: { x: 248, y: 184 } },
  };
}

test("hit testing honors Port, selected Wire handles, node, Wire, then background priority", () => {
  const current = scene();
  assert.deepEqual(hitTestCanvas(current, { x: 100, y: 130 }), { kind: "port", nodeId: "and-1", portId: "in1" });
  assert.deepEqual(hitTestCanvas(current, { x: 25, y: 142 }, { selectedConnectionId: "wire-1" }), { kind: "wire-handle", connectionId: "wire-1", handle: "segment", index: 0 });
  assert.deepEqual(hitTestCanvas(current, { x: 120, y: 170 }), { kind: "component", nodeId: "and-1" });
  assert.deepEqual(hitTestCanvas(current, { x: 50, y: 130 }), { kind: "wire", connectionId: "wire-1" });
  assert.deepEqual(hitTestCanvas(current, { x: 500, y: 500 }), { kind: "background" });
});

test("object context actions keep Component and Wire vocabulary separate", () => {
  assert.deepEqual(contextActionsFor({ kind: "component", nodeId: "and-1" }).map((item) => item.id), ["copy-component", "delete-component"]);
  assert.deepEqual(contextActionsFor({ kind: "wire", connectionId: "wire-1" }).map((item) => item.id), ["edit-route", "reset-route", "delete-connection"]);
  assert.deepEqual(contextActionsFor({ kind: "wire-handle", connectionId: "wire-1", handle: "segment", index: 0 }).map((item) => item.id), ["edit-route", "reset-route", "delete-connection"]);
  assert.deepEqual(contextActionsFor({ kind: "port", nodeId: "and-1", portId: "in1" }), []);
});

test("inspector projects read-only Component ports and Wire endpoints", () => {
  const current = scene();
  const registry = createComponentDefinitionRegistry();
  const component = createInspectorModel(current, { kind: "component", id: "and-1" }, registry);
  assert.equal(component?.kind, "component");
  if (component?.kind === "component") {
    assert.equal(component.type, "AND 门");
    assert.equal(component.behavior, "所有输入为 1 时输出 1。");
    assert.equal(component.ports[0].connectionState, "connected");
    assert.equal(component.ports[1].connectionState, "unconnected");
    assert.equal("position" in component, false);
  }
  const wire = createInspectorModel(current, { kind: "connection", id: "wire-1" }, registry);
  assert.equal(wire?.kind, "wire");
  if (wire?.kind === "wire") {
    assert.deepEqual({
      kind: wire.kind, source: wire.source, target: wire.target, signal: wire.signal,
      status: wire.status, waypointCount: wire.waypointCount,
    }, {
      kind: "wire", source: { componentId: "source", port: "out" }, target: { componentId: "and-1", port: "in1" },
      signal: 1, status: "normal", waypointCount: 2,
    });
  }
});
