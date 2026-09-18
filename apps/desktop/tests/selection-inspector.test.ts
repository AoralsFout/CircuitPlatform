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
        { id: "in1", name: "in1", direction: "input", point: { x: 100, y: 130 }, offset: { x: 0, y: 30 }, signal: "1", dangling: false },
        { id: "out", name: "out", direction: "output", point: { x: 248, y: 142 }, offset: { x: 148, y: 42 }, signal: "1", dangling: false },
      ],
    }],
    wires: [{
      id: "wire-1", source: { componentId: "source", port: "out", point: { x: 0, y: 142 } },
      target: { componentId: "and-1", port: "in1", point: { x: 100, y: 130 } },
      route: [{ x: 0, y: 142 }, { x: 50, y: 142 }, { x: 50, y: 130 }, { x: 100, y: 130 }],
      waypoints: [{ x: 50, y: 142 }, { x: 50, y: 130 }],
      signal: "1", danglingEndpoints: [], selected: false,
    }],
    bounds: { min: { x: 0, y: 100 }, max: { x: 248, y: 184 } },
  };
}

test("hit testing honors Port, selected Wire handles, node, Wire, then background priority", () => {
  const current = scene();
  assert.deepEqual(hitTestCanvas(current, { x: 100, y: 130 }), { kind: "port", nodeId: "and-1", portId: "in1" });
  const segmentScene = scene();
  segmentScene.wires[0].route = [{ x: 0, y: 142 }, { x: 50, y: 142 }, { x: 50, y: 110 }, { x: 100, y: 110 }];
  assert.deepEqual(hitTestCanvas(segmentScene, { x: 50, y: 126 }, { selectedConnectionId: "wire-1" }), { kind: "wire-handle", connectionId: "wire-1", handle: "segment", index: 1 });
  assert.deepEqual(hitTestCanvas(current, { x: 25, y: 142 }, { selectedConnectionId: "wire-1" }), { kind: "wire", connectionId: "wire-1" });
  assert.deepEqual(hitTestCanvas(current, { x: 120, y: 170 }), { kind: "component", nodeId: "and-1" });
  assert.deepEqual(hitTestCanvas(current, { x: 50, y: 130 }), { kind: "wire", connectionId: "wire-1" });
  assert.deepEqual(hitTestCanvas(current, { x: 500, y: 500 }), { kind: "background" });
});

test("object context actions keep Component and Wire vocabulary separate", () => {
  assert.deepEqual(contextActionsFor({ kind: "component", nodeId: "and-1" }).map((item) => item.id), ["copy-component", "delete-component"]);
  assert.deepEqual(contextActionsFor({ kind: "wire", connectionId: "wire-1" }).map((item) => item.id), ["edit-route", "reset-route", "delete-connection"]);
  assert.deepEqual(contextActionsFor({ kind: "wire-handle", connectionId: "wire-1", handle: "segment", index: 0 }).map((item) => item.id), ["edit-route", "reset-route", "delete-connection"]);
  assert.deepEqual(contextActionsFor({ kind: "wire-handle", connectionId: "wire-1", handle: "waypoint", index: 1 }).map((item) => item.id), ["edit-route", "delete-waypoint", "reset-route", "delete-connection"]);
  assert.deepEqual(contextActionsFor({ kind: "port", nodeId: "and-1", portId: "in1" }), []);
});

/** 没有接时钟的 D Flip-Flop 每一步都不更新：这是结构问题，检查器给出一行提示而不是报错。 */
test("inspector hints when the d flip-flop clock port has no connection", () => {
  const registry = createComponentDefinitionRegistry();
  const flipFlopPorts = registry.get("d_flip_flop")!.ports;
  const unconnectedClock: CanvasScene = {
    nodes: [{
      id: "dff-1", kind: "d_flip_flop", displayName: "D Flip-Flop", symbol: "D", description: "在 clock 端口的上升沿把 D 采样进 Q。",
      position: { x: 100, y: 100 }, size: { width: 148, height: 84 }, selected: true,
      ports: flipFlopPorts.map((definition) => ({
        id: definition.id, name: definition.name, direction: definition.direction,
        point: { x: 100 + definition.offset.x, y: 100 + definition.offset.y }, offset: { ...definition.offset },
        signal: "X", dangling: false,
      })),
    }],
    wires: [{
      id: "wire-1", source: { componentId: "source", port: "out", point: { x: 0, y: 130 } },
      target: { componentId: "dff-1", port: "d", point: { x: 100, y: 130 } },
      route: [{ x: 0, y: 130 }, { x: 50, y: 130 }, { x: 50, y: 130 }, { x: 100, y: 130 }],
      signal: "1", danglingEndpoints: [], selected: false,
    }],
    bounds: { min: { x: 0, y: 100 }, max: { x: 248, y: 184 } },
  };

  const model = createInspectorModel(unconnectedClock, { kind: "component", id: "dff-1" }, registry);
  assert.equal(model?.kind, "component");
  if (model?.kind === "component") {
    assert.equal(model.ports.find((port) => port.id === "clock")?.connectionState, "unconnected");
    assert.match(model.hint ?? "", /clock 端口未连接/);
  }

  // 时钟接上之后提示消失。
  const connectedClock: CanvasScene = {
    ...unconnectedClock,
    wires: [...unconnectedClock.wires, {
      id: "wire-2", source: { componentId: "clock-source", port: "out", point: { x: 0, y: 154 } },
      target: { componentId: "dff-1", port: "clock", point: { x: 100, y: 154 } },
      route: [{ x: 0, y: 154 }, { x: 50, y: 154 }, { x: 50, y: 154 }, { x: 100, y: 154 }],
      signal: "0", danglingEndpoints: [], selected: false,
    }],
  };
  const connected = createInspectorModel(connectedClock, { kind: "component", id: "dff-1" }, registry);
  assert.equal(connected?.kind === "component" ? connected.hint : "missing", null);
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
      signal: "1", status: "normal", waypointCount: 2,
    });
  }
});
