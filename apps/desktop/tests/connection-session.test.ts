import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentKindName } from "@circuit-platform/protocol";
import { createComponentDefinitionRegistry } from "../src/canvas/index.ts";
import { createEditorSession, type CircuitEnginePort, type EngineResult } from "../src/editor/index.ts";

class Engine implements CircuitEnginePort {
  calls: string[] = [];
  nextComponent = 10;
  nextConnection = 20;
  failAddConnection = false;
  failNextAddConnection = 0;
  async addComponent(kind: ComponentKindName): Promise<EngineResult<{ componentId: number }>> {
    this.calls.push(`addComponent:${kind}`);
    return { ok: true, value: { componentId: this.nextComponent++ } };
  }
  async addConnection(input: { sourceComponentId: number; sourcePort: string; targetComponentId: number; targetPort: string }): Promise<EngineResult<{ connectionId: number }>> {
    this.calls.push(`addConnection:${input.sourcePort}->${input.targetPort}`);
    if (this.failAddConnection || this.failNextAddConnection > 0) {
      if (this.failNextAddConnection > 0) this.failNextAddConnection -= 1;
      return { ok: false, error: { code: "engine_rejected", message: "引擎拒绝了这条连接。", retryable: true } };
    }
    return { ok: true, value: { connectionId: this.nextConnection++ } };
  }
  async removeComponent(componentId: number): Promise<EngineResult<{ componentId: number }>> { this.calls.push(`removeComponent:${componentId}`); return { ok: true, value: { componentId } }; }
  async removeConnection(connectionId: number): Promise<EngineResult<{ connectionId: number }>> { this.calls.push(`removeConnection:${connectionId}`); return { ok: true, value: { connectionId } }; }
}

const components = [
  { id: "source", kind: "input" as const, displayName: "输入 1", position: { x: 0, y: 0 }, lifecycle: "active" as const },
  { id: "source-2", kind: "input" as const, displayName: "输入 2", position: { x: 0, y: 160 }, lifecycle: "active" as const },
  { id: "target", kind: "output" as const, displayName: "输出 1", position: { x: 160, y: 0 }, lifecycle: "active" as const },
  { id: "target-2", kind: "output" as const, displayName: "输出 2", position: { x: 160, y: 160 }, lifecycle: "active" as const },
];

function createSession(engine = new Engine()) {
  return { engine, session: createEditorSession({ document: { components, connections: [] }, bindings: { components: { source: 1, "source-2": 2, target: 3, "target-2": 4 }, connections: {} } }, engine) };
}

function port(componentId: string, direction: "input" | "output", point: { x: number; y: number }) {
  return { componentId, port: direction === "input" ? "in" : "out", direction, point };
}

test("connection submission normalizes input-first order and supports output fan-out", async () => {
  const { session } = createSession();
  const first = await session.dispatch({ type: "create-connection", left: port("target", "input", { x: 160, y: 42 }), right: port("source", "output", { x: 148, y: 42 }) });
  assert.equal(first.ok, true);
  assert.deepEqual(first.snapshot.document.connections[0].source, { componentId: "source", port: "out", point: { x: 148, y: 42 } });
  const second = await session.dispatch({ type: "create-connection", left: port("source", "output", { x: 148, y: 42 }), right: port("target-2", "input", { x: 160, y: 202 }) });
  assert.equal(second.ok, true);
  assert.equal(second.snapshot.document.connections.length, 2);
});

/** 展示定义的端口 id 原样发给引擎，所以时钟端口必须叫 `clock`，否则连线会被引擎拒绝。 */
test("connects the d flip-flop clock port with the engine port name", async () => {
  const registry = createComponentDefinitionRegistry();
  const clockOut = registry.get("clock")?.ports.find((candidate) => candidate.direction === "output");
  const clockInput = registry.get("d_flip_flop")?.ports.find((candidate) => candidate.id === "clock");
  assert.equal(clockOut?.id, "out");
  assert.equal(clockInput?.direction, "input");

  const engine = new Engine();
  const session = createEditorSession({
    document: {
      components: [
        { id: "clock-1", kind: "clock", displayName: "Clock", position: { x: 0, y: 0 }, lifecycle: "active" },
        { id: "dff-1", kind: "d_flip_flop", displayName: "D Flip-Flop", position: { x: 160, y: 0 }, lifecycle: "active" },
      ],
      connections: [],
    },
    bindings: { components: { "clock-1": 1, "dff-1": 2 }, connections: {} },
  }, engine);

  const created = await session.dispatch({
    type: "create-connection",
    left: { componentId: "clock-1", port: clockOut?.id ?? "", direction: "output", point: { x: 148, y: 42 } },
    right: { componentId: "dff-1", port: clockInput?.id ?? "", direction: "input", point: { x: 160, y: 54 } },
  });

  assert.equal(created.ok, true);
  assert.equal(engine.calls.includes("addConnection:out->clock"), true);
  assert.deepEqual(created.snapshot.document.connections[0].target, { componentId: "dff-1", port: "clock", point: { x: 160, y: 54 } });
});

test("occupied input is rejected while fan-out to another input remains independent", async () => {
  const { session } = createSession();
  await session.dispatch({ type: "create-connection", left: port("source", "output", { x: 148, y: 42 }), right: port("target", "input", { x: 160, y: 42 }) });
  const rejected = await session.dispatch({ type: "create-connection", left: port("source-2", "output", { x: 148, y: 202 }), right: port("target", "input", { x: 160, y: 42 }) });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "input_already_connected");
  assert.equal(session.snapshot().document.connections.length, 1);
});

test("failed structure submission publishes no half wire and can be retried with the same route intent", async () => {
  const engine = new Engine();
  engine.failAddConnection = true;
  const { session } = createSession(engine);
  const route = [{ x: 148, y: 42 }, { x: 176, y: 42 }, { x: 176, y: 96 }, { x: 160, y: 96 }];
  const failed = await session.dispatch({ type: "create-connection", left: port("source", "output", { x: 148, y: 42 }), right: port("target", "input", { x: 160, y: 96 }), route });
  assert.equal(failed.ok, false);
  assert.equal(failed.snapshot.document.connections.length, 0);
  assert.deepEqual(route[1], { x: 176, y: 42 });
});

test("created wire is one history frame and undo/redo keeps its editor identity", async () => {
  const { session } = createSession();
  const created = await session.dispatch({ type: "create-connection", left: port("source", "output", { x: 148, y: 42 }), right: port("target", "input", { x: 160, y: 42 }) });
  const id = created.snapshot.document.connections[0].id;
  await session.dispatch({ type: "undo" });
  assert.equal(session.snapshot().document.connections.length, 0);
  const redone = await session.dispatch({ type: "redo" });
  assert.equal(redone.ok, true);
  assert.equal(redone.snapshot.document.connections[0].id, id);
});

test("wire colors are independent from Circuit state and participate in local undo history", async () => {
  const { engine, session } = createSession();
  const created = await session.dispatch({
    type: "create-connection",
    left: port("source", "output", { x: 148, y: 42 }),
    right: port("target", "input", { x: 160, y: 42 }),
    color: "violet",
  });
  const connectionId = created.snapshot.document.connections[0]!.id;
  assert.equal(created.snapshot.document.connections[0]!.color, "violet");
  const engineCallsAfterCreate = engine.calls.length;

  const changed = await session.dispatch({ type: "set-wire-color", connectionId, color: "pink" });
  assert.equal(changed.snapshot.document.connections[0]!.color, "pink");
  assert.equal(engine.calls.length, engineCallsAfterCreate);

  const undone = await session.dispatch({ type: "undo" });
  assert.equal(undone.snapshot.document.connections[0]!.color, "violet");
  const redone = await session.dispatch({ type: "redo" });
  assert.equal(redone.snapshot.document.connections[0]!.color, "pink");
  assert.equal(engine.calls.length, engineCallsAfterCreate);
});

test("reconnects an occupied input in one transaction while retaining the editor connection identity", async () => {
  const { engine, session } = createSession();
  const created = await session.dispatch({ type: "create-connection", left: port("source", "output", { x: 148, y: 42 }), right: port("target", "input", { x: 160, y: 42 }) });
  assert.equal(created.ok, true);
  const id = created.snapshot.document.connections[0].id;
  const reconnected = await session.dispatch({ type: "reconnect-connection", connectionId: id, left: port("source-2", "output", { x: 148, y: 202 }), right: port("target", "input", { x: 160, y: 42 }) });
  assert.equal(reconnected.ok, true);
  assert.equal(reconnected.snapshot.document.connections[0].id, id);
  assert.equal(reconnected.snapshot.document.connections[0].source.componentId, "source-2");
  assert.deepEqual(engine.calls.slice(-2), ["removeConnection:20", "addConnection:out->in"]);
  await session.dispatch({ type: "undo" });
  const redone = await session.dispatch({ type: "redo" });
  assert.equal(redone.ok, true);
  assert.equal(redone.snapshot.document.connections[0].id, id);
});

test("repairs a dangling endpoint by adding the replacement before deleting the old engine connection", async () => {
  const engine = new Engine();
  const session = createEditorSession({
    document: {
      components: [components[1], components[2]],
      connections: [{ id: "wire", source: { componentId: "deleted-source", port: "out", point: { x: 0, y: 42 } }, target: { componentId: "target", port: "in", point: { x: 160, y: 42 } }, lifecycle: "visible", danglingEndpoints: ["source"] }],
    },
    bindings: { components: { "source-2": 2, target: 3 }, connections: { wire: 77 } },
  }, engine);
  const repaired = await session.dispatch({ type: "reconnect-connection", connectionId: "wire", left: port("deleted-source", "output", { x: 0, y: 42 }), right: port("source-2", "output", { x: 148, y: 202 }) });
  assert.equal(repaired.ok, true);
  assert.deepEqual(repaired.snapshot.document.connections[0].danglingEndpoints, []);
  assert.equal(repaired.snapshot.document.connections[0].source.componentId, "source-2");
  assert.deepEqual(engine.calls.slice(-2), ["addConnection:out->in", "removeConnection:77"]);
});

test("failed occupied-input reconnect restores the old binding and remains retryable", async () => {
  const { engine, session } = createSession();
  await session.dispatch({ type: "create-connection", left: port("source", "output", { x: 148, y: 42 }), right: port("target", "input", { x: 160, y: 42 }) });
  engine.failNextAddConnection = 1;
  const failed = await session.dispatch({ type: "reconnect-connection", connectionId: "connection-1", left: port("source-2", "output", { x: 148, y: 202 }), right: port("target", "input", { x: 160, y: 42 }) });
  assert.equal(failed.ok, false);
  assert.equal(failed.snapshot.operation, "idle");
  assert.equal(failed.snapshot.document.connections[0].source.componentId, "source");
  assert.equal(failed.snapshot.canUndo, true);
  const retry = await session.dispatch({ type: "reconnect-connection", connectionId: "connection-1", left: port("source-2", "output", { x: 148, y: 202 }), right: port("target", "input", { x: 160, y: 42 }) });
  assert.equal(retry.ok, true);
  assert.equal(retry.snapshot.document.connections[0].source.componentId, "source-2");
});

test("compensation failure puts reconnect into recovery-required without exposing engine IDs", async () => {
  const { engine, session } = createSession();
  await session.dispatch({ type: "create-connection", left: port("source", "output", { x: 148, y: 42 }), right: port("target", "input", { x: 160, y: 42 }) });
  engine.failAddConnection = true;
  const failed = await session.dispatch({ type: "reconnect-connection", connectionId: "connection-1", left: port("source-2", "output", { x: 148, y: 202 }), right: port("target", "input", { x: 160, y: 42 }) });
  assert.equal(failed.ok, false);
  assert.equal(failed.snapshot.operation, "recovery-required");
  assert.equal(JSON.stringify(failed.snapshot).includes("engineId"), false);
  const blocked = await session.dispatch({ type: "reconnect-connection", connectionId: "connection-1", left: port("source-2", "output", { x: 148, y: 202 }), right: port("target", "input", { x: 160, y: 42 }) });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, "editor_recovery_required");
});
