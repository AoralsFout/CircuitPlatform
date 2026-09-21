import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentKindName, EngineResponse } from "@circuit-platform/protocol";
import type { CircuitEnginePort, EditorInitialState, EditorSession } from "../src/editor/index.ts";
import {
  createDocumentRuntime,
  type DocumentRuntime,
} from "../src/workspace/documentRuntime.ts";
import type {
  EngineAdapter,
  EngineHealth,
  WorkspaceSnapshot,
} from "../src/workspace/index.ts";

function response(type: EngineResponse["type"]): EngineResponse {
  return { type, requestId: "runtime-test" } as EngineResponse;
}

class DeferredEngine implements EngineAdapter {
  checkStarted: (() => void) | null = null;
  resolveCheck: (() => void) | null = null;

  async checkEngine(): Promise<EngineHealth> {
    this.checkStarted?.();
    await new Promise<void>((resolve) => { this.resolveCheck = resolve; });
    return { status: "ok", engine: "test" };
  }

  async addComponent(): Promise<EngineResponse> { return { ...response("component_added"), componentId: 1, ports: [] } as EngineResponse; }
  async setPortWidth(): Promise<EngineResponse> { return { ...response("port_width_set"), componentId: 1, ports: [], danglingConnectionIds: [] } as EngineResponse; }
  async addConnection(): Promise<EngineResponse> { return { ...response("connection_added"), connectionId: 1 } as EngineResponse; }
  async removeComponent(): Promise<EngineResponse> { return { ...response("component_removed"), componentId: 1 } as EngineResponse; }
  async removeConnection(): Promise<EngineResponse> { return { ...response("connection_removed"), connectionId: 1 } as EngineResponse; }
  async setInput(): Promise<EngineResponse> { return response("input_set"); }
  async settle(): Promise<EngineResponse> { return { ...response("settled"), status: "ok" } as EngineResponse; }
  async tick(): Promise<EngineResponse> { return { ...response("ticked"), step: 1, signals: [] } as EngineResponse; }
  async reset(): Promise<EngineResponse> { return { ...response("reset_done"), status: "ok" } as EngineResponse; }
  async getSignal(): Promise<EngineResponse> { return { ...response("signal_result"), value: "X" } as EngineResponse; }
}

function editorEngine(): CircuitEnginePort {
  return {
    async addComponent() { return { ok: true, value: { componentId: 1, ports: [] } }; },
    async setPortWidth() { return { ok: true, value: { ports: [], danglingConnectionIds: [] } }; },
    async addConnection() { return { ok: true, value: { connectionId: 1 } }; },
    async removeComponent() { return { ok: true, value: { componentId: 1 } }; },
    async removeConnection() { return { ok: true, value: { connectionId: 1 } }; },
  };
}

function initialEditor(): EditorInitialState {
  return {
    document: {
      components: [{ id: "same-id", kind: "input", displayName: "Input", position: { x: 0, y: 0 }, lifecycle: "active" }],
      connections: [],
    },
    bindings: { components: { "same-id": 1 }, connections: {} },
  };
}

test("工厂创建的两个运行时隔离项目、视图和相同 Editor ID", async () => {
  const first = createDocumentRuntime({ adapter: new DeferredEngine(), initialEditor: initialEditor(), editorEngine: editorEngine(), temporaryName: "未命名 1" });
  const second = createDocumentRuntime({ adapter: new DeferredEngine(), initialEditor: initialEditor(), editorEngine: editorEngine(), temporaryName: "未命名 2" });

  await first.setSelection({ kind: "component", id: "same-id" });
  first.setViewport({ x: 30, y: 40, zoom: 2, visibleRect: { width: 800, height: 500 } });
  first.setProjectPath("C:\\Projects\\first.circuit.json");
  first.setDirty(true);

  assert.notEqual(first.snapshot().runtimeId, second.snapshot().runtimeId);
  assert.equal(first.snapshot().view.selection?.id, "same-id");
  assert.equal(second.snapshot().view.selection, null);
  assert.equal(first.snapshot().project.isDirty, true);
  assert.equal(second.snapshot().project.isDirty, false);
  assert.equal(first.snapshot().view.viewport.x, 30);
  assert.equal(second.snapshot().view.viewport.x, 0);
  assert.notEqual(first.snapshot().project.identity, second.snapshot().project.identity);
  first.destroy();
  second.destroy();
});

test("销毁运行时会取消订阅，并丢弃迟到的异步结果", async () => {
  const engine = new DeferredEngine();
  const runtime = createDocumentRuntime({ adapter: engine });
  const events: WorkspaceSnapshot[] = [];
  const unsubscribe = runtime.subscribe((snapshot) => events.push(snapshot.workspace));
  const started = new Promise<void>((resolve) => { engine.checkStarted = resolve; });
  const checking = runtime.checkEngine();
  await started;
  runtime.destroy();
  unsubscribe();
  engine.resolveCheck?.();
  await checking;
  assert.equal(runtime.snapshot().active, false);
  assert.equal(events.length, 0);
});

test("运行时提供窄编辑器命令，不把引擎身份放进快照", async () => {
  const runtime: DocumentRuntime = createDocumentRuntime({
    adapter: new DeferredEngine(),
    initialEditor: initialEditor(),
    editorEngine: editorEngine(),
  });
  const result = await runtime.dispatchEditor({ type: "select", selection: { kind: "component", id: "same-id" } });
  assert.equal(result?.ok, true);
  assert.equal(result?.ok === true ? result.snapshot.selection?.kind : undefined, "component");
  assert.equal("bindings" in runtime.snapshot(), false);
  assert.equal("engineId" in runtime.snapshot(), false);
  runtime.destroy();
});

test("运行时保留 EditorSession 的结构命令错误", async () => {
  const expectedError = { code: "engine_unavailable", message: "引擎不可用。", retryable: true } as const;
  const editor = {
    snapshot: () => ({
      document: { components: [], connections: [] },
      selection: null,
      operation: "idle",
      canUndo: false,
      canRedo: false,
      confirmation: null,
      error: expectedError,
    }),
    dispatch: async () => ({
      ok: false as const,
      error: expectedError,
      snapshot: editor.snapshot(),
    }),
    subscribe: () => () => undefined,
    setEngineAvailability: () => undefined,
    adoptBindings: () => undefined,
    replaceProjection: async () => ({ ok: true as const, snapshot: editor.snapshot() }),
    projection: () => null,
    adoptProjection: () => undefined,
    rewriteSubcircuitReferences: () => false,
  } as unknown as EditorSession;
  const runtime = createDocumentRuntime({ adapter: new DeferredEngine(), editor });

  const result = await runtime.dispatchEditor({ type: "select", selection: null });

  assert.equal(result?.ok, false);
  assert.deepEqual(result?.ok === false ? result.error : null, expectedError);
  runtime.destroy();
});
