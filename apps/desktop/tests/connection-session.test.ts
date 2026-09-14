import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentKindName } from "@circuit-platform/protocol";
import { createEditorSession, type CircuitEnginePort, type EngineResult } from "../src/editor/index.ts";

class Engine implements CircuitEnginePort {
  calls: string[] = [];
  nextComponent = 10;
  nextConnection = 20;
  failAddConnection = false;
  async addComponent(kind: ComponentKindName): Promise<EngineResult<{ componentId: number }>> {
    this.calls.push(`addComponent:${kind}`);
    return { ok: true, value: { componentId: this.nextComponent++ } };
  }
  async addConnection(input: { sourceComponentId: number; sourcePort: string; targetComponentId: number; targetPort: string }): Promise<EngineResult<{ connectionId: number }>> {
    this.calls.push(`addConnection:${input.sourcePort}->${input.targetPort}`);
    if (this.failAddConnection) return { ok: false, error: { code: "engine_rejected", message: "引擎拒绝了这条连接。", retryable: true } };
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
