import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentKindName, EngineResponse, PortSpec } from "@circuit-platform/protocol";
import { useWorkspace } from "../src/composables/useWorkspace.ts";
import { useDocumentWorkspace } from "../src/composables/useDocumentWorkspace.ts";
import { serializeProjectFile, type ProjectFileData } from "../src/project-file/index.ts";
import { portsForAddComponent } from "./fake-ports.ts";
import { canvasSubcircuitName } from "../src/project-file/library.ts";

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

test("import only persists an unused root and placing it later reuses the same definition", async () => {
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
    engine.openChoices.push({ ok: true, path: sourcePath });
    assert.equal(await first.importSubcircuitOnlyFromDialog(), true);
    assert.equal(first.editorState.value?.document.components.length, 0);
    assert.equal(first.libraryTree.value.length, 1);
    assert.equal(first.libraryTree.value[0]?.usageCount, 0);
    assert.equal(first.libraryTree.value[0]?.status, "ready");
    const definitionId = first.libraryTree.value[0]!.definitionId;
    await first.undo();
    assert.equal(first.libraryTree.value.length, 0);
    await first.redo();
    assert.equal(first.libraryTree.value[0]?.definitionId, definitionId);
    engine.saveChoices.push({ ok: true, path: parentPath });
    assert.equal(await first.saveAs(), true);
    engine.files.delete(sourcePath);
    reopened = useWorkspace();
    await reopened.bootstrap();
    assert.equal(await reopened.openProjectFromPath(parentPath), true);
    assert.equal(reopened.libraryTree.value[0]?.usageCount, 0);
    assert.equal(await reopened.placeImportedSubcircuit(definitionId), true);
    assert.equal(await reopened.placeImportedSubcircuit(definitionId, { x: 440, y: 180 }), true);
    assert.equal(reopened.libraryTree.value[0]?.usageCount, 2);
    assert.deepEqual(reopened.editorState.value?.document.components.map((component) => component.data?.subcircuit?.definitionId), [definitionId, definitionId]);
    assert.deepEqual(engine.readPaths, [sourcePath, parentPath]);
  } finally {
    await reopened?.dispose();
    await first?.dispose();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("reimport creates a numbered independent definition and rename preserves canvas-only suffix behavior", async () => {
  const engine = new EmbeddedEngine();
  const sourcePath = "E:\\circuits\\ALU.circuit.json";
  engine.files.set(sourcePath, sourceFile());
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { circuitPlatform: engine } });
  const binding = useWorkspace();
  try {
    await binding.bootstrap();
    await binding.requestNew();
    engine.openChoices.push({ ok: true, path: sourcePath }, { ok: true, path: sourcePath });
    assert.equal(await binding.addSubcircuitFromDialog(), true);
    assert.equal(await binding.addSubcircuitFromDialog({ x: 440, y: 180 }), true);
    const [first, second] = binding.libraryTree.value;
    assert.ok(first && second);
    assert.notEqual(first.definitionId, second.definitionId);
    assert.deepEqual([first.displayName, second.displayName], ["ALU.circuit.json", "ALU.circuit.json (2)"]);
    assert.deepEqual(binding.editorState.value?.document.components.map((component) => component.displayName), [first.displayName, second.displayName]);
    assert.equal(canvasSubcircuitName(first.displayName), "ALU");
    assert.equal(canvasSubcircuitName(second.displayName), "ALU (2)");
    assert.equal(await binding.renameImportedSubcircuit(second.definitionId, "算术单元"), true);
    assert.equal(binding.libraryTree.value[1]?.displayName, "算术单元");
    assert.equal(binding.editorState.value?.document.components[1]?.displayName, "算术单元");
    await binding.undo();
    assert.equal(binding.libraryTree.value[1]?.displayName, "ALU.circuit.json (2)");
    await binding.redo();
    assert.equal(binding.libraryTree.value[1]?.displayName, "算术单元");
  } finally {
    await binding.dispose();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("a nested library dependency can be placed with its saved interface", async () => {
  const engine = new EmbeddedEngine();
  const sourcePath = "E:\\circuits\\parent.circuit.json";
  const child = JSON.parse(sourceFile()) as ProjectFileData;
  const ports: PortSpec[] = [
    { name: "A", direction: "input", width: 1 },
    { name: "Y", direction: "output", width: 1 },
  ];
  const source: ProjectFileData = {
    version: 2,
    circuit: { components: [{ id: "nested", kind: "subcircuit", displayName: "child.circuit.json", position: { x: 0, y: 0 }, data: { definitionId: "child", cachedPorts: ports } }], connections: [] },
    definitions: { child: { displayName: "child.circuit.json", circuit: child.circuit } },
    libraryRoots: ["child"],
  };
  engine.files.set(sourcePath, JSON.stringify(source));
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { circuitPlatform: engine } });
  const binding = useWorkspace();
  try {
    await binding.bootstrap();
    await binding.requestNew();
    engine.openChoices.push({ ok: true, path: sourcePath });
    assert.equal(await binding.importSubcircuitOnlyFromDialog(), true);
    const nested = binding.libraryTree.value[0]?.children[0];
    assert.ok(nested);
    assert.equal(nested.displayName, "child.circuit.json");
    assert.equal(await binding.placeImportedSubcircuit(nested.definitionId), true);
    const instance = binding.editorState.value?.document.components[0];
    assert.equal(instance?.data?.subcircuit?.status, "resolved");
    assert.deepEqual(instance?.ports?.map(({ name, direction, width }) => ({ name, direction, width })), ports);
    assert.equal(binding.libraryTree.value[0]?.children[0]?.usageCount, 2);
  } finally {
    await binding.dispose();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("definition tabs use parent identity, survive source deletion, and follow undo without file IO", async () => {
  const engine = new EmbeddedEngine();
  const sourcePath = "E:\\circuits\\source.circuit.json";
  engine.files.set(sourcePath, sourceFile());
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { circuitPlatform: engine } });
  const workspace = useDocumentWorkspace();
  try {
    await workspace.requestNew();
    const parentKey = workspace.activeDocumentKey.value;
    engine.openChoices.push({ ok: true, path: sourcePath });
    assert.equal(await workspace.importSubcircuitOnlyFromDialog(), true);
    const definitionId = workspace.libraryTree.value[0].definitionId;
    const externalCopy = workspace.getEmbeddedDefinition(definitionId);
    assert.equal(externalCopy?.circuit.components.length, 3);
    (externalCopy!.circuit.components as unknown[]).pop();
    assert.equal(workspace.getEmbeddedDefinition(definitionId)?.circuit.components.length, 3);

    engine.files.delete(sourcePath);
    const readCount = engine.readPaths.length;
    assert.equal(await workspace.openEmbeddedDefinition(definitionId), true);
    const definitionKey = workspace.activeDocumentKey.value;
    assert.notEqual(definitionKey, parentKey);
    assert.equal(workspace.activeDefinition.value?.circuit.components[1]?.kind, "not");
    assert.equal(workspace.tabs.value.length, 2);
    assert.equal(workspace.tabs.value[1]?.kind, "definition");
    assert.equal(await workspace.openEmbeddedDefinition(definitionId), true);
    assert.equal(workspace.activeDocumentKey.value, definitionKey);
    assert.equal(workspace.tabs.value.length, 2);
    assert.equal(engine.readPaths.length, readCount);

    assert.equal(await workspace.returnToParent(), true);
    assert.equal(workspace.activeDocumentKey.value, parentKey);
    await workspace.undo();
    await workspace.activateTab(definitionKey);
    assert.equal(workspace.activeDefinition.value?.missing, true);
    await workspace.activateTab(parentKey);
    await workspace.redo();
    await workspace.activateTab(definitionKey);
    assert.equal(workspace.activeDefinition.value?.missing, false);
    assert.equal(workspace.activeDefinition.value?.circuit.connections.length, 2);
    assert.equal(engine.readPaths.length, readCount);
  } finally {
    workspace.dispose();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("canvas drill-down opens a read-only definition without changing editable path tabs", async () => {
  const engine = new EmbeddedEngine();
  const sourcePath = "E:\\circuits\\source.circuit.json";
  engine.files.set(sourcePath, sourceFile());
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { circuitPlatform: engine } });
  const workspace = useDocumentWorkspace();
  try {
    await workspace.requestNew();
    const parentKey = workspace.activeDocumentKey.value;
    engine.openChoices.push({ ok: true, path: sourcePath });
    assert.equal(await workspace.addSubcircuitFromDialog(), true);
    const componentId = workspace.editorState.value!.document.components[0]!.id;
    assert.equal(await workspace.openSubcircuit(componentId), true);
    assert.equal(workspace.tabs.value.length, 2);
    assert.equal(workspace.tabs.value[1]?.path, null);
    assert.equal(workspace.activeDefinition.value?.missing, false);
    assert.equal(await workspace.returnToParent(), true);
    assert.equal(workspace.activeDocumentKey.value, parentKey);
    assert.equal(workspace.editorState.value?.selection?.kind, "component");
    const parentPath = "D:\\archive\\parent.circuit.json";
    engine.saveChoices.push({ ok: true, path: parentPath });
    assert.equal(await workspace.saveAs(), true);
    await workspace.requestOpenRecent(parentPath);
    assert.equal(workspace.tabs.value.length, 2);
    assert.equal(workspace.activeDocumentKey.value, parentKey);
  } finally {
    workspace.dispose();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
