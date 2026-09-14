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
  readonly failures = new Map<string, number>();

  private result<T>(operation: string, value: T): EngineResult<T> {
    this.calls.push(operation);
    const remainingFailures = this.failures.get(operation) ?? 0;
    if (remainingFailures > 0) {
      this.failures.set(operation, remainingFailures - 1);
    }
    if (this.failOn === operation || remainingFailures > 0) {
      return { ok: false, error: { code: `${operation}_failed`, message: `${operation} failed`, retryable: true } };
    }
    return { ok: true, value };
  }

  failNext(operation: string, count = 1): void {
    this.failures.set(operation, count);
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
  assert.equal(key({ key: "d", ctrlKey: true }), "duplicate-selection");
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

test("requests and cancels clear without changing the document or selection", async () => {
  const engine = new FakeEngine();
  const session = createSession(engine);
  await session.dispatch({ type: "select", selection: { kind: "component", id: "and-gate" } });
  const before = session.snapshot();

  const requested = await session.dispatch({ type: "request-clear" });

  assert.equal(requested.ok, true);
  assert.deepEqual(requested.snapshot.confirmation, {
    type: "clear-document",
    componentCount: 4,
    connectionCount: 3,
  });
  assert.deepEqual(requested.snapshot.document, before.document);
  assert.deepEqual(requested.snapshot.selection, before.selection);
  assert.deepEqual(engine.calls, []);

  const blocked = await session.dispatch({ type: "undo" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, "confirmation_pending");

  const cancelled = await session.dispatch({ type: "cancel-current-operation" });
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.snapshot.confirmation, null);
  assert.deepEqual(cancelled.snapshot.selection, before.selection);
  assert.deepEqual(cancelled.snapshot.document, before.document);
  assert.deepEqual(engine.calls, []);
});

test("cancel clears the current selection when no confirmation is open", async () => {
  const engine = new FakeEngine();
  const session = createSession(engine);
  await session.dispatch({ type: "select", selection: { kind: "connection", id: "wire-a" } });

  const cancelled = await session.dispatch({ type: "cancel-current-operation" });

  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.snapshot.selection, null);
  assert.equal(cancelled.snapshot.confirmation, null);
  assert.deepEqual(engine.calls, []);
});

test("clear removes connections before components and records one history frame", async () => {
  const engine = new FakeEngine();
  const session = createSession(engine);
  await session.dispatch({ type: "request-clear" });

  const cleared = await session.dispatch({ type: "confirm-clear" });

  assert.equal(cleared.ok, true);
  assert.deepEqual(cleared.snapshot.document, { components: [], connections: [] });
  assert.equal(cleared.snapshot.canUndo, true);
  assert.equal(cleared.snapshot.canRedo, false);
  assert.equal(cleared.snapshot.confirmation, null);
  assert.deepEqual(engine.calls, [
    "removeConnection:10",
    "removeConnection:11",
    "removeConnection:12",
    "removeComponent:1",
    "removeComponent:2",
    "removeComponent:3",
    "removeComponent:4",
  ]);
});

test("clear requires confirmation and does not reopen confirmation for an empty canvas", async () => {
  const engine = new FakeEngine();
  const session = createSession(engine);

  const unconfirmed = await session.dispatch({ type: "confirm-clear" });
  assert.equal(unconfirmed.ok, false);
  assert.equal(unconfirmed.error.code, "confirmation_required");
  assert.deepEqual(engine.calls, []);

  await session.dispatch({ type: "request-clear" });
  await session.dispatch({ type: "confirm-clear" });
  const empty = await session.dispatch({ type: "request-clear" });
  assert.equal(empty.ok, false);
  assert.equal(empty.error.code, "nothing_to_clear");
  assert.equal(empty.snapshot.confirmation, null);
});

test("undo and redo treat clear as one recoverable command with refreshed engine IDs", async () => {
  const engine = new FakeEngine();
  const session = createSession(engine);
  await session.dispatch({ type: "select", selection: { kind: "component", id: "and-gate" } });
  await session.dispatch({ type: "request-clear" });
  await session.dispatch({ type: "confirm-clear" });

  const restored = await session.dispatch({ type: "undo" });

  assert.equal(restored.ok, true);
  assert.deepEqual(restored.snapshot.document, createAndDemoDocument());
  assert.deepEqual(restored.snapshot.selection, { kind: "component", id: "and-gate" });
  assert.equal(restored.snapshot.canRedo, true);
  assert.deepEqual(engine.calls.slice(-7), [
    "addComponent:input",
    "addComponent:input",
    "addComponent:and",
    "addComponent:output",
    "addConnection:100->102",
    "addConnection:101->102",
    "addConnection:102->103",
  ]);

  const redone = await session.dispatch({ type: "redo" });

  assert.equal(redone.ok, true);
  assert.deepEqual(redone.snapshot.document, { components: [], connections: [] });
  assert.deepEqual(engine.calls.slice(-7), [
    "removeConnection:200",
    "removeConnection:201",
    "removeConnection:202",
    "removeComponent:100",
    "removeComponent:101",
    "removeComponent:102",
    "removeComponent:103",
  ]);
});

test("clear compensates a partial component deletion and publishes refreshed bindings", async () => {
  const engine = new FakeEngine();
  engine.failNext("removeComponent:2");
  let latestBindings: unknown = null;
  const session = createEditorSession({
    document: createAndDemoDocument(),
    bindings: {
      components: { "input-a": 1, "input-b": 2, "and-gate": 3, output: 4 },
      connections: { "wire-a": 10, "wire-b": 11, "wire-output": 12 },
    },
  }, engine, {
    onBindingsChanged(bindings) {
      latestBindings = bindings;
    },
  });
  await session.dispatch({ type: "request-clear" });

  const result = await session.dispatch({ type: "confirm-clear" });

  assert.equal(result.ok, false);
  assert.equal(result.snapshot.operation, "idle");
  assert.deepEqual(result.snapshot.document, createAndDemoDocument());
  assert.equal(result.snapshot.canUndo, false);
  assert.deepEqual(latestBindings, {
    components: { "input-a": 100, "input-b": 2, "and-gate": 3, output: 4 },
    connections: { "wire-a": 200, "wire-b": 201, "wire-output": 202 },
  });
});

test("clear enters recovery when compensation cannot restore a partial deletion", async () => {
  const engine = new FakeEngine();
  engine.failNext("removeComponent:2");
  engine.failNext("addComponent:input");
  const session = createSession(engine);
  await session.dispatch({ type: "request-clear" });

  const result = await session.dispatch({ type: "confirm-clear" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "editor_recovery_required");
  assert.equal(result.snapshot.operation, "recovery-required");
  const blocked = await session.dispatch({ type: "undo" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, "editor_recovery_required");
});

test("clear preserves bound dangling connections when a component deletion is compensated", async () => {
  const engine = new FakeEngine();
  const session = createSession(engine);
  await session.dispatch({ type: "delete-component", componentId: "and-gate" });
  await session.dispatch({ type: "request-clear" });
  engine.failNext("removeComponent:2");
  const callsBeforeClear = engine.calls.length;

  const result = await session.dispatch({ type: "confirm-clear" });

  assert.equal(result.ok, false);
  assert.equal(result.snapshot.operation, "idle");
  assert.deepEqual(
    result.snapshot.document.connections.map((connection) => [connection.id, connection.danglingEndpoints]),
    [
      ["wire-a", ["target"]],
      ["wire-b", ["target"]],
      ["wire-output", ["source"]],
    ],
  );
  assert.equal(
    engine.calls.slice(callsBeforeClear).some((call) => call.startsWith("removeConnection:")),
    false,
  );
});

test("failed clear undo removes the objects it created and remains undoable", async () => {
  const engine = new FakeEngine();
  const session = createSession(engine);
  await session.dispatch({ type: "request-clear" });
  await session.dispatch({ type: "confirm-clear" });
  engine.failNext("addConnection:101->102");

  const result = await session.dispatch({ type: "undo" });

  assert.equal(result.ok, false);
  assert.equal(result.snapshot.operation, "idle");
  assert.deepEqual(result.snapshot.document, { components: [], connections: [] });
  assert.equal(result.snapshot.canUndo, true);
  assert.deepEqual(engine.calls.slice(-6), [
    "addConnection:101->102",
    "removeConnection:200",
    "removeComponent:103",
    "removeComponent:102",
    "removeComponent:101",
    "removeComponent:100",
  ]);
});

test("failed clear undo preserves pre-existing dangling connection bindings", async () => {
  const engine = new FakeEngine();
  const session = createSession(engine);
  await session.dispatch({ type: "delete-component", componentId: "and-gate" });
  await session.dispatch({ type: "request-clear" });
  await session.dispatch({ type: "confirm-clear" });
  engine.failNext("addComponent:input");

  const failedUndo = await session.dispatch({ type: "undo" });
  assert.equal(failedUndo.ok, false);
  assert.equal(failedUndo.snapshot.operation, "idle");

  const restored = await session.dispatch({ type: "undo" });
  assert.equal(restored.ok, true);
  const callsBeforeDelete = engine.calls.length;
  const deleted = await session.dispatch({ type: "delete-connection", connectionId: "wire-b" });

  assert.equal(deleted.ok, true);
  assert.deepEqual(engine.calls.slice(callsBeforeDelete), ["removeConnection:11"]);
});

test("clear handles local-only dangling wires without creating invalid engine connections", async () => {
  const engine = new FakeEngine();
  const session = createSession(engine);
  await session.dispatch({ type: "delete-component", componentId: "and-gate" });
  await session.dispatch({ type: "delete-connection", connectionId: "wire-a" });
  await session.dispatch({ type: "undo" });
  await session.dispatch({ type: "request-clear" });
  const callsBeforeClear = [...engine.calls];

  const cleared = await session.dispatch({ type: "confirm-clear" });
  const restored = await session.dispatch({ type: "undo" });

  assert.equal(cleared.ok, true);
  assert.equal(restored.ok, true);
  assert.deepEqual(
    restored.snapshot.document.connections.map((connection) => [connection.id, connection.danglingEndpoints]),
    [
      ["wire-a", ["target"]],
      ["wire-b", ["target"]],
      ["wire-output", ["source"]],
    ],
  );
  assert.equal(
    engine.calls.slice(callsBeforeClear.length).some((call) => call.startsWith("addConnection:")),
    false,
  );
  assert.equal(
    engine.calls.slice(callsBeforeClear.length).some((call) => call.startsWith("removeConnection:")),
    false,
  );
});

test("moves a component as one local layout history frame and aligns wire endpoints", async () => {
  const engine = new FakeEngine();
  const session = createSession(engine);
  const beforeCalls = [...engine.calls];

  const result = await session.dispatch({ type: "move-component", componentId: "and-gate", position: { x: 480, y: 256 } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.snapshot.document.components.find((component) => component.id === "and-gate")?.position, { x: 480, y: 256 });
  assert.deepEqual(result.snapshot.document.connections.find((connection) => connection.id === "wire-a")?.target.point, { x: 475, y: 286 });
  assert.deepEqual(result.snapshot.document.connections.find((connection) => connection.id === "wire-output")?.source.point, { x: 625, y: 306 });
  assert.deepEqual(engine.calls, beforeCalls);
  assert.equal(result.snapshot.canUndo, true);

  const undo = await session.dispatch({ type: "undo" });
  assert.deepEqual(undo.snapshot.document.components.find((component) => component.id === "and-gate")?.position, { x: 440, y: 220 });
  assert.deepEqual(undo.snapshot.document.connections.find((connection) => connection.id === "wire-a")?.target.point, { x: 435, y: 250 });
  const redo = await session.dispatch({ type: "redo" });
  assert.deepEqual(redo.snapshot.document.components.find((component) => component.id === "and-gate")?.position, { x: 480, y: 256 });
  assert.deepEqual(redo.snapshot.document.connections.find((connection) => connection.id === "wire-output")?.source.point, { x: 625, y: 306 });
  assert.deepEqual(engine.calls, beforeCalls);
});

test("a no-op component move does not create layout history", async () => {
  const engine = new FakeEngine();
  const session = createSession(engine);
  const result = await session.dispatch({ type: "move-node", nodeId: "and-gate", position: { x: 440, y: 220 } });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.canUndo, false);
  assert.deepEqual(engine.calls, []);
});
test("library click creates a pending placement without changing the document", async () => {
  const engine = new FakeEngine();
  const session = createSession(engine);
  const before = session.snapshot().document;

  const pending = await session.dispatch({ type: "begin-placement", kind: "xor" });

  assert.equal(pending.ok, true);
  assert.deepEqual(pending.snapshot.document, before);
  assert.deepEqual(pending.snapshot.pendingPlacement, { kind: "xor", center: null, altKey: false, continuous: false });
  assert.deepEqual(engine.calls, []);
});

test("places every combinational kind at a snapped world center and selects it", async () => {
  const engine = new FakeEngine();
  const session = createEditorSession({ document: { components: [], connections: [] }, bindings: { components: {}, connections: {} } }, engine);
  for (const kind of ["input", "output", "and", "or", "nand", "nor", "xor", "xnor", "not"] as const) {
    const result = await session.dispatch({ type: "add-component", kind, position: { x: 101, y: 67 } });
    assert.equal(result.ok, true);
    const component = result.snapshot.document.components.at(-1);
    assert.equal(component?.kind, kind);
    assert.deepEqual(component?.position, { x: 22, y: 22 });
    assert.equal(result.snapshot.selection?.kind, "component");
  }
  assert.equal(session.snapshot().document.connections.length, 0);
  assert.deepEqual(engine.calls.filter((call) => call.startsWith("addComponent:")), [
    "addComponent:input", "addComponent:output", "addComponent:and", "addComponent:or",
    "addComponent:nand", "addComponent:nor", "addComponent:xor", "addComponent:xnor", "addComponent:not",
  ]);
});

test("Alt preserves the exact placement center and failed placement remains pending", async () => {
  const engine = new FakeEngine();
  const session = createSession(engine);
  await session.dispatch({ type: "begin-placement", kind: "input", center: { x: 11, y: 19 }, altKey: true });
  const placed = await session.dispatch({ type: "place-component", center: { x: 11, y: 19 }, altKey: true });
  assert.equal(placed.ok, true);
  assert.deepEqual(placed.snapshot.document.components.at(-1)?.position, { x: -63, y: -23 });
  assert.deepEqual(placed.snapshot.selection, { kind: "component", id: "component-1" });

  engine.failOn = "addComponent:output";
  await session.dispatch({ type: "begin-placement", kind: "output" });
  const failed = await session.dispatch({ type: "place-component", center: { x: 0, y: 0 } });
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.snapshot.pendingPlacement, { kind: "output", center: { x: 0, y: 0 }, altKey: false, continuous: false });
});

test("failed placement can be retried with the same editor identity and position", async () => {
  const engine = new FakeEngine();
  engine.failNext("addComponent:and");
  const session = createEditorSession({ document: { components: [], connections: [] }, bindings: { components: {}, connections: {} } }, engine);

  const failed = await session.dispatch({ type: "add-component", kind: "and", position: { x: 101, y: 67 } });
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.snapshot.document, { components: [], connections: [] });
  assert.equal(failed.snapshot.canUndo, false);
  assert.deepEqual(failed.snapshot.pendingPlacement, { kind: "and", center: { x: 101, y: 67 }, altKey: false, continuous: false });

  const retried = await session.dispatch({ type: "retry-current-operation" });
  assert.equal(retried.ok, true);
  assert.deepEqual(retried.snapshot.document.components, [{
    id: "component-1",
    kind: "and",
    displayName: "AND 门 1",
    position: { x: 22, y: 22 },
    lifecycle: "active",
  }]);
  assert.deepEqual(retried.snapshot.selection, { kind: "component", id: "component-1" });
  assert.equal(retried.snapshot.pendingPlacement, null);
  assert.deepEqual(engine.calls, ["addComponent:and", "addComponent:and"]);
});

test("cancel after a failed placement clears the pending request without changing history", async () => {
  const engine = new FakeEngine();
  engine.failOn = "addComponent:output";
  const session = createEditorSession({ document: { components: [], connections: [] }, bindings: { components: {}, connections: {} } }, engine);

  await session.dispatch({ type: "add-component", kind: "output", position: { x: 32, y: 48 } });
  const cancelled = await session.dispatch({ type: "cancel-current-operation" });

  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.snapshot.pendingPlacement, null);
  assert.equal(cancelled.snapshot.error, null);
  assert.equal(cancelled.snapshot.canUndo, false);
  assert.deepEqual(cancelled.snapshot.document, { components: [], connections: [] });
});

test("cancellation is busy once an add request has been sent", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const engine = new FakeEngine();
  const original = engine.addComponent.bind(engine);
  engine.addComponent = async (kind) => {
    await pending;
    return original(kind);
  };
  const session = createEditorSession({ document: { components: [], connections: [] }, bindings: { components: {}, connections: {} } }, engine);

  const adding = session.dispatch({ type: "add-component", kind: "not", position: { x: 64, y: 64 } });
  const cancelled = await session.dispatch({ type: "cancel-current-operation" });
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.error.code, "editor_busy");
  assert.equal(cancelled.snapshot.operation, "busy");
  assert.deepEqual(cancelled.snapshot.document, { components: [], connections: [] });

  release();
  const completed = await adding;
  assert.equal(completed.ok, true);
  assert.equal(completed.snapshot.document.components[0]?.id, "component-1");
});

test("transport failure keeps the pending add retryable without publishing a half component", async () => {
  const engine = new FakeEngine();
  let first = true;
  const original = engine.addComponent.bind(engine);
  engine.addComponent = async (kind) => {
    if (first) {
      first = false;
      throw new Error("engine disconnected");
    }
    return original(kind);
  };
  const session = createEditorSession({ document: { components: [], connections: [] }, bindings: { components: {}, connections: {} } }, engine);

  const failed = await session.dispatch({ type: "add-component", kind: "or", position: { x: 97, y: 33 } });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "engine_operation_failed");
  assert.deepEqual(failed.snapshot.document, { components: [], connections: [] });
  assert.equal(failed.snapshot.canUndo, false);
  assert.deepEqual(failed.snapshot.pendingPlacement, { kind: "or", center: { x: 97, y: 33 }, altKey: false, continuous: false });

  const retried = await session.dispatch({ type: "retry-placement" });
  assert.equal(retried.ok, true);
  assert.equal(retried.snapshot.document.components[0]?.id, "component-1");
  assert.equal(retried.snapshot.document.components[0]?.displayName, "OR 门 1");
});

test("added component is undoable without reusing its editor identity", async () => {
  const engine = new FakeEngine();
  const session = createEditorSession({ document: { components: [], connections: [] }, bindings: { components: {}, connections: {} } }, engine);
  const added = await session.dispatch({ type: "add-component", kind: "and", position: { x: 16, y: 16 } });
  const id = added.snapshot.document.components[0].id;
  assert.equal(id, "component-1");
  await session.dispatch({ type: "undo" });
  assert.equal(session.snapshot().document.components.length, 0);
  const redone = await session.dispatch({ type: "redo" });
  assert.equal(redone.ok, true);
  assert.equal(redone.snapshot.document.components[0].id, id);
  assert.equal(redone.snapshot.document.components[0].displayName, "AND 门 1");
  assert.equal(engine.calls.filter((call) => call.startsWith("addComponent:and")).length, 2);
});

test("Shift placement keeps the same kind pending until explicitly changed", async () => {
  const engine = new FakeEngine();
  const session = createEditorSession({ document: { components: [], connections: [] }, bindings: { components: {}, connections: {} } }, engine);

  await session.dispatch({ type: "begin-placement", kind: "xor", continuous: true });
  const first = await session.dispatch({ type: "place-component", center: { x: 100, y: 100 } });
  assert.equal(first.ok, true);
  assert.equal(first.snapshot.document.components.length, 1);
  assert.deepEqual(first.snapshot.pendingPlacement, { kind: "xor", center: null, altKey: false, continuous: true });

  const second = await session.dispatch({ type: "place-component", center: { x: 200, y: 100 } });
  assert.equal(second.ok, true);
  assert.equal(second.snapshot.document.components.length, 2);
  assert.deepEqual(second.snapshot.pendingPlacement, { kind: "xor", center: null, altKey: false, continuous: true });

  await session.dispatch({ type: "begin-placement", kind: "not", continuous: false });
  const final = await session.dispatch({ type: "place-component", center: { x: 300, y: 100 } });
  assert.equal(final.ok, true);
  assert.equal(final.snapshot.document.components.at(-1)?.kind, "not");
  assert.equal(final.snapshot.pendingPlacement, null);
});

test("duplicating a component copies only kind and selects a new offset node", async () => {
  const engine = new FakeEngine();
  const session = createSession(engine);
  await session.dispatch({ type: "select", selection: { kind: "component", id: "and-gate" } });

  const result = await session.dispatch({ type: "duplicate-selected" });

  assert.equal(result.ok, true);
  const copy = result.snapshot.document.components.find((component) => component.id === result.snapshot.selection?.id);
  assert.deepEqual(copy, {
    id: "component-1",
    kind: "and",
    displayName: "AND 门 2",
    position: { x: 472, y: 252 },
    lifecycle: "active",
  });
  assert.equal(result.snapshot.document.connections.length, 3);
  assert.deepEqual(engine.calls, ["addComponent:and"]);

  const undone = await session.dispatch({ type: "undo" });
  assert.equal(undone.ok, true);
  assert.equal(undone.snapshot.document.components.some((component) => component.id === "component-1"), false);
  const redone = await session.dispatch({ type: "redo" });
  assert.equal(redone.ok, true);
  assert.equal(redone.snapshot.selection?.id, "component-1");
  assert.deepEqual(engine.calls, ["addComponent:and", "removeComponent:100", "addComponent:and"]);
});

test("failed duplication preserves the source selection and does not create history", async () => {
  const engine = new FakeEngine();
  engine.failOn = "addComponent:and";
  const session = createSession(engine);
  await session.dispatch({ type: "select", selection: { kind: "component", id: "and-gate" } });

  const result = await session.dispatch({ type: "copy-component", componentId: "and-gate" });

  assert.equal(result.ok, false);
  assert.deepEqual(result.snapshot.selection, { kind: "component", id: "and-gate" });
  assert.equal(result.snapshot.canUndo, false);
  assert.equal(result.snapshot.document.components.length, 4);
});
