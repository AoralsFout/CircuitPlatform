import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentKindName, EngineResponse, PortSpec } from "@circuit-platform/protocol";
import { useWorkspace } from "../src/composables/useWorkspace.ts";
import { serializeProjectFile } from "../src/project-file/index.ts";
import { portsForAddComponent } from "./fake-ports.ts";

/** 公开工作区操作的可控文件与引擎适配器。 */
class EmbeddedEngine {
  readonly files = new Map<string, string>();
  readonly readPaths: string[] = [];
  readonly openChoices: Array<{ ok: true; path: string } | { ok: false; reason: string }> = [];
  readonly saveChoices: Array<{ ok: true; path: string } | { ok: false; reason: string }> = [];
  nextComponentId = 1;
  nextConnectionId = 1;
  failNextAdd = false;

  async checkEngine() { return { status: "ok" as const, engine: "fake-engine" }; }
  async addComponent(kind: ComponentKindName, ports?: readonly PortSpec[]): Promise<EngineResponse> {
    if (this.failNextAdd) {
      this.failNextAdd = false;
      return { type: "error", requestId: "fake", code: "FAKE_ERROR", message: "创建元件失败" };
    }
    return { type: "component_added", requestId: "fake", componentId: this.nextComponentId++, ports: portsForAddComponent(kind, ports) };
  }
  async removeComponent(componentId: number): Promise<EngineResponse> {
    return { type: "component_removed", requestId: "fake", componentId };
  }
  async addConnection(): Promise<EngineResponse> {
    return { type: "connection_added", requestId: "fake", connectionId: this.nextConnectionId++ };
  }
  async removeConnection(connectionId: number): Promise<EngineResponse> {
    return { type: "connection_removed", requestId: "fake", connectionId };
  }
  async setPortWidth(componentId: number, ports: readonly PortSpec[]): Promise<EngineResponse> {
    return { type: "port_width_set", requestId: "fake", componentId, ports, danglingConnectionIds: [] };
  }
  async setInput(): Promise<EngineResponse> { return { type: "input_set", requestId: "fake" }; }
  async settle(): Promise<EngineResponse> { return { type: "settled", requestId: "fake", status: "ok" }; }
  async getSignal(): Promise<EngineResponse> { return { type: "signal_result", requestId: "fake", value: "0" }; }
  async tick(): Promise<EngineResponse> { return { type: "ticked", requestId: "fake", step: 1, signals: [] }; }
  async reset(): Promise<EngineResponse> { return { type: "reset_done", requestId: "fake", status: "ok" }; }
  async pickOpenPath() { return this.openChoices.shift() ?? { ok: false as const, reason: "canceled" }; }
  async pickSavePath() { return this.saveChoices.shift() ?? { ok: false as const, reason: "canceled" }; }
  async readProjectFile(path: string) {
    this.readPaths.push(path);
    const content = this.files.get(path);
    return content === undefined
      ? { ok: false as const, reason: "项目文件不存在。", code: "PROJECT_FILE_NOT_FOUND" }
      : { ok: true as const, content };
  }
  async writeProjectFile(path: string, content: string) {
    this.files.set(path, content);
    return { ok: true as const };
  }
}

function sourceFile(): string {
  return JSON.stringify(serializeProjectFile({
    document: {
      components: [
        { id: "in", kind: "input", displayName: "A", position: { x: 0, y: 0 }, lifecycle: "active", ports: [{ name: "out", direction: "output", width: 1 }] },
        { id: "gate", kind: "not", displayName: "NOT", position: { x: 100, y: 0 }, lifecycle: "active" },
        { id: "out", kind: "output", displayName: "Y", position: { x: 200, y: 0 }, lifecycle: "active", ports: [{ name: "in", direction: "input", width: 1 }] },
      ],
      connections: [
        { id: "w1", source: { componentId: "in", port: "out", point: { x: 0, y: 0 } }, target: { componentId: "gate", port: "in", point: { x: 0, y: 0 } }, lifecycle: "visible", danglingEndpoints: [] },
        { id: "w2", source: { componentId: "gate", port: "out", point: { x: 0, y: 0 } }, target: { componentId: "out", port: "in", point: { x: 0, y: 0 } }, lifecycle: "visible", danglingEndpoints: [] },
      ],
    },
  }));
}

test("an unsaved parent imports a v2 snapshot and reopens after the source is deleted", async () => {
  const engine = new EmbeddedEngine();
  const sourcePath = "E:\\circuits\\source.circuit.json";
  const parentPath = "D:\\archive\\parent.circuit.json";
  engine.files.set(sourcePath, sourceFile());
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { circuitPlatform: engine } });
  let first: ReturnType<typeof useWorkspace> | null = null;
  let reopened: ReturnType<typeof useWorkspace> | null = null;
  try {
    first = useWorkspace();
    await first.bootstrap();
    await first.requestNew();
    assert.equal(first.projectPath.value, null);
    engine.openChoices.push({ ok: true, path: sourcePath });
    assert.equal(await first.addSubcircuitFromDialog(), true);
    assert.equal(first.projectPath.value, null);
    assert.equal(first.editorState.value?.document.components[0]?.data?.subcircuit?.status, "resolved");
    await first.undo();
    assert.equal(first.editorState.value?.document.components.length, 0);
    await first.redo();
    assert.equal(first.editorState.value?.document.components[0]?.data?.subcircuit?.status, "resolved");
    engine.saveChoices.push({ ok: true, path: parentPath });
    assert.equal(await first.saveAs(), true);
    const saved = JSON.parse(engine.files.get(parentPath)!);
    assert.equal(saved.version, 2);
    assert.equal(saved.libraryRoots.length, 1);
    assert.equal(Object.keys(saved.definitions).length, 1);
    assert.equal(JSON.stringify(saved).includes(sourcePath), false);
    assert.equal(JSON.stringify(saved).includes("reference"), false);

    engine.files.delete(sourcePath);
    engine.readPaths.length = 0;
    reopened = useWorkspace();
    await reopened.bootstrap();
    assert.equal(await reopened.openProjectFromPath(parentPath), true);
    assert.deepEqual(engine.readPaths, [parentPath]);
    assert.equal(reopened.editorState.value?.document.components[0]?.data?.subcircuit?.status, "resolved");
    assert.ok(reopened.state.value.internalComponents?.some((component) => component.kind === "not"));
  } finally {
    await reopened?.dispose();
    await first?.dispose();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("a failed snapshot import leaves no definition, component, or history frame", async () => {
  const engine = new EmbeddedEngine();
  const sourcePath = "E:\\circuits\\source.circuit.json";
  engine.files.set(sourcePath, sourceFile());
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { circuitPlatform: engine } });
  const binding = useWorkspace();
  try {
    await binding.bootstrap();
    await binding.requestNew();
    engine.failNextAdd = true;
    engine.openChoices.push({ ok: true, path: sourcePath });
    assert.equal(await binding.addSubcircuitFromDialog(), false);
    assert.equal(binding.editorState.value?.document.components.length, 0);
    assert.equal(binding.editorState.value?.canUndo, false);
    engine.saveChoices.push({ ok: true, path: "D:\\archive\\parent.circuit.json" });
    assert.equal(await binding.saveAs(), true);
    const saved = JSON.parse(engine.files.get("D:\\archive\\parent.circuit.json")!);
    assert.deepEqual(saved.definitions, {});
    assert.deepEqual(saved.libraryRoots, []);
  } finally {
    await binding.dispose();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
