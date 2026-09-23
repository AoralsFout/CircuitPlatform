import assert from "node:assert/strict";
import test from "node:test";
import type { CommandResult, EditorSnapshot } from "../src/editor/index.ts";
import { createDocumentCoordinator } from "../src/workspace/documentCoordinator.ts";
import type { DocumentRuntime, DocumentRuntimeSnapshot } from "../src/workspace/documentRuntime.ts";
import type { WorkspaceSnapshot } from "../src/workspace/index.ts";
import { resolveDocumentTabKey } from "../src/components/document-tabs.ts";

const emptyProject = JSON.stringify({ version: 2, circuit: { components: [], connections: [] }, definitions: {}, libraryRoots: [] });

function fakeSnapshot(key: string, displayName = key): DocumentRuntimeSnapshot {
  return {
    runtimeId: key,
    active: true,
    workspace: {
      engineState: "ready", engineName: "fake", message: "", operationError: null, isBusy: false,
      simulationState: "stopped", inputA: "X", inputB: "X", inputValues: {}, signals: {}, outputValue: "X",
      hasCircuit: true, simulationStep: 0, waveform: [], canStart: true, canPause: false, canResume: false,
      canStep: true, canReset: true, canToggleInput: false,
    } as WorkspaceSnapshot,
    editor: null,
    project: { path: null, displayName, identity: `temporary:${key}`, isDirty: false, saveError: null, openError: null, pendingFileAction: null },
    view: { viewport: { x: 0, y: 0, zoom: 1, visibleRect: { width: 1, height: 1 } }, selection: null, activeRailPage: "components", bottomTab: "outputs" },
  };
}

function fakeRuntime(key: string, displayName = key, dispatchResult: CommandResult | null = null): DocumentRuntime {
  let current = fakeSnapshot(key, displayName);
  const listeners = new Set<(snapshot: DocumentRuntimeSnapshot) => void>();
  const publish = () => { for (const listener of listeners) listener(current); return current; };
  const runtime = {
    snapshot: () => current,
    subscribe(listener: (snapshot: DocumentRuntimeSnapshot) => void) { listeners.add(listener); return () => listeners.delete(listener); },
    checkEngine: async () => current,
    loadCircuit: async () => current,
    openCircuit: async () => publish(),
    rebuildCircuit: async () => current,
    refreshReadings: async () => current,
    start: async () => { current = { ...current, workspace: { ...current.workspace, simulationState: "running" } }; return publish(); },
    pause: async () => { current = { ...current, workspace: { ...current.workspace, simulationState: "paused" } }; return publish(); },
    resume: async () => current,
    step: async () => current,
    reset: async () => current,
    setInputBit: async () => current,
    dispatchEditor: async () => dispatchResult,
    setProjectPath(path: string | null) { current = { ...current, project: { ...current.project, path, displayName: path?.split(/[\\/]/).pop() ?? key, identity: path ?? current.project.identity } }; return publish(); },
    setDirty(isDirty: boolean) { current = { ...current, project: { ...current.project, isDirty } }; return publish(); },
    setSaveError: () => current,
    setOpenError: () => current,
    setPendingFileAction: () => current,
    setViewport: () => current,
    setSelection: async () => current,
    setActiveRailPage: () => current,
    setBottomTab: () => current,
    destroy() { current = { ...current, active: false }; listeners.clear(); },
    dispose() { current = { ...current, active: false }; listeners.clear(); },
  } as unknown as DocumentRuntime;
  return runtime;
}

test("coordinator opens ordered documents, activates duplicates, and isolates failed opens", async () => {
  const reads: string[] = [];
  const runtimes: DocumentRuntime[] = [];
  const coordinator = createDocumentCoordinator({
    reader: { async readProjectFile(path) { reads.push(path); return path.includes("bad") ? { ok: false, reason: "文件不存在" } : { ok: true, content: emptyProject }; } },
    runtimeFactory: ({ documentKey }) => { const runtime = fakeRuntime(documentKey); runtimes.push(runtime); return runtime; },
  });

  const first = await coordinator.openProject("C:\\Projects\\A.circuit.json");
  const second = await coordinator.openProject("C:\\Projects\\B.circuit.json");
  assert.equal(first.ok && first.duplicate, false);
  assert.equal(second.ok && second.duplicate, false);
  assert.deepEqual(coordinator.snapshot().tabs.map((tab) => tab.displayName), ["A.circuit.json", "B.circuit.json"]);
  const duplicate = await coordinator.openProject("c:/Projects/./A.circuit.json");
  assert.equal(duplicate.ok && duplicate.duplicate, true);
  assert.equal(coordinator.snapshot().tabs.length, 2);
  assert.equal(reads.length, 2);
  assert.equal(coordinator.snapshot().activeKey, first.ok ? first.key : null);
  const failed = await coordinator.openProject("C:\\Projects\\bad.circuit.json");
  assert.equal(failed.ok, false);
  assert.equal(coordinator.snapshot().tabs.length, 2);
  assert.equal(coordinator.snapshot().activeKey, first.ok ? first.key : null);
  assert.equal(runtimes.length, 2);
});

test("coordinator pauses on activation and closes only the requested runtime", async () => {
  const coordinator = createDocumentCoordinator({
    reader: { async readProjectFile() { return { ok: true, content: emptyProject }; } },
    runtimeFactory: ({ documentKey }) => fakeRuntime(documentKey),
  });
  const first = await coordinator.openProject("C:\\A.circuit.json");
  const second = await coordinator.openProject("C:\\B.circuit.json");
  assert.equal(first.ok && second.ok, true);
  const firstKey = first.ok ? first.key : "";
  const secondKey = second.ok ? second.key : "";
  await coordinator.activate(firstKey);
  const firstRuntime = coordinator.activeRuntime();
  await firstRuntime?.start();
  await coordinator.activate(secondKey);
  assert.equal(coordinator.snapshot().activeKey, secondKey);
  assert.equal((coordinator.snapshot().tabs.find((tab) => tab.key === firstKey))?.simulationState, "paused");
  assert.equal((await coordinator.close(secondKey, { discard: true })).ok, true);
  assert.equal(coordinator.snapshot().activeKey, firstKey);
  const closed = await coordinator.close(firstKey, { discard: true });
  assert.equal(closed.ok, true);
  assert.equal(closed.ok ? closed.activeKey : null, null);
});

test("coordinator forwards CommandResult errors from the active runtime", async () => {
  const editorSnapshot: EditorSnapshot = {
    document: { components: [], connections: [] },
    selection: null,
    operation: "idle",
    canUndo: false,
    canRedo: false,
    confirmation: null,
    error: null,
  };
  const result: CommandResult = {
    ok: false,
    error: { code: "busy", message: "编辑器忙碌。", retryable: true },
    snapshot: editorSnapshot,
  };
  const coordinator = createDocumentCoordinator({
    reader: { async readProjectFile() { return { ok: true, content: emptyProject }; } },
    runtimeFactory: ({ documentKey }) => fakeRuntime(documentKey, documentKey, result),
  });
  const opened = await coordinator.openProject("C:\\A.circuit.json");
  assert.equal(opened.ok, true);

  assert.deepEqual(await coordinator.dispatchEditor({ type: "select", selection: null }), result);
});

test("newDocument 使用连续临时名称，并以结构化错误保留已有标签", async () => {
  const names: Array<string | undefined> = [];
  let shouldFail = false;
  const coordinator = createDocumentCoordinator({
    reader: { async readProjectFile() { return { ok: true, content: emptyProject }; } },
    runtimeFactory: ({ documentKey, temporaryName }) => {
      names.push(temporaryName);
      if (shouldFail) throw new Error("引擎启动失败");
      return fakeRuntime(documentKey, temporaryName);
    },
  });

  const first = await coordinator.newDocument();
  const second = await coordinator.newDocument();
  assert.deepEqual(first, { ok: true, key: "document-1" });
  assert.deepEqual(second, { ok: true, key: "document-2" });
  assert.deepEqual(names, ["未命名 1", "未命名 2"]);
  assert.deepEqual(coordinator.snapshot().tabs.map((tab) => tab.displayName), ["未命名 1", "未命名 2"]);

  shouldFail = true;
  const failed = await coordinator.newDocument();
  assert.deepEqual(failed, { ok: false, error: "引擎启动失败" });
  assert.equal(coordinator.snapshot().tabs.length, 2);
  assert.equal(coordinator.snapshot().activeKey, "document-2");
  assert.equal(coordinator.snapshot().openError, "引擎启动失败");
});

test("coordinator dispose 释放全部运行时且不影响彼此", async () => {
  const runtimes: Array<{ runtime: DocumentRuntime; disposeCalls: number }> = [];
  const coordinator = createDocumentCoordinator({
    reader: { async readProjectFile() { return { ok: true, content: emptyProject }; } },
    runtimeFactory: ({ documentKey }) => {
      const runtime = fakeRuntime(documentKey);
      const originalDispose = runtime.dispose.bind(runtime);
      const record = { runtime, disposeCalls: 0 };
      runtime.dispose = () => { record.disposeCalls += 1; originalDispose(); };
      runtimes.push(record);
      return runtime;
    },
  });
  await coordinator.openProject("C:\\A.circuit.json");
  await coordinator.openProject("C:\\B.circuit.json");

  coordinator.dispose();
  coordinator.dispose();

  assert.deepEqual(coordinator.snapshot().tabs, []);
  assert.equal(coordinator.snapshot().activeKey, null);
  assert.deepEqual(runtimes.map((record) => record.disposeCalls), [1, 1]);
  assert.deepEqual(runtimes.map((record) => record.runtime.snapshot().active), [false, false]);
});

test("document tab resolver supports arrows, Home/End, and activation keys", () => {
  assert.deepEqual(resolveDocumentTabKey("ArrowRight", 0, 3), { action: "move", index: 1 });
  assert.deepEqual(resolveDocumentTabKey("ArrowLeft", 0, 3), { action: "move", index: 2 });
  assert.deepEqual(resolveDocumentTabKey("Home", 2, 3), { action: "move", index: 0 });
  assert.deepEqual(resolveDocumentTabKey("End", 0, 3), { action: "move", index: 2 });
  assert.deepEqual(resolveDocumentTabKey("Enter", 1, 3), { action: "activate", index: 1 });
});
