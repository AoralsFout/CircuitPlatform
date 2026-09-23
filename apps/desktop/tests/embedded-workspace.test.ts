import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentKindName, EngineResponse, PortSpec } from "@circuit-platform/protocol";
import { useWorkspace } from "../src/composables/useWorkspace.ts";
import { useDocumentWorkspace } from "../src/composables/useDocumentWorkspace.ts";
import { serializeProjectFile, type ProjectFileData } from "../src/project-file/index.ts";
import { portsForAddComponent } from "./fake-ports.ts";
import { canvasSubcircuitName } from "../src/project-file/library.ts";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** 公开工作区操作的可控文件与引擎适配器。 */
class EmbeddedEngine {
  readonly files = new Map<string, string>();
  readonly readPaths: string[] = [];
  readonly openChoices: Array<{ ok: true; path: string } | { ok: false; reason: string }> = [];
  readonly saveChoices: Array<{ ok: true; path: string } | { ok: false; reason: string }> = [];
  nextComponentId = 1;
  nextConnectionId = 1;
  readonly activeComponents = new Map<number, ComponentKindName>();
  readonly activeConnections = new Set<number>();
  failNextAdd = false;
  addedConnections = 0;
  removedConnections = 0;
  failNextWrite = false;
  diskFiles = false;

  async checkEngine() { return { status: "ok" as const, engine: "fake-engine" }; }
  async addComponent(kind: ComponentKindName, ports?: readonly PortSpec[]): Promise<EngineResponse> {
    if (this.failNextAdd) {
      this.failNextAdd = false;
      return { type: "error", requestId: "fake", code: "FAKE_ERROR", message: "创建元件失败" };
    }
    const componentId = this.nextComponentId++;
    this.activeComponents.set(componentId, kind);
    return { type: "component_added", requestId: "fake", componentId, ports: portsForAddComponent(kind, ports) };
  }
  async removeComponent(componentId: number): Promise<EngineResponse> {
    this.activeComponents.delete(componentId);
    return { type: "component_removed", requestId: "fake", componentId };
  }
  async addConnection(): Promise<EngineResponse> {
    this.addedConnections += 1;
    const connectionId = this.nextConnectionId++;
    this.activeConnections.add(connectionId);
    return { type: "connection_added", requestId: "fake", connectionId };
  }
  async removeConnection(connectionId: number): Promise<EngineResponse> {
    this.removedConnections += 1;
    this.activeConnections.delete(connectionId);
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
    if (this.diskFiles) {
      try { return { ok: true as const, content: readFileSync(path, "utf8") }; }
      catch { return { ok: false as const, reason: "项目文件不存在。", code: "PROJECT_FILE_NOT_FOUND" }; }
    }
    const content = this.files.get(path);
    return content === undefined
      ? { ok: false as const, reason: "项目文件不存在。", code: "PROJECT_FILE_NOT_FOUND" }
      : { ok: true as const, content };
  }
  async writeProjectFile(path: string, content: string) {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      return { ok: false as const, reason: "磁盘不可写" };
    }
    if (this.diskFiles) writeFileSync(path, content, "utf8");
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

test("reimport from a new file updates every use in one undoable frame and keeps the local name", async () => {
  const engine = new EmbeddedEngine();
  const originalPath = "E:\\circuits\\original.circuit.json";
  const replacementPath = "G:\\moved\\replacement.circuit.json";
  engine.files.set(originalPath, sourceFile());
  const initial = JSON.parse(sourceFile()) as ProjectFileData;
  const replacement: ProjectFileData = { ...initial, circuit: {
    components: initial.circuit.components.map((component) => component.id === "gate" ? { ...component, id: "replacement-gate" } : component),
    connections: initial.circuit.connections.map((connection) => ({
      ...connection,
      source: connection.source.component === "gate" ? { ...connection.source, component: "replacement-gate" } : connection.source,
      target: connection.target.component === "gate" ? { ...connection.target, component: "replacement-gate" } : connection.target,
    })),
  } };
  engine.files.set(replacementPath, JSON.stringify(replacement));
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { circuitPlatform: engine } });
  const binding = useWorkspace();
  try {
    await binding.bootstrap();
    await binding.requestNew();
    engine.openChoices.push({ ok: true, path: originalPath });
    assert.equal(await binding.addSubcircuitFromDialog(), true);
    const definitionId = binding.libraryTree.value[0]!.definitionId;
    assert.equal(await binding.placeImportedSubcircuit(definitionId, { x: 440, y: 180 }), true);
    assert.equal(await binding.renameImportedSubcircuit(definitionId, "本地名称"), true);
    engine.openChoices.push({ ok: true, path: replacementPath });
    assert.equal(await binding.reimportEmbeddedDefinition(definitionId), true, binding.openError.value ?? "");
    assert.equal(binding.libraryTree.value[0]?.definitionId, definitionId);
    assert.equal(binding.libraryTree.value[0]?.displayName, "本地名称");
    assert.deepEqual(binding.editorState.value?.document.components.map((component) => component.data?.subcircuit?.definitionId), [definitionId, definitionId]);
    assert.deepEqual(binding.state.value.internalComponents?.filter((item) => item.kind === "not").map((item) => item.path.at(-1)), ["replacement-gate", "replacement-gate"]);
    await binding.undo();
    assert.deepEqual(binding.state.value.internalComponents?.filter((item) => item.kind === "not").map((item) => item.path.at(-1)), ["gate", "gate"]);
    assert.equal(binding.libraryTree.value[0]?.displayName, "本地名称");
    await binding.redo();
    assert.deepEqual(binding.state.value.internalComponents?.filter((item) => item.kind === "not").map((item) => item.path.at(-1)), ["replacement-gate", "replacement-gate"]);
    assert.deepEqual(engine.readPaths, [originalPath, replacementPath]);
  } finally {
    await binding.dispose();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("cancel, malformed file, and engine rejection leave reimport definitions and history intact", async () => {
  const engine = new EmbeddedEngine();
  const path = "E:\\circuits\\source.circuit.json";
  engine.files.set(path, sourceFile());
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { circuitPlatform: engine } });
  const binding = useWorkspace();
  try {
    await binding.bootstrap();
    await binding.requestNew();
    engine.openChoices.push({ ok: true, path });
    assert.equal(await binding.addSubcircuitFromDialog(), true);
    const id = binding.libraryTree.value[0]!.definitionId;
    const before = JSON.stringify(binding.editorState.value?.document);
    const beforeTree = JSON.stringify(binding.libraryTree.value);
    const reads = engine.readPaths.length;
    assert.equal(await binding.reimportEmbeddedDefinition(id), false);
    assert.equal(engine.readPaths.length, reads);
    engine.files.set("E:\\bad.circuit.json", "{broken");
    engine.openChoices.push({ ok: true, path: "E:\\bad.circuit.json" });
    assert.equal(await binding.reimportEmbeddedDefinition(id), false);
    engine.openChoices.push({ ok: true, path: "E:\\missing.circuit.json" });
    assert.equal(await binding.reimportEmbeddedDefinition(id), false);
    const cyclic: ProjectFileData = {
      version: 2,
      circuit: { components: [{ id: "nested", kind: "subcircuit", displayName: "nested", position: { x: 0, y: 0 }, data: { definitionId: "cycle", cachedPorts: [] } }], connections: [] },
      definitions: { cycle: { displayName: "Cycle", circuit: { components: [{ id: "self", kind: "subcircuit", displayName: "self", position: { x: 0, y: 0 }, data: { definitionId: "cycle", cachedPorts: [] } }], connections: [] } } },
      libraryRoots: ["cycle"],
    };
    engine.files.set("E:\\cycle.circuit.json", JSON.stringify(cyclic));
    engine.openChoices.push({ ok: true, path: "E:\\cycle.circuit.json" });
    assert.equal(await binding.reimportEmbeddedDefinition(id), false);
    engine.failNextAdd = true;
    engine.openChoices.push({ ok: true, path });
    assert.equal(await binding.reimportEmbeddedDefinition(id), false);
    assert.equal(JSON.stringify(binding.editorState.value?.document), before);
    assert.equal(JSON.stringify(binding.libraryTree.value), beforeTree);
    await binding.undo();
    assert.equal(binding.libraryTree.value.length, 0, "失败不增加历史帧");
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

test("export writes a standalone direct or nested v2 project through the file adapter without changing its parent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "circuitplatform-export-"));
  const parentPath = join(directory, "parent.circuit.json");
  const sourcePath = join(directory, "deleted-source.circuit.json");
  const directPath = join(directory, "wrapper-export.circuit.json");
  const nestedPath = join(directory, "child-export.circuit.json");
  const child = JSON.parse(sourceFile()) as ProjectFileData;
  const ports: PortSpec[] = [
    { name: "A", direction: "input", width: 1 },
    { name: "Y", direction: "output", width: 1 },
  ];
  const parent: ProjectFileData = {
    version: 2,
    circuit: { components: [], connections: [] },
    definitions: {
      wrapper: { displayName: "wrapper.circuit.json", circuit: {
        components: [{ id: "nested", kind: "subcircuit", displayName: "child.circuit.json", position: { x: 100, y: 80 }, data: { definitionId: "child", cachedPorts: ports } }],
        connections: [],
      } },
      child: { displayName: "child.circuit.json", circuit: child.circuit },
      idle: { displayName: "idle.circuit.json", circuit: { components: [], connections: [] } },
    },
    libraryRoots: ["wrapper", "idle"],
  };
  const parentContent = JSON.stringify(parent);
  writeFileSync(parentPath, parentContent, "utf8");
  writeFileSync(sourcePath, sourceFile(), "utf8");
  unlinkSync(sourcePath);
  const engine = new EmbeddedEngine();
  engine.diskFiles = true;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { circuitPlatform: engine } });
  let binding: ReturnType<typeof useWorkspace> | null = null;
  let independent: ReturnType<typeof useWorkspace> | null = null;
  try {
    binding = useWorkspace();
    await binding.bootstrap();
    assert.equal(await binding.openProjectFromPath(parentPath), true, binding.openError.value ?? "");
    await binding.step();
    const before = {
      document: JSON.parse(JSON.stringify(binding.editorState.value?.document)),
      canUndo: binding.editorState.value?.canUndo,
      simulationStep: binding.state.value.simulationStep,
      isDirty: binding.isDirty.value,
    };

    engine.saveChoices.push({ ok: false, reason: "canceled" });
    assert.equal(await binding.exportImportedSubcircuit("wrapper"), false);
    assert.equal(binding.exportFeedback.value?.kind, "canceled");
    engine.saveChoices.push({ ok: true, path: parentPath });
    assert.equal(await binding.exportImportedSubcircuit("wrapper"), false);
    assert.match(binding.exportFeedback.value?.message ?? "", /不能覆盖当前父 Project/);
    engine.saveChoices.push({ ok: true, path: directPath });
    engine.failNextWrite = true;
    assert.equal(await binding.exportImportedSubcircuit("wrapper"), false);
    assert.match(binding.exportFeedback.value?.message ?? "", /磁盘不可写/);
    assert.equal(await binding.exportImportedSubcircuit("deleted"), false);
    assert.match(binding.exportFeedback.value?.message ?? "", /已不存在/);

    engine.saveChoices.push({ ok: true, path: directPath });
    assert.equal(await binding.exportImportedSubcircuit("wrapper"), true);
    assert.equal(binding.exportFeedback.value?.kind, "success");
    const direct = JSON.parse(readFileSync(directPath, "utf8")) as ProjectFileData;
    assert.equal(direct.version, 2);
    assert.deepEqual(direct.circuit, parent.definitions.wrapper?.circuit);
    assert.deepEqual(Object.keys(direct.definitions), ["child"]);
    assert.deepEqual(direct.libraryRoots, []);
    engine.saveChoices.push({ ok: true, path: nestedPath });
    assert.equal(await binding.exportImportedSubcircuit("child"), true);
    const nested = JSON.parse(readFileSync(nestedPath, "utf8")) as ProjectFileData;
    assert.deepEqual(nested.circuit, parent.definitions.child?.circuit);
    assert.deepEqual(nested.definitions, {});
    assert.deepEqual({
      document: binding.editorState.value?.document,
      canUndo: binding.editorState.value?.canUndo,
      simulationStep: binding.state.value.simulationStep,
      isDirty: binding.isDirty.value,
    }, before);
    assert.equal(readFileSync(parentPath, "utf8"), parentContent);
    assert.deepEqual(engine.readPaths, [parentPath]);

    independent = useWorkspace();
    await independent.bootstrap();
    assert.equal(await independent.openProjectFromPath(directPath), true, independent.openError.value ?? "");
    assert.equal(await independent.addComponent("and", { x: 420, y: 180 }), true);
    await independent.step();
    assert.ok(independent.state.value.simulationStep > 0);
    assert.equal(await independent.save(), true);
    assert.equal((JSON.parse(readFileSync(directPath, "utf8")) as ProjectFileData).circuit.components.length, 2);
    assert.equal(readFileSync(parentPath, "utf8"), parentContent);
    assert.deepEqual(binding.libraryTree.value.map((node) => node.displayName), ["wrapper.circuit.json", "idle.circuit.json"]);
  } finally {
    await independent?.dispose();
    await binding?.dispose();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    await rm(directory, { recursive: true, force: true });
  }
});

test("deleting a used definition requires confirmation, preserves wiring, and survives save and reopen", async () => {
  const engine = new EmbeddedEngine();
  const parentPath = "D:\\archive\\with-definition.circuit.json";
  const child = JSON.parse(sourceFile()) as ProjectFileData;
  const publishedPorts: PortSpec[] = [
    { name: "A", direction: "input", width: 1 },
    { name: "Y", direction: "output", width: 1 },
  ];
  const parent: ProjectFileData = {
    version: 2,
    circuit: {
      components: [
        { id: "input", kind: "input", displayName: "IN", position: { x: 0, y: 0 }, ports: [{ name: "out", direction: "output", width: 1 }] },
        { id: "instance", kind: "subcircuit", displayName: "child.circuit.json", position: { x: 150, y: 0 }, data: { definitionId: "child", cachedPorts: publishedPorts } },
        { id: "output", kind: "output", displayName: "OUT", position: { x: 300, y: 0 }, ports: [{ name: "in", direction: "input", width: 1 }] },
        { id: "healthy", kind: "not", displayName: "HEALTHY", position: { x: 100, y: 170 } },
        { id: "healthy-in", kind: "input", displayName: "HEALTHY-IN", position: { x: 0, y: 170 }, ports: [{ name: "out", direction: "output", width: 1 }] },
        { id: "healthy-out", kind: "output", displayName: "HEALTHY-OUT", position: { x: 220, y: 170 }, ports: [{ name: "in", direction: "input", width: 1 }] },
      ],
      connections: [
        { id: "to-child", source: { component: "input", port: "out" }, target: { component: "instance", port: "A" } },
        { id: "from-child", source: { component: "instance", port: "Y" }, target: { component: "output", port: "in" } },
        { id: "healthy-in-wire", source: { component: "healthy-in", port: "out" }, target: { component: "healthy", port: "in" } },
        { id: "healthy-out-wire", source: { component: "healthy", port: "out" }, target: { component: "healthy-out", port: "in" } },
      ],
    },
    definitions: { child: { displayName: "child.circuit.json", circuit: child.circuit } },
    libraryRoots: ["child"],
  };
  engine.files.set(parentPath, JSON.stringify(parent));
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { circuitPlatform: engine } });
  const workspace = useDocumentWorkspace();
  let reopened: ReturnType<typeof useWorkspace> | null = null;
  try {
    await workspace.requestOpenRecent(parentPath);
    const parentKey = workspace.activeDocumentKey.value;
    assert.equal(await workspace.openEmbeddedDefinition("child"), true);
    const definitionKey = workspace.activeDocumentKey.value;
    await workspace.activateTab(parentKey);
    assert.equal(await workspace.requestDeleteImportedSubcircuit("child"), true);
    assert.equal(workspace.pendingDefinitionDeletion.value?.uses.length, 1);
    assert.match(workspace.pendingDefinitionDeletion.value?.uses[0]?.location ?? "", /顶层电路.*instance/);
    assert.equal(workspace.getEmbeddedDefinition("child")?.circuit.components.length, 3);
    workspace.cancelDeleteImportedSubcircuit();
    assert.equal(workspace.pendingDefinitionDeletion.value, null);
    assert.equal(await workspace.requestDeleteImportedSubcircuit("child"), true);
    assert.equal(await workspace.confirmDeleteImportedSubcircuit(), true);
    assert.equal(workspace.getEmbeddedDefinition("child"), null);
    assert.equal(await workspace.exportImportedSubcircuit("child"), false);
    assert.match(workspace.exportFeedback.value?.message ?? "", /已不存在/);
    assert.equal(workspace.editorState.value?.document.components.find((item: { id: string }) => item.id === "instance")?.data?.subcircuit?.status, "unresolved");
    assert.equal(workspace.editorState.value?.document.connections.length, 4);
    assert.equal([...engine.activeComponents.values()].filter((kind) => kind === "not").length, 1);
    assert.equal(engine.activeConnections.size, 2);
    await workspace.activateTab(definitionKey);
    assert.equal(workspace.activeDefinition.value?.missing, true);
    await workspace.activateTab(parentKey);
    await workspace.undo();
    assert.equal(workspace.getEmbeddedDefinition("child")?.circuit.components.length, 3);
    const exportPath = "D:\\archive\\restored-child.circuit.json";
    engine.saveChoices.push({ ok: true, path: exportPath });
    assert.equal(await workspace.exportImportedSubcircuit("child"), true);
    assert.equal(JSON.parse(engine.files.get(exportPath)!).circuit.components.length, 3);
    await workspace.activateTab(definitionKey);
    assert.equal(workspace.activeDefinition.value?.missing, false);
    await workspace.activateTab(parentKey);
    await workspace.redo();
    assert.equal(workspace.getEmbeddedDefinition("child"), null);
    assert.equal(await workspace.save(), true);
    const saved = JSON.parse(engine.files.get(parentPath)!);
    assert.deepEqual(saved.definitions, {});
    assert.equal(saved.circuit.components[1].data.definitionId, "child");
    assert.deepEqual(saved.circuit.components[1].data.cachedPorts, publishedPorts);
    assert.equal(saved.circuit.connections.length, 4);
    reopened = useWorkspace();
    await reopened.bootstrap();
    assert.equal(await reopened.openProjectFromPath(parentPath), true);
    assert.equal(reopened.editorState.value?.document.components[1]?.data?.subcircuit?.status, "unresolved");
    assert.equal(reopened.editorState.value?.document.connections.length, 4);
  } finally {
    await reopened?.dispose();
    workspace.dispose();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("deleting an unused imported definition commits immediately and is one undo frame", async () => {
  const engine = new EmbeddedEngine();
  const sourcePath = "E:\\circuits\\source.circuit.json";
  engine.files.set(sourcePath, sourceFile());
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { circuitPlatform: engine } });
  const binding = useWorkspace();
  try {
    await binding.bootstrap();
    await binding.requestNew();
    engine.openChoices.push({ ok: true, path: sourcePath });
    assert.equal(await binding.importSubcircuitOnlyFromDialog(), true);
    const id = binding.libraryTree.value[0]!.definitionId;
    assert.equal(await binding.requestDeleteImportedSubcircuit(id), true);
    assert.equal(binding.pendingDefinitionDeletion.value, null);
    assert.equal(binding.libraryTree.value.length, 0);
    await binding.undo();
    assert.equal(binding.libraryTree.value[0]?.definitionId, id);
  } finally {
    await binding.dispose();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("top-level Port changes preview affected wires; cancel is inert and confirm saves a dangling wire", async () => {
  for (const change of ["rename", "delete", "direction", "width"] as const) {
    const engine = new EmbeddedEngine();
    const sourcePath = `E:\\circuits\\${change}-old.circuit.json`;
    const replacementPath = `G:\\moved\\${change}-new.circuit.json`;
    engine.files.set(sourcePath, sourceFile());
    const source = JSON.parse(sourceFile()) as ProjectFileData;
    const components = source.circuit.components.flatMap((component) => {
      if (component.id !== "in") return [component];
      if (change === "delete") return [];
      if (change === "rename") return [{ ...component, displayName: "Renamed" }];
      if (change === "direction") return [{ ...component, kind: "output" as const, ports: [{ name: "in", direction: "input" as const, width: 1 }] }];
      return [{ ...component, ports: [{ name: "out", direction: "output" as const, width: 2 }] }];
    });
    const replacement: ProjectFileData = {
      ...source,
      circuit: {
        components,
        connections: change === "delete" || change === "direction"
          ? source.circuit.connections.filter((connection) => connection.id !== "w1")
          : source.circuit.connections,
      },
    };
    engine.files.set(replacementPath, JSON.stringify(replacement));
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: { circuitPlatform: engine } });
    const binding = useWorkspace();
    try {
      await binding.bootstrap();
      await binding.requestNew();
      engine.openChoices.push({ ok: true, path: sourcePath });
      assert.equal(await binding.addSubcircuitFromDialog(), true, change);
      const definitionId = binding.libraryTree.value[0]!.definitionId;
      const use = binding.editorState.value!.document.components[0]!;
      assert.equal(await binding.addComponent("input", { x: 0, y: 0 }), true);
      const driver = binding.editorState.value!.document.components.find((component) => component.kind === "input")!;
      const wired = await binding.createConnection(
        { componentId: driver.id, port: "out", direction: "output", point: { x: 0, y: 0 } },
        { componentId: use.id, port: "A", direction: "input", point: { x: 0, y: 0 } },
      );
      assert.equal(wired.ok, true, wired.error);
      const wireId = binding.editorState.value!.document.connections[0]!.id;
      const before = JSON.stringify(binding.editorState.value?.document);
      const removedBefore = engine.removedConnections;
      engine.openChoices.push({ ok: true, path: replacementPath });
      assert.equal(await binding.reimportEmbeddedDefinition(definitionId), false, change);
      assert.deepEqual(binding.pendingReimport.value?.impacts.map((impact) => [impact.connectionId, impact.componentId, impact.portName]), [[wireId, use.id, "A"]]);
      assert.equal(JSON.stringify(binding.editorState.value?.document), before);
      assert.equal(engine.removedConnections, removedBefore);
      binding.cancelReimport();
      assert.equal(binding.pendingReimport.value, null);
      assert.equal(JSON.stringify(binding.editorState.value?.document), before);
      engine.openChoices.push({ ok: true, path: replacementPath });
      assert.equal(await binding.reimportEmbeddedDefinition(definitionId), false);
      if (change === "rename") {
        engine.failNextAdd = true;
        assert.equal(await binding.confirmReimport(), false, "引擎拒绝确认时回滚");
        assert.equal(JSON.stringify(binding.editorState.value?.document), before);
        assert.equal(binding.pendingReimport.value, null);
        engine.openChoices.push({ ok: true, path: replacementPath });
        assert.equal(await binding.reimportEmbeddedDefinition(definitionId), false);
      }
      assert.equal(await binding.confirmReimport(), true, `${change}: ${binding.openError.value ?? ""}`);
      assert.equal(binding.pendingReimport.value, null);
      assert.equal(binding.editorState.value?.document.connections[0]?.id, wireId);
      assert.ok(binding.editorState.value?.document.connections[0]?.danglingEndpoints.includes("target"), change);
      assert.ok(engine.removedConnections > removedBefore, change);
      engine.saveChoices.push({ ok: true, path: `D:\\archive\\${change}-parent.circuit.json` });
      assert.equal(await binding.saveAs(), true, change);
      const saved = JSON.parse(engine.files.get(`D:\\archive\\${change}-parent.circuit.json`)!) as ProjectFileData;
      assert.equal(saved.circuit.connections[0]?.id, wireId);
      const reopened = useWorkspace();
      try {
        await reopened.bootstrap();
        assert.equal(await reopened.openProjectFromPath(`D:\\archive\\${change}-parent.circuit.json`), true, change);
        assert.equal(reopened.editorState.value?.document.connections[0]?.id, wireId);
        assert.ok(reopened.editorState.value?.document.connections[0]?.danglingEndpoints.includes("target"), change);
        assert.match(reopened.openError.value ?? "", /部分连接或定义需要检查/);
      } finally {
        await reopened.dispose();
      }
      await binding.undo();
      assert.equal(binding.editorState.value?.document.connections[0]?.danglingEndpoints.length, 0);
    } finally {
      await binding.dispose();
      if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("nested Port change is rejected before preview and leaves the readonly ancestor unchanged", async () => {
  const engine = new EmbeddedEngine();
  const parentPath = "E:\\circuits\\parent.circuit.json";
  const sourcePath = "G:\\moved\\new-child.circuit.json";
  const oldChild = JSON.parse(sourceFile()) as ProjectFileData;
  const childPorts: PortSpec[] = [{ name: "A", direction: "input", width: 1 }, { name: "Y", direction: "output", width: 1 }];
  const wrapper: ProjectFileData["circuit"] = {
    components: [
      { id: "driver", kind: "input", displayName: "driver", position: { x: 0, y: 0 }, ports: [{ name: "out", direction: "output", width: 1 }] },
      { id: "inner", kind: "subcircuit", displayName: "Child", position: { x: 120, y: 0 }, data: { definitionId: "B", cachedPorts: childPorts } },
    ],
    connections: [{ id: "readonly-wire", source: { component: "driver", port: "out" }, target: { component: "inner", port: "A" } }],
  };
  const parent: ProjectFileData = {
    version: 2,
    circuit: { components: [{ id: "outer", kind: "subcircuit", displayName: "A", position: { x: 0, y: 0 }, data: { definitionId: "A", cachedPorts: [{ name: "driver", direction: "input", width: 1 }] } }], connections: [] },
    definitions: { A: { displayName: "Readonly A", circuit: wrapper }, B: { displayName: "B", circuit: oldChild.circuit } },
    libraryRoots: ["A"],
  };
  const replacement: ProjectFileData = { ...oldChild, circuit: { ...oldChild.circuit, components: oldChild.circuit.components.map((component) => component.id === "in" ? { ...component, displayName: "Renamed" } : component) } };
  engine.files.set(parentPath, JSON.stringify(parent));
  engine.files.set(sourcePath, JSON.stringify(replacement));
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { circuitPlatform: engine } });
  const binding = useWorkspace();
  try {
    await binding.bootstrap();
    assert.equal(await binding.openProjectFromPath(parentPath), true);
    const before = JSON.stringify(binding.libraryTree.value);
    const removedBefore = engine.removedConnections;
    engine.openChoices.push({ ok: true, path: sourcePath });
    assert.equal(await binding.reimportEmbeddedDefinition("B"), false);
    assert.equal(binding.pendingReimport.value, null);
    assert.match(binding.openError.value ?? "", /Readonly A.*readonly-wire/);
    assert.equal(JSON.stringify(binding.libraryTree.value), before);
    assert.equal(engine.removedConnections, removedBefore);
    assert.equal(binding.editorState.value?.canUndo, false);
  } finally {
    await binding.dispose();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("a missing top-level use relinks to an existing compatible definition in one frame and reopens", async () => {
  const engine = new EmbeddedEngine();
  const path = "D:\\archive\\missing-use.circuit.json";
  const child = JSON.parse(sourceFile()) as ProjectFileData;
  const ports: PortSpec[] = [{ name: "A", direction: "input", width: 1 }, { name: "Y", direction: "output", width: 1 }];
  const parent: ProjectFileData = {
    version: 2,
    circuit: { components: [
      { id: "driver", kind: "input", displayName: "driver", position: { x: 0, y: 0 }, ports: [{ name: "out", direction: "output", width: 1 }] },
      { id: "instance", kind: "subcircuit", displayName: "missing", position: { x: 120, y: 0 }, data: { definitionId: "missing", cachedPorts: ports } },
    ], connections: [{ id: "wire", source: { component: "driver", port: "out" }, target: { component: "instance", port: "A" } }] },
    definitions: { available: { displayName: "Available", circuit: child.circuit } }, libraryRoots: ["available"],
  };
  engine.files.set(path, JSON.stringify(parent));
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { circuitPlatform: engine } });
  const binding = useWorkspace();
  let reopened: ReturnType<typeof useWorkspace> | null = null;
  try {
    await binding.bootstrap();
    assert.equal(await binding.openProjectFromPath(path), true);
    assert.deepEqual(binding.missingUses.value.map((use) => use.componentId), ["instance"]);
    assert.equal(engine.activeConnections.size, 0);
    const before = JSON.stringify(binding.editorState.value?.document);
    assert.equal(await binding.repairMissingUseWithDefinition(null, "instance", "available"), true, binding.openError.value ?? "");
    assert.equal(binding.pendingReimport.value, null);
    assert.equal(binding.missingUses.value.length, 0);
    assert.equal(binding.editorState.value?.document.components.find((item) => item.id === "instance")?.data?.subcircuit?.definitionId, "available");
    assert.equal(binding.editorState.value?.document.connections[0]?.id, "wire");
    assert.equal(binding.editorState.value?.document.connections[0]?.danglingEndpoints.length, 0);
    assert.equal(engine.activeConnections.size, 1);
    await binding.undo();
    assert.equal(JSON.stringify(binding.editorState.value?.document), before);
    assert.equal(binding.missingUses.value.length, 1);
    await binding.redo();
    assert.equal(binding.missingUses.value.length, 0);
    assert.equal(await binding.save(), true);
    reopened = useWorkspace();
    await reopened.bootstrap();
    assert.equal(await reopened.openProjectFromPath(path), true);
    assert.equal(reopened.editorState.value?.document.connections[0]?.danglingEndpoints.length, 0);
    assert.equal(reopened.missingUses.value.length, 0);
  } finally {
    await reopened?.dispose();
    await binding.dispose();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("file repair previews a dangling top-level wire; cancellation and failures keep the missing use", async () => {
  const engine = new EmbeddedEngine();
  const parentPath = "D:\\archive\\repair-parent.circuit.json";
  const sourcePath = "G:\\sources\\renamed.circuit.json";
  const oldPorts: PortSpec[] = [{ name: "A", direction: "input", width: 1 }, { name: "Y", direction: "output", width: 1 }];
  const parent: ProjectFileData = { version: 2, circuit: { components: [
    { id: "driver", kind: "input", displayName: "driver", position: { x: 0, y: 0 }, ports: [{ name: "out", direction: "output", width: 1 }] },
    { id: "instance", kind: "subcircuit", displayName: "deleted", position: { x: 100, y: 0 }, data: { definitionId: "deleted", cachedPorts: oldPorts, portOrder: ["A", "Y"] } },
  ], connections: [{ id: "wire", source: { component: "driver", port: "out" }, target: { component: "instance", port: "A" } }] },
  definitions: {}, libraryRoots: [] };
  const source = JSON.parse(sourceFile()) as ProjectFileData;
  source.circuit.components[0]!.displayName = "Renamed";
  parent.definitions = { incompatible: { displayName: "Incompatible", circuit: source.circuit } };
  parent.libraryRoots = ["incompatible"];
  engine.files.set(parentPath, JSON.stringify(parent));
  engine.files.set(sourcePath, JSON.stringify(source));
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { circuitPlatform: engine } });
  const binding = useWorkspace();
  let reopened: ReturnType<typeof useWorkspace> | null = null;
  try {
    await binding.bootstrap();
    assert.equal(await binding.openProjectFromPath(parentPath), true);
    const before = JSON.stringify(binding.editorState.value?.document);
    assert.equal(await binding.repairMissingUseWithDefinition(null, "instance", "incompatible"), false);
    assert.deepEqual(binding.pendingReimport.value?.impacts.map((impact) => impact.connectionId), ["wire"]);
    binding.cancelReimport();
    assert.equal(await binding.repairMissingUseFromDialog(null, "instance"), false, "文件选择取消");
    engine.openChoices.push({ ok: true, path: "G:\\missing.circuit.json" });
    assert.equal(await binding.repairMissingUseFromDialog(null, "instance"), false, "读取失败");
    engine.files.set("G:\\bad.circuit.json", "{");
    engine.openChoices.push({ ok: true, path: "G:\\bad.circuit.json" });
    assert.equal(await binding.repairMissingUseFromDialog(null, "instance"), false, "解析失败");
    const cyclic: ProjectFileData = { version: 2, circuit: { components: [{ id: "loop", kind: "subcircuit", displayName: "loop", position: { x: 0, y: 0 }, data: { definitionId: "loop", cachedPorts: [] } }], connections: [] },
      definitions: { loop: { displayName: "loop", circuit: { components: [{ id: "again", kind: "subcircuit", displayName: "again", position: { x: 0, y: 0 }, data: { definitionId: "loop", cachedPorts: [] } }], connections: [] } } }, libraryRoots: ["loop"] };
    engine.files.set("G:\\cycle.circuit.json", JSON.stringify(cyclic));
    engine.openChoices.push({ ok: true, path: "G:\\cycle.circuit.json" });
    assert.equal(await binding.repairMissingUseFromDialog(null, "instance"), false, "循环定义拒绝");
    assert.equal(JSON.stringify(binding.editorState.value?.document), before);
    engine.openChoices.push({ ok: true, path: sourcePath });
    assert.equal(await binding.repairMissingUseFromDialog(null, "instance"), false);
    assert.equal(binding.pendingReimport.value?.action, "repair");
    assert.deepEqual(binding.pendingReimport.value?.impacts.map((impact) => impact.connectionId), ["wire"]);
    assert.equal(JSON.stringify(binding.editorState.value?.document), before);
    binding.cancelReimport();
    assert.equal(JSON.stringify(binding.editorState.value?.document), before);
    engine.openChoices.push({ ok: true, path: sourcePath });
    assert.equal(await binding.repairMissingUseFromDialog(null, "instance"), false);
    engine.failNextAdd = true;
    assert.equal(await binding.confirmReimport(), false, "引擎失败回滚");
    assert.equal(JSON.stringify(binding.editorState.value?.document), before);
    engine.openChoices.push({ ok: true, path: sourcePath });
    assert.equal(await binding.repairMissingUseFromDialog(null, "instance"), false);
    assert.equal(await binding.confirmReimport(), true, binding.openError.value ?? "");
    assert.equal(binding.missingUses.value.length, 0);
    assert.equal(binding.editorState.value?.document.connections[0]?.id, "wire");
    assert.ok(binding.editorState.value?.document.connections[0]?.danglingEndpoints.includes("target"));
    await binding.undo();
    assert.equal(JSON.stringify(binding.editorState.value?.document), before);
    await binding.redo();
    assert.equal(await binding.save(), true);
    reopened = useWorkspace();
    await reopened.bootstrap();
    assert.equal(await reopened.openProjectFromPath(parentPath), true);
    assert.ok(reopened.editorState.value?.document.connections[0]?.danglingEndpoints.includes("target"));
    await reopened.deleteConnection("wire");
    const repairedCache = reopened.editorState.value?.document.components.find((item) => item.id === "instance")?.data?.subcircuit?.cachedPorts;
    assert.equal(repairedCache?.some((port) => port.name === "A"), false);
    assert.equal(repairedCache?.some((port) => port.name === "Renamed"), true);
    assert.equal(reopened.editorState.value?.document.components.find((item) => item.id === "instance")?.data?.subcircuit?.portOrder, undefined);
    const reconnected = await reopened.createConnection(
      { componentId: "driver", port: "out", direction: "output", point: { x: 0, y: 0 } },
      { componentId: "instance", port: "Renamed", direction: "input", point: { x: 0, y: 0 } },
    );
    assert.equal(reconnected.ok, true, reconnected.error);
    assert.equal(reopened.editorState.value?.document.connections[0]?.danglingEndpoints.length, 0);
    assert.equal(await reopened.save(), true);
    await binding.undo();
    engine.files.set("G:\\sources\\compatible.circuit.json", sourceFile());
    engine.openChoices.push({ ok: true, path: "G:\\sources\\compatible.circuit.json" });
    assert.equal(await binding.repairMissingUseFromDialog(null, "instance"), true);
    assert.equal(binding.pendingReimport.value, null);
    assert.equal(binding.editorState.value?.document.connections[0]?.danglingEndpoints.length, 0);
  } finally {
    await reopened?.dispose();
    await binding.dispose();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("nested missing use rejects incompatible repair and accepts a compatible definition atomically", async () => {
  const engine = new EmbeddedEngine();
  const parentPath = "D:\\archive\\nested-repair.circuit.json";
  const child = JSON.parse(sourceFile()) as ProjectFileData;
  const ports: PortSpec[] = [{ name: "A", direction: "input", width: 1 }, { name: "Y", direction: "output", width: 1 }];
  const changed = structuredClone(child.circuit);
  changed.components[0]!.displayName = "Renamed";
  const parent: ProjectFileData = { version: 2,
    circuit: { components: [{ id: "outer", kind: "subcircuit", displayName: "A", position: { x: 0, y: 0 }, data: { definitionId: "A", cachedPorts: [{ name: "driver", direction: "input", width: 1 }] } }], connections: [] },
    definitions: {
      A: { displayName: "A", circuit: { components: [
        { id: "driver", kind: "input", displayName: "driver", position: { x: 0, y: 0 }, ports: [{ name: "out", direction: "output", width: 1 }] },
        { id: "inner", kind: "subcircuit", displayName: "deleted", position: { x: 120, y: 0 }, data: { definitionId: "deleted", cachedPorts: ports } },
      ], connections: [{ id: "internal", source: { component: "driver", port: "out" }, target: { component: "inner", port: "A" } }] } },
      compatible: { displayName: "Compatible", circuit: child.circuit },
      incompatible: { displayName: "Incompatible", circuit: changed },
    }, libraryRoots: ["A", "compatible", "incompatible"] };
  engine.files.set(parentPath, JSON.stringify(parent));
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { circuitPlatform: engine } });
  const binding = useWorkspace();
  try {
    await binding.bootstrap();
    assert.equal(await binding.openProjectFromPath(parentPath), true);
    const before = JSON.stringify(binding.getEmbeddedDefinition("A")?.circuit);
    assert.deepEqual(binding.missingUses.value.map((use) => [use.ownerDefinitionId, use.componentId]), [["A", "inner"]]);
    assert.equal(await binding.repairMissingUseWithDefinition("A", "inner", "incompatible"), false);
    assert.match(binding.openError.value ?? "", /A.*internal.*A/);
    assert.equal(binding.pendingReimport.value, null);
    assert.equal(JSON.stringify(binding.getEmbeddedDefinition("A")?.circuit), before);
    assert.equal(await binding.repairMissingUseWithDefinition("A", "inner", "compatible"), true, binding.openError.value ?? "");
    const repaired = binding.getEmbeddedDefinition("A")?.circuit.components[1]?.data;
    assert.ok(repaired && "definitionId" in repaired);
    assert.equal(repaired.definitionId, "compatible");
    await binding.undo();
    assert.equal(JSON.stringify(binding.getEmbeddedDefinition("A")?.circuit), before);
  } finally {
    await binding.dispose();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
