import assert from "node:assert/strict";
import test from "node:test";
import { createDocumentCoordinator } from "../src/workspace/documentCoordinator.ts";
import type { DocumentRuntime, DocumentRuntimeSnapshot } from "../src/workspace/documentRuntime.ts";
import type { WorkspaceSnapshot } from "../src/workspace/index.ts";
import { resolveDocumentTabKey } from "../src/components/document-tabs.ts";

const emptyProject = JSON.stringify({ version: 1, circuit: { components: [], connections: [] } });

function fakeSnapshot(key: string): DocumentRuntimeSnapshot {
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
    project: { path: null, displayName: key, identity: `temporary:${key}`, isDirty: false, saveError: null, openError: null, pendingFileAction: null },
    view: { viewport: { x: 0, y: 0, zoom: 1, visibleRect: { width: 1, height: 1 } }, selection: null, activeRailPage: "components", bottomTab: "outputs" },
  };
}

function fakeRuntime(key: string): DocumentRuntime {
  let current = fakeSnapshot(key);
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
    dispatchEditor: async () => null,
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
    dispose() { this.destroy(); },
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
  assert.equal((await coordinator.close(firstKey, { discard: true })).activeKey, null);
});

test("document tab resolver supports arrows, Home/End, and activation keys", () => {
  assert.deepEqual(resolveDocumentTabKey("ArrowRight", 0, 3), { action: "move", index: 1 });
  assert.deepEqual(resolveDocumentTabKey("ArrowLeft", 0, 3), { action: "move", index: 2 });
  assert.deepEqual(resolveDocumentTabKey("Home", 2, 3), { action: "move", index: 0 });
  assert.deepEqual(resolveDocumentTabKey("End", 0, 3), { action: "move", index: 2 });
  assert.deepEqual(resolveDocumentTabKey("Enter", 1, 3), { action: "activate", index: 1 });
});
