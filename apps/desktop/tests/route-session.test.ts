import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentKindName } from "@circuit-platform/protocol";
import {
  createEditorSession,
  type CircuitEnginePort,
  type EngineResult,
} from "../src/editor/index.ts";

class LocalEngine implements CircuitEnginePort {
  async addComponent(_kind: ComponentKindName): Promise<EngineResult<{ componentId: number }>> { return { ok: true, value: { componentId: 10 } }; }
  async addConnection(): Promise<EngineResult<{ connectionId: number }>> { return { ok: true, value: { connectionId: 1 } }; }
  async removeComponent(componentId: number): Promise<EngineResult<{ componentId: number }>> { return { ok: true, value: { componentId } }; }
  async removeConnection(connectionId: number): Promise<EngineResult<{ connectionId: number }>> { return { ok: true, value: { connectionId } }; }
}

function createSession() {
  return createEditorSession({
    document: {
      components: [
        { id: "source", kind: "input", displayName: "输入 1", position: { x: 0, y: 0 }, lifecycle: "active" },
        { id: "target", kind: "output", displayName: "输出 1", position: { x: 160, y: 0 }, lifecycle: "active" },
      ],
      connections: [{
        id: "wire",
        source: { componentId: "source", port: "out", point: { x: 148, y: 42 } },
        target: { componentId: "target", port: "in", point: { x: 160, y: 42 } },
        route: [{ x: 148, y: 42 }, { x: 180, y: 42 }, { x: 180, y: 80 }, { x: 160, y: 80 }, { x: 160, y: 42 }],
        lifecycle: "visible",
        danglingEndpoints: [],
      }],
    },
    bindings: { components: { source: 1, target: 2 }, connections: { wire: 3 } },
  }, new LocalEngine());
}

test("route drag is a local one-frame history command and undo restores the route", async () => {
  const session = createSession();
  const before = session.snapshot().document.connections[0].route;
  const edited = await session.dispatch({ type: "move-route-waypoint", connectionId: "wire", pointIndex: 2, delta: { x: 32, y: 0 } });
  assert.equal(edited.ok, true);
  assert.equal(edited.snapshot.canUndo, true);
  assert.notDeepEqual(edited.snapshot.document.connections[0].route, before);
  const undone = await session.dispatch({ type: "undo" });
  assert.deepEqual(undone.snapshot.document.connections[0].route, before);
  const redone = await session.dispatch({ type: "redo" });
  assert.deepEqual(redone.snapshot.document.connections[0].route, edited.snapshot.document.connections[0].route);
});

test("deleting a waypoint and resetting a route each create one undoable command", async () => {
  const session = createSession();
  const deleted = await session.dispatch({ type: "delete-waypoint", connectionId: "wire", pointIndex: 2 });
  assert.equal(deleted.ok, true);
  const restored = await session.dispatch({ type: "undo" });
  assert.equal(restored.snapshot.document.connections[0].route?.length, 5);
  const reset = await session.dispatch({ type: "reset-route", connectionId: "wire" });
  assert.equal(reset.ok, true);
  const resetUndo = await session.dispatch({ type: "undo" });
  assert.equal(resetUndo.ok, true);
  assert.equal(resetUndo.snapshot.canUndo, false);
});

test("moving a Component changes connected endpoints but keeps internal waypoint world coordinates", async () => {
  const session = createSession();
  const before = session.snapshot().document.connections[0].route!;
  const moved = await session.dispatch({ type: "move-component", componentId: "source", position: { x: 32, y: 16 } });
  assert.equal(moved.ok, true);
  const after = moved.snapshot.document.connections[0].route!;
  assert.deepEqual(after[2], before[2]);
  assert.deepEqual(after[3], before[3]);
});
