import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentKindName } from "@circuit-platform/protocol";
import {
  createAndDemoDocument,
  createEditorSession,
  type CircuitEnginePort,
  type EngineConnectionId,
  type EngineResult,
} from "../src/editor/index.ts";
import { resolveEditorShortcut } from "../src/editor/keyboard.ts";

class FakeEngine implements CircuitEnginePort {
  nextComponentId = 100;
  nextConnectionId = 200;
  readonly calls: string[] = [];
  failOn: string | null = null;

  private result<T>(operation: string, value: T): EngineResult<T> {
    this.calls.push(operation);
    if (this.failOn === operation) {
      return { ok: false, error: { code: `${operation}_failed`, message: `${operation} failed`, retryable: true } };
    }
    return { ok: true, value };
  }

  async addComponent(kind: ComponentKindName): Promise<EngineResult<{ componentId: number }>> {
    return this.result(`addComponent:${kind}`, { componentId: this.nextComponentId++ });
  }

  async addConnection(input: {
    sourceComponentId: number;
    sourcePort: string;
    targetComponentId: number;
    targetPort: string;
  }): Promise<EngineResult<{ connectionId: number }>> {
    return this.result(`addConnection:${input.sourceComponentId}->${input.targetComponentId}`, { connectionId: this.nextConnectionId++ });
  }

  async removeComponent(componentId: number): Promise<EngineResult<{ componentId: number }>> {
    return this.result(`removeComponent:${componentId}`, { componentId });
  }

  async removeConnection(connectionId: EngineConnectionId): Promise<EngineResult<{ connectionId: number }>> {
    return this.result(`removeConnection:${connectionId}`, { connectionId });
  }
}

test("maps editor keyboard shortcuts while preserving editable targets", () => {
  const key = (overrides: Partial<Parameters<typeof resolveEditorShortcut>[0]>) =>
    resolveEditorShortcut({ key: "", ctrlKey: false, metaKey: false, shiftKey: false, editableTarget: false, ...overrides });

  assert.equal(key({ key: "Delete" }), "delete-selection");
  assert.equal(key({ key: "Backspace" }), "delete-selection");
  assert.equal(key({ key: "z", ctrlKey: true }), "undo");
  assert.equal(key({ key: "z", metaKey: true, shiftKey: true }), "redo");
  assert.equal(key({ key: "Escape" }), "cancel");
  assert.equal(key({ key: "Delete", editableTarget: true }), null);
  assert.equal(key({ key: "a" }), null);
});

function createSession(engine: FakeEngine) {
  return createEditorSession({
    document: createAndDemoDocument(),
    bindings: {
      components: { "input-a": 1, "input-b": 2, "and-gate": 3, output: 4 },
      connections: { "wire-a": 10, "wire-b": 11, "wire-output": 12 },
    },
  }, engine);
}

test("deletes the selected component and keeps its visual connections dangling", async () => {
  const engine = new FakeEngine();
  const session = createSession(engine);

  await session.dispatch({ type: "select", selection: { kind: "component", id: "and-gate" } });
  const result = await session.dispatch({ type: "delete-selected" });

  assert.equal(result.ok, true);
  assert.equal(result.snapshot.document.components.some((component) => component.id === "and-gate"), false);
  assert.deepEqual(
    result.snapshot.document.connections.map((connection) => [connection.id, connection.danglingEndpoints]),
    [
      ["wire-a", ["target"]],
      ["wire-b", ["target"]],
      ["wire-output", ["source"]],
    ],
  );
  assert.deepEqual(
    result.snapshot.document.connections.find((connection) => connection.id === "wire-a")?.target.point,
    { x: 435, y: 250 },
  );
  assert.deepEqual(engine.calls, ["removeComponent:3"]);
  assert.equal(result.snapshot.selection, null);
  assert.equal("components" in result.snapshot.document, true);
  assert.equal(JSON.stringify(result.snapshot).includes("engineId"), false);
});

test("restores the local model when component deletion fails", async () => {
  const engine = new FakeEngine();
  engine.failOn = "removeComponent:3";
  const session = createSession(engine);

  await session.dispatch({ type: "select", selection: { kind: "component", id: "and-gate" } });
  const result = await session.dispatch({ type: "delete-selected" });

  assert.equal(result.ok, false);
  assert.equal(result.snapshot.document.components.find((component) => component.id === "and-gate")?.lifecycle, "active");
  assert.equal(result.snapshot.document.connections.every((connection) => connection.lifecycle === "visible"), true);
  assert.equal(result.snapshot.canUndo, false);
});

test("undo creates new engine IDs and cleans old dangling connections after rebuild", async () => {
  const engine = new FakeEngine();
  const session = createSession(engine);

  await session.dispatch({ type: "delete-component", componentId: "and-gate" });
  const result = await session.dispatch({ type: "undo" });

  assert.equal(result.ok, true);
  assert.equal(result.snapshot.document.components.find((component) => component.id === "and-gate")?.lifecycle, "active");
  assert.equal(result.snapshot.document.connections.every((connection) => connection.danglingEndpoints.length === 0), true);
  assert.deepEqual(engine.calls, [
    "removeComponent:3",
    "addComponent:and",
    "addConnection:1->100",
    "addConnection:2->100",
    "addConnection:100->4",
    "removeConnection:10",
    "removeConnection:11",
    "removeConnection:12",
  ]);
  assert.equal(result.snapshot.canRedo, true);
  assert.equal(JSON.stringify(result.snapshot).includes("engineId"), false);
});

test("redo deletes the rebuilt component using its current engine ID", async () => {
  const engine = new FakeEngine();
  const session = createSession(engine);

  await session.dispatch({ type: "delete-component", componentId: "and-gate" });
  await session.dispatch({ type: "undo" });
  const result = await session.dispatch({ type: "redo" });

  assert.equal(result.ok, true);
  assert.equal(result.snapshot.document.components.some((component) => component.id === "and-gate"), false);
  assert.equal(engine.calls.at(-1), "removeComponent:100");
  assert.equal(result.snapshot.canUndo, true);
  assert.equal(result.snapshot.canRedo, false);
});

test("compensates newly created objects when undo rebuild partially fails", async () => {
  const engine = new FakeEngine();
  const session = createSession(engine);
  await session.dispatch({ type: "delete-component", componentId: "and-gate" });
  engine.failOn = "addConnection:2->100";

  const result = await session.dispatch({ type: "undo" });

  assert.equal(result.ok, false);
  assert.equal(result.snapshot.document.components.some((component) => component.id === "and-gate"), false);
  assert.deepEqual(engine.calls.slice(-3), [
    "addConnection:2->100",
    "removeConnection:200",
    "removeComponent:100",
  ]);
  assert.equal(result.snapshot.canUndo, true);
  assert.equal(result.snapshot.operation, "idle");
});

test("requires recovery when cleanup removes only some old dangling connections", async () => {
  const engine = new FakeEngine();
  const session = createSession(engine);
  await session.dispatch({ type: "delete-component", componentId: "and-gate" });
  engine.failOn = "removeConnection:11";

  const result = await session.dispatch({ type: "undo" });

  assert.equal(result.ok, false);
  assert.equal(result.snapshot.operation, "recovery-required");
  assert.equal(result.error.code, "editor_recovery_required");
  assert.equal(engine.calls.includes("removeConnection:10"), true);
  assert.equal(engine.calls.includes("removeConnection:11"), true);
  assert.equal(engine.calls.includes("removeComponent:100"), true);
  const blocked = await session.dispatch({ type: "undo" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, "editor_recovery_required");
});

test("component undo does not resurrect an independently deleted connection", async () => {
  const engine = new FakeEngine();
  const session = createSession(engine);

  await session.dispatch({ type: "select", selection: { kind: "connection", id: "wire-a" } });
  await session.dispatch({ type: "delete-selected" });
  await session.dispatch({ type: "select", selection: { kind: "component", id: "and-gate" } });
  await session.dispatch({ type: "delete-selected" });

  const result = await session.dispatch({ type: "undo" });

  assert.equal(result.ok, true);
  assert.equal(result.snapshot.selection?.kind, "component");
  assert.equal(result.snapshot.selection?.id, "and-gate");
  assert.equal(result.snapshot.document.connections.some((connection) => connection.id === "wire-a"), false);
  assert.equal(result.snapshot.document.connections.find((connection) => connection.id === "wire-b")?.lifecycle, "visible");
  assert.equal(result.snapshot.document.connections.find((connection) => connection.id === "wire-output")?.lifecycle, "visible");
});

test("undo restores a deleted dangling wire without calling an invalid engine endpoint", async () => {
  const engine = new FakeEngine();
  const session = createSession(engine);
  await session.dispatch({ type: "delete-component", componentId: "and-gate" });
  await session.dispatch({ type: "select", selection: { kind: "connection", id: "wire-a" } });
  await session.dispatch({ type: "delete-selected" });
  const callsBeforeUndo = [...engine.calls];

  const result = await session.dispatch({ type: "undo" });

  assert.equal(result.ok, true);
  assert.deepEqual(engine.calls, callsBeforeUndo);
  assert.deepEqual(
    result.snapshot.document.connections.find((connection) => connection.id === "wire-a")?.danglingEndpoints,
    ["target"],
  );
});

test("redo removes a locally restored dangling wire without an engine call", async () => {
  const engine = new FakeEngine();
  const session = createSession(engine);
  await session.dispatch({ type: "delete-component", componentId: "and-gate" });
  await session.dispatch({ type: "delete-connection", connectionId: "wire-a" });
  await session.dispatch({ type: "undo" });
  const callsBeforeRedo = [...engine.calls];

  const result = await session.dispatch({ type: "redo" });

  assert.equal(result.ok, true);
  assert.deepEqual(engine.calls, callsBeforeRedo);
  assert.equal(result.snapshot.document.connections.some((connection) => connection.id === "wire-a"), false);
});

test("component undo rebuilds a dangling wire after its deletion was undone", async () => {
  const engine = new FakeEngine();
  const session = createSession(engine);
  await session.dispatch({ type: "delete-component", componentId: "and-gate" });
  await session.dispatch({ type: "delete-connection", connectionId: "wire-a" });
  await session.dispatch({ type: "undo" });

  const result = await session.dispatch({ type: "undo" });

  assert.equal(result.ok, true);
  assert.equal(engine.calls.includes("addConnection:1->100"), true);
  assert.deepEqual(
    result.snapshot.document.connections.find((connection) => connection.id === "wire-a")?.danglingEndpoints,
    [],
  );
});

test("rejects concurrent commands while an engine operation is pending", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const engine = new FakeEngine();
  const original = engine.removeComponent.bind(engine);
  engine.removeComponent = async (componentId) => {
    await pending;
    return original(componentId);
  };
  const session = createSession(engine);

  const first = session.dispatch({ type: "delete-component", componentId: "and-gate" });
  const busy = await session.dispatch({ type: "undo" });
  assert.equal(busy.ok, false);
  assert.equal(busy.error.code, "editor_busy");

  release();
  const completed = await first;
  assert.equal(completed.ok, true);
});
