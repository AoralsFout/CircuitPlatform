import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentKindName, EngineResponse, PortSpec, Signal } from "@circuit-platform/protocol";
import { useWorkspace } from "../src/composables/useWorkspace.ts";
import type { EngineAdapter } from "../src/workspace/index.ts";
import { serializeProjectFile, type ProjectFileData, type ProjectSerializationInput } from "../src/project-file/index.ts";
import { RECENT_PROJECTS_STORAGE_KEY, readRecentProjects, type KeyValueStorage } from "../src/project-file/recent-projects.ts";
import { portsForAddComponent } from "./fake-ports.ts";

type Call =
  | { type: "checkEngine" }
  | { type: "addComponent"; kind: ComponentKindName }
  | { type: "addConnection"; sourceComponentId: number; targetComponentId: number }
  | { type: "setInput"; componentId: number; value: Signal }
  | { type: "settle" }
  | { type: "getSignal"; componentId: number; port: string }
  | { type: "tick" }
  | { type: "reset" }
  | { type: "removeComponent"; componentId: number }
  | { type: "removeConnection"; connectionId: number };

/**
 * 打开/新建流程测试的最小假引擎：与保存流程测试同一风格——`pickOpenPath` / `readProjectFile`
 * 与真实 preload 一样长在同一个 `window.circuitPlatform` 上，文件内容放在内存里。
 */
class OpenFlowEngine implements EngineAdapter {
  readonly calls: Call[] = [];
  nextComponentId = 1;
  nextConnectionId = 1;
  processEpoch = 1;
  errorOn: "addComponent" | null = null;
  /** 打开对话框的应答队列；空队列时按取消处理。 */
  readonly openDialogResults: ({ ok: true; path: string } | { ok: false; reason: string })[] = [];
  readonly saveDialogResults: ({ ok: true; path: string } | { ok: false; reason: string })[] = [];
  readonly pickedOpenDialogs: number[] = [];
  /** 可读取的项目文件；读取不存在的路径按「文件不存在」失败。 */
  readonly files = new Map<string, string>();
  readonly readPaths: string[] = [];

  async checkEngine() {
    this.calls.push({ type: "checkEngine" });
    return { status: "ok" as const, engine: "fake-engine", processEpoch: this.processEpoch };
  }

  async addComponent(kind: ComponentKindName, ports?: readonly PortSpec[]): Promise<EngineResponse> {
    this.calls.push({ type: "addComponent", kind });
    if (this.errorOn === "addComponent") return this.error("创建元件失败");
    const componentId = this.nextComponentId++;
    return { type: "component_added", requestId: "fake", componentId, ports: portsForAddComponent(kind, ports) };
  }

  async setPortWidth(componentId: number, ports: readonly PortSpec[]): Promise<EngineResponse> {
    return { type: "port_width_set", requestId: "fake", componentId, ports, danglingConnectionIds: [] };
  }

  async addConnection(source: { componentId: number; port: string }, target: { componentId: number; port: string }): Promise<EngineResponse> {
    this.calls.push({ type: "addConnection", sourceComponentId: source.componentId, targetComponentId: target.componentId });
    return { type: "connection_added", requestId: "fake", connectionId: this.nextConnectionId++ };
  }

  async removeComponent(componentId: number): Promise<EngineResponse> {
    this.calls.push({ type: "removeComponent", componentId });
    return { type: "component_removed", requestId: "fake", componentId };
  }

  async removeConnection(connectionId: number): Promise<EngineResponse> {
    this.calls.push({ type: "removeConnection", connectionId });
    return { type: "connection_removed", requestId: "fake", connectionId };
  }

  async setInput(componentId: number, value: Signal): Promise<EngineResponse> {
    this.calls.push({ type: "setInput", componentId, value });
    return { type: "input_set", requestId: "fake" };
  }

  async settle(): Promise<EngineResponse> {
    this.calls.push({ type: "settle" });
    return { type: "settled", requestId: "fake", status: "ok" };
  }

  async tick(): Promise<EngineResponse> {
    this.calls.push({ type: "tick" });
    return { type: "ticked", requestId: "fake", step: 1, signals: [] };
  }

  async reset(): Promise<EngineResponse> {
    this.calls.push({ type: "reset" });
    return { type: "reset_done", requestId: "fake", status: "ok" };
  }

  async getSignal(componentId: number, port: string): Promise<EngineResponse> {
    this.calls.push({ type: "getSignal", componentId, port });
    return { type: "signal_result", requestId: "fake", value: "0" };
  }

  async pickOpenPath(): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
    this.pickedOpenDialogs.push(this.pickedOpenDialogs.length + 1);
    const result = this.openDialogResults.shift();
    return result ?? { ok: false, reason: "canceled" };
  }

  async pickSavePath(): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
    const result = this.saveDialogResults.shift();
    return result ?? { ok: false, reason: "canceled" };
  }

  async writeProjectFile(filePath: string, content: string): Promise<{ ok: true }> {
    this.files.set(filePath, content);
    return { ok: true };
  }

  async readProjectFile(filePath: string): Promise<{ ok: true; content: string } | { ok: false; reason: string; code?: string }> {
    this.readPaths.push(filePath);
    const content = this.files.get(filePath);
    if (content === undefined) {
      // 与 electron/project-file-io.cjs 同一约定：文件不存在带回机器可读 code。
      return { ok: false, reason: "项目文件不存在。", code: "PROJECT_FILE_NOT_FOUND" };
    }
    return { ok: true, content };
  }

  private error(message: string): EngineResponse {
    return { type: "error", requestId: "fake", code: "FAKE_ERROR", message };
  }
}

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

/** 与既有用例相同的窗口缝：`window.circuitPlatform` 同时承载引擎与项目文件桥接。 */
function stubWindow(engine: OpenFlowEngine, storage: KeyValueStorage): () => void {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { circuitPlatform: engine, localStorage: storage },
  });
  return () => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  };
}

/** 启动后的示例电路已就绪：引擎在线、编辑器有 4 个示例元件。#40 起示例由启动后的空状态显式加载。 */
async function bootstrappedBinding(engine: OpenFlowEngine, storage: KeyValueStorage) {
  const restore = stubWindow(engine, storage);
  try {
    const binding = useWorkspace();
    await binding.bootstrap();
    await binding.requestLoadExample();
    assert.equal(binding.state.value.engineState, "ready");
    assert.equal(binding.editorState.value?.document.components.length, 4);
    return { binding, restore };
  } catch (error) {
    restore();
    throw error;
  }
}

/** 把示例加载后的未保存文档落盘一次，得到干净的脏基线；供「干净文档」前提的用例使用。 */
async function makeClean(engine: OpenFlowEngine, binding: ReturnType<typeof useWorkspace>): Promise<void> {
  engine.saveDialogResults.push({ ok: true, path: "E:\\circuits\\scratch.circuit.json" });
  assert.equal(await binding.saveAs(), true);
  assert.equal(binding.isDirty.value, false);
}

/** 一份输入 → 输出（带 Waypoint 与输入值）的项目文件文本，供成功打开用例使用。 */
function simpleProjectFileText(): string {
  const input: ProjectSerializationInput = {
    document: {
      components: [
        { id: "in-x", kind: "input", displayName: "输入 X", position: { x: 110, y: 100 }, lifecycle: "active", ports: [{ name: "out", direction: "output", width: 1 }] },
        { id: "out-y", kind: "output", displayName: "输出 Y", position: { x: 800, y: 240 }, lifecycle: "active", ports: [{ name: "in", direction: "input", width: 1 }] },
      ],
      connections: [
        {
          id: "wire-1",
          source: { componentId: "in-x", port: "out", point: { x: 0, y: 0 } },
          target: { componentId: "out-y", port: "in", point: { x: 0, y: 0 } },
          lifecycle: "visible",
          danglingEndpoints: [],
          waypoints: [{ x: 400, y: 200 }],
        },
      ],
    },
    inputValues: { "in-x": "1" },
  };
  return JSON.stringify(serializeProjectFile(input));
}

function childProjectFile(logic: "not" | "and" = "not"): ProjectFileData {
  return {
    version: 2,
    circuit: {
      components: [
        { id: "in-a", kind: "input", displayName: "a", position: { x: 0, y: 0 }, ports: [{ name: "out", direction: "output", width: 1 }] },
        { id: "logic", kind: logic, displayName: logic.toUpperCase(), position: { x: 120, y: 0 } },
        { id: "out-y", kind: "output", displayName: "y", position: { x: 240, y: 0 }, ports: [{ name: "in", direction: "input", width: 1 }] },
      ],
      connections: [
        { id: "child-in", source: { component: "in-a", port: "out" }, target: { component: "logic", port: logic === "not" ? "in" : "a" } },
        { id: "child-out", source: { component: "logic", port: "out" }, target: { component: "out-y", port: "in" } },
      ],
    },
    definitions: {},
    libraryRoots: [],
  };
}

function parentProjectFile(logic: "not" | "and" = "not"): ProjectFileData {
  const child = childProjectFile(logic);
  return {
    version: 2,
    circuit: {
      components: [
        { id: "source", kind: "input", displayName: "Source", position: { x: 0, y: 80 }, ports: [{ name: "out", direction: "output", width: 1 }] },
        { id: "unit", kind: "subcircuit", displayName: "child.circuit.json", position: { x: 240, y: 80 }, data: {
          definitionId: "embedded-child",
          cachedPorts: [{ name: "a", direction: "input", width: 1 }, { name: "y", direction: "output", width: 1 }],
        } },
        { id: "sink", kind: "output", displayName: "Sink", position: { x: 480, y: 80 }, ports: [{ name: "in", direction: "input", width: 1 }] },
      ],
      connections: [
        { id: "parent-in", source: { component: "source", port: "out" }, target: { component: "unit", port: "a" } },
        { id: "parent-out", source: { component: "unit", port: "y" }, target: { component: "sink", port: "in" } },
      ],
    },
    definitions: { "embedded-child": { displayName: "child.circuit.json", circuit: child.circuit } },
    libraryRoots: ["embedded-child"],
  };
}

test("opening a valid project file restores structure, values, geometry, identity and the recent entry", async () => {
  const engine = new OpenFlowEngine();
  const storage = memoryStorage();
  const { binding, restore } = await bootstrappedBinding(engine, storage);
    await makeClean(engine, binding);
  try {
    engine.files.set("E:\\circuits\\demo.circuit.json", simpleProjectFileText());
    engine.openDialogResults.push({ ok: true, path: "E:\\circuits\\demo.circuit.json" });
    await binding.requestOpen();

    // 文档结构与显示信息按文件恢复，示例电路被整体替换。
    const document = binding.editorState.value?.document;
    assert.equal(document?.components.length, 2);
    const input = document?.components.find((component) => component.id === "in-x");
    assert.equal(input?.displayName, "输入 X");
    assert.deepEqual(input?.position, { x: 110, y: 100 });
    // 输入值从文件恢复。
    assert.equal(binding.state.value.inputValues["in-x"], "1");
    // 文档身份切换，脏标记干净。
    assert.equal(binding.projectPath.value, "E:\\circuits\\demo.circuit.json");
    assert.equal(binding.projectName.value, "demo.circuit.json");
    assert.equal(binding.isDirty.value, false);
    assert.equal(binding.saveError.value, null);
    assert.equal(binding.openError.value, null);
    // 成功打开记录最近项目（列表里还有 makeClean 落盘时记下的 scratch，先过滤掉）。
    const recent = readRecentProjects(storage).filter((entry) => entry.displayName !== "scratch.circuit.json");
    assert.equal(recent.length, 1);
    assert.equal(recent[0]?.displayName, "demo.circuit.json");

    // 端点几何按元件位置与端口偏移重建，不再是占位零点：
    // 输入元件 148×84，唯一的输出端口贴右边、垂直居中 → 偏移 (148, 42)。
    const wire = document?.connections[0];
    assert.deepEqual(wire?.source.point, { x: 258, y: 142 });
    assert.deepEqual(wire?.target.point, { x: 800, y: 282 });
    // Route 的首尾是重建后的端点，途经 Waypoint 的横坐标（折点与端点共线时 Route 会
    // 塌缩共线点，语义 Waypoint 原样保留在连接上）。
    const route = wire?.route;
    assert.deepEqual(route?.at(0), { x: 258, y: 142 });
    assert.deepEqual(route?.at(-1), { x: 800, y: 282 });
    assert.equal(route?.some((point) => point.x === 400), true);
    assert.deepEqual(wire?.waypoints, [{ x: 400, y: 200 }]);

    // 打开后的编辑以新文档为脏基线。
    await binding.moveComponent("in-x", { x: 140, y: 100 });
    assert.equal(binding.isDirty.value, true);
  } finally {
    restore();
  }
});

test("opening an embedded hierarchy reads only the parent file and flattens its saved definition", async () => {
  const engine = new OpenFlowEngine();
  const restore = stubWindow(engine, memoryStorage());
  try {
    const parentPath = "E:\\circuits\\parent.circuit.json";
    engine.files.set(parentPath, JSON.stringify(parentProjectFile()));
    const binding = useWorkspace();
    await binding.bootstrap();

    assert.equal(await binding.openProjectFromPath(parentPath), true, binding.openError.value ?? "");
    assert.deepEqual(engine.readPaths, [parentPath]);
    const unit = binding.editorState.value?.document.components.find((component) => component.id === "unit");
    assert.equal(unit?.kind, "subcircuit");
    assert.equal(unit?.data?.subcircuit?.status, "resolved");
    assert.deepEqual(unit?.ports?.map((port) => [port.name, port.direction]), [["a", "input"], ["y", "output"]]);
    assert.deepEqual(
      engine.calls.filter((call): call is Extract<Call, { type: "addComponent" }> => call.type === "addComponent").map((call) => call.kind),
      ["input", "not", "output"],
    );
  } finally {
    restore();
  }
});

test("an unsaved parent imports a saved v2 child, saves the embedded snapshot, and reopens after source relocation", async () => {
  const engine = new OpenFlowEngine();
  const restore = stubWindow(engine, memoryStorage());
  try {
    const childPath = "E:\\circuits\\child.circuit.json";
    const parentPath = "F:\\portable\\parent.circuit.json";
    engine.files.set(childPath, JSON.stringify(childProjectFile()));
    const binding = useWorkspace();
    await binding.bootstrap();
    await binding.requestNew();
    assert.equal(binding.projectPath.value, null);

    engine.openDialogResults.push({ ok: true, path: childPath });
    assert.equal(await binding.addSubcircuitFromDialog({ x: 320, y: 160 }), true, binding.openError.value ?? "");
    assert.equal(binding.projectPath.value, null);
    const placed = binding.editorState.value?.document.components[0];
    assert.equal(placed?.kind, "subcircuit");
    assert.deepEqual(placed?.position, { x: 320, y: 160 });
    assert.equal(placed?.data?.subcircuit?.status, "resolved");
    assert.equal(binding.editorState.value?.canUndo, true);

    engine.saveDialogResults.push({ ok: true, path: parentPath });
    assert.equal(await binding.saveAs(), true, binding.saveError.value ?? "");
    const saved = JSON.parse(engine.files.get(parentPath)!) as ProjectFileData;
    assert.equal(saved.version, 2);
    assert.equal(saved.circuit.components.length, 1);
    assert.equal(Object.keys(saved.definitions).length, 1);
    assert.equal(saved.libraryRoots.length, 1);
    assert.equal(saved.circuit.components[0]?.kind, "subcircuit");
    assert.deepEqual(saved.circuit.components[0]?.data, {
      definitionId: saved.libraryRoots[0],
      cachedPorts: [{ name: "a", direction: "input", width: 1 }, { name: "y", direction: "output", width: 1 }],
    });
    assert.equal(JSON.stringify(saved).includes(childPath), false);
    assert.equal(JSON.stringify(saved).includes("reference"), false);
    assert.deepEqual(saved.definitions[saved.libraryRoots[0]!]!.circuit.components.map((component) => component.kind), ["input", "not", "output"]);

    engine.files.set("G:\\moved\\child.circuit.json", engine.files.get(childPath)!);
    engine.files.delete(childPath);
    const readsBeforeReopen = engine.readPaths.length;
    const addsBeforeReopen = engine.calls.filter((call) => call.type === "addComponent").length;
    const reopened = useWorkspace();
    await reopened.bootstrap();
    assert.equal(await reopened.openProjectFromPath(parentPath), true, reopened.openError.value ?? "");
    assert.deepEqual(engine.readPaths.slice(readsBeforeReopen), [parentPath]);
    assert.equal(reopened.editorState.value?.document.components[0]?.data?.subcircuit?.status, "resolved");
    assert.deepEqual(
      engine.calls.filter((call): call is Extract<Call, { type: "addComponent" }> => call.type === "addComponent").slice(addsBeforeReopen).map((call) => call.kind),
      ["not"],
    );
  } finally {
    restore();
  }
});

test("cross-drive Save As and engine recovery keep using the embedded definition", async () => {
  const engine = new OpenFlowEngine();
  const restore = stubWindow(engine, memoryStorage());
  try {
    const parentPath = "E:\\circuits\\parent.circuit.json";
    const movedPath = "G:\\handoff\\parent.circuit.json";
    engine.files.set(parentPath, JSON.stringify(parentProjectFile()));
    const binding = useWorkspace();
    await binding.bootstrap();
    assert.equal(await binding.openProjectFromPath(parentPath), true);
    engine.saveDialogResults.push({ ok: true, path: movedPath });
    assert.equal(await binding.saveAs(), true);
    assert.deepEqual((JSON.parse(engine.files.get(movedPath)!) as ProjectFileData).definitions, parentProjectFile().definitions);
    const readsBeforeRecovery = engine.readPaths.length;
    const addsBeforeRecovery = engine.calls.filter((call) => call.type === "addComponent").length;

    engine.processEpoch = 2;
    await binding.checkEngine();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (engine.calls.filter((call) => call.type === "addComponent").length >= addsBeforeRecovery + 3) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    assert.equal(engine.readPaths.length, readsBeforeRecovery);
    assert.deepEqual(
      engine.calls.filter((call): call is Extract<Call, { type: "addComponent" }> => call.type === "addComponent").slice(addsBeforeRecovery).map((call) => call.kind),
      ["input", "not", "output"],
    );
    assert.equal(binding.editorState.value?.document.components.find((component) => component.id === "unit")?.data?.subcircuit?.status, "resolved");
  } finally {
    restore();
  }
});

test("opening stops at the first failed step with a displayable reason and keeps the editor state", async () => {
  const engine = new OpenFlowEngine();
  const storage = memoryStorage();
  const { binding, restore } = await bootstrappedBinding(engine, storage);
  try {
    // 文件不存在：读取失败即终止，当前文档原样保留。
    engine.openDialogResults.push({ ok: true, path: "E:\\circuits\\missing.circuit.json" });
    // 示例加载后文档置脏（规格语义）：打开先经过置脏确认，确认后对话框照常执行。
    await binding.requestOpen();
    assert.notEqual(binding.pendingFileAction.value, null, "置脏文档打开前必须先确认");
    await binding.confirmPendingFileAction();
    assert.equal(binding.openError.value, "项目文件不存在。");
    assert.equal(binding.editorState.value?.document.components.length, 4);
    assert.equal(readRecentProjects(storage).some((entry) => entry.displayName === "demo.circuit.json"), false, "失败不写最近项目");

    // 版本过高：整体拒绝。失败的打开不改变文档，文档保持置脏，后续打开同样先确认。
    engine.openDialogResults.push({ ok: true, path: "E:\\circuits\\future.circuit.json" });
    engine.files.set("E:\\circuits\\future.circuit.json", JSON.stringify({ version: 99, circuit: { components: [], connections: [] } }));
    await binding.requestOpen();
    assert.notEqual(binding.pendingFileAction.value, null);
    await binding.confirmPendingFileAction();
    assert.match(binding.openError.value ?? "", /不支持.*version 99/);
    assert.equal(binding.editorState.value?.document.components.length, 4);
    assert.equal(readRecentProjects(storage).some((entry) => entry.displayName === "demo.circuit.json"), false);

    // 引擎推送失败：给出原因，旧电路仍然可用。
    engine.errorOn = "addComponent";
    engine.openDialogResults.push({ ok: true, path: "E:\\circuits\\demo.circuit.json" });
    engine.files.set("E:\\circuits\\demo.circuit.json", simpleProjectFileText());
    await binding.requestOpen();
    assert.notEqual(binding.pendingFileAction.value, null);
    await binding.confirmPendingFileAction();
    engine.errorOn = null;
    assert.equal(binding.openError.value, "创建元件失败");
    assert.equal(binding.editorState.value?.document.components.length, 4, "推送失败不产生半成品快照");
    assert.equal(binding.projectPath.value, null);
    assert.equal(readRecentProjects(storage).some((entry) => entry.displayName === "demo.circuit.json"), false);
    // 旧绑定仍然可用：按编辑器 ID 提交输入成功。
    await binding.setInputBit("input-a", 0, "0");
    assert.equal(binding.state.value.simulationStep, 1);
  } finally {
    restore();
  }
});

test("opening onto a dirty document asks for confirmation first and Esc keeps everything", async () => {
  const engine = new OpenFlowEngine();
  const storage = memoryStorage();
  const { binding, restore } = await bootstrappedBinding(engine, storage);
  try {
    await binding.setInputBit("input-a", 0, "0");
    assert.equal(binding.isDirty.value, true);

    await binding.requestOpen();
    assert.equal(binding.pendingFileAction.value, "open", "置脏文档的打开先挂起待确认");
    assert.equal(engine.pickedOpenDialogs.length, 0, "确认之前不弹文件对话框");

    // 取消（Esc 走同一条路径）：什么都不发生。
    binding.cancelPendingFileAction();
    assert.equal(binding.pendingFileAction.value, null);
    assert.equal(binding.editorState.value?.document.components.length, 4);
    assert.equal(binding.isDirty.value, true);

    // 确认后继续执行打开。
    engine.files.set("E:\\circuits\\demo.circuit.json", simpleProjectFileText());
    engine.openDialogResults.push({ ok: true, path: "E:\\circuits\\demo.circuit.json" });
    await binding.requestOpen();
    assert.equal(binding.pendingFileAction.value, "open");
    await binding.confirmPendingFileAction();
    assert.equal(binding.editorState.value?.document.components.length, 2);
    assert.equal(binding.pendingFileAction.value, null);
  } finally {
    restore();
  }
});

test("new builds an empty document through the replace push and resets the dirty baseline", async () => {
  const engine = new OpenFlowEngine();
  const storage = memoryStorage();
  const { binding, restore } = await bootstrappedBinding(engine, storage);
  try {
    await binding.setInputBit("input-a", 0, "0");
    assert.equal(binding.isDirty.value, true);

    // 置脏的新建先确认。
    await binding.requestNew();
    assert.equal(binding.pendingFileAction.value, "new");
    await binding.confirmPendingFileAction();

    // 空文档：没有元件、没有电路、没有输入值，撤销历史随新会话重置。
    const document = binding.editorState.value?.document;
    assert.equal(document?.components.length, 0);
    assert.equal(document?.connections.length, 0);
    assert.equal(binding.state.value.hasCircuit, false);
    assert.deepEqual(binding.state.value.inputValues, {});
    assert.equal(binding.editorState.value?.canUndo, false);
    assert.equal(binding.state.value.simulationStep, 0);
    assert.equal(binding.state.value.waveform.length, 0);
    // 脏基线是空文档本身：新建后不置脏，身份清空。
    assert.equal(binding.isDirty.value, false);
    assert.equal(binding.projectPath.value, null);
    assert.equal(binding.pendingFileAction.value, null);
    assert.equal(readRecentProjects(storage).some((entry) => entry.displayName === "scratch.circuit.json" || entry.displayName === "demo.circuit.json"), false, "新建不记录最近项目");

    // 旧电路的结构已从引擎移除：连接先于元件，反向顺序。
    const removals = engine.calls.filter((call) => call.type === "removeConnection" || call.type === "removeComponent");
    assert.deepEqual(removals.map((call) => call.type), [
      "removeConnection", "removeConnection", "removeConnection",
      "removeComponent", "removeComponent", "removeComponent", "removeComponent",
    ]);

    // 新建之后再改动：基线从空文档算起。
    assert.equal(await binding.addComponent("and", { x: 300, y: 200 }), true);
    assert.equal(binding.isDirty.value, true);
  } finally {
    restore();
  }
});

test("new on a clean document runs without confirmation", async () => {
  const engine = new OpenFlowEngine();
  const storage = memoryStorage();
  const { binding, restore } = await bootstrappedBinding(engine, storage);
    await makeClean(engine, binding);
  try {
    await binding.requestNew();
    assert.equal(binding.pendingFileAction.value, null, "干净文档不需要确认");
    assert.equal(binding.editorState.value?.document.components.length, 0);
  } finally {
    restore();
  }
});

/** 预置两条最近项目：gone 指向已删除的文件，demo 仍然存在。 */
function seedRecentProjects(storage: ReturnType<typeof memoryStorage>): void {
  storage.setItem(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify([
    { path: "E:\\circuits\\gone.circuit.json", displayName: "gone.circuit.json", lastUsedAt: 20 },
    { path: "E:\\circuits\\demo.circuit.json", displayName: "demo.circuit.json", lastUsedAt: 10 },
  ]));
}

test("opening a dead recent entry explains why, prunes it and keeps the editor state", async () => {
  const engine = new OpenFlowEngine();
  const storage = memoryStorage();
  seedRecentProjects(storage);
  const { binding, restore } = await bootstrappedBinding(engine, storage);
  try {
    engine.files.set("E:\\circuits\\demo.circuit.json", simpleProjectFileText());

    // 示例加载后文档置脏（规格语义）：从最近项目打开同样先经过置脏确认。
    await binding.requestOpenRecent("E:\\circuits\\gone.circuit.json");
    assert.notEqual(binding.pendingFileAction.value, null, "置脏文档打开前必须先确认");
    await binding.confirmPendingFileAction();

    // 失败给出可展示原因，当前编辑器状态原样保留。
    assert.equal(binding.openError.value, "项目文件不存在。");
    assert.equal(binding.editorState.value?.document.components.length, 4);
    assert.equal(binding.projectPath.value, null);
    // 死条目已从界面列表与存储中移除，剩余条目保持最近在前的顺序。
    assert.deepEqual(binding.recentProjects.value.map((item) => item.path), ["E:\\circuits\\demo.circuit.json"]);
    assert.deepEqual(readRecentProjects(storage).map((item) => item.path), ["E:\\circuits\\demo.circuit.json"]);

    // 剩余条目从同一入口打开成功：与对话框打开走同一条加载路径。
    // 失败的打开不改变文档，文档保持置脏，这次打开同样先确认。
    await binding.requestOpenRecent("E:\\circuits\\demo.circuit.json");
    assert.notEqual(binding.pendingFileAction.value, null);
    await binding.confirmPendingFileAction();
    assert.equal(binding.openError.value, null);
    assert.equal(binding.editorState.value?.document.components.length, 2);
    assert.equal(binding.projectPath.value, "E:\\circuits\\demo.circuit.json");
    // 成功打开刷新该条目的最近使用时间，位置保持在列表顶部。
    assert.deepEqual(binding.recentProjects.value.map((item) => item.path), ["E:\\circuits\\demo.circuit.json"]);
  } finally {
    restore();
  }
});

test("a failed open leaves the recent list exactly as it was", async () => {
  const engine = new OpenFlowEngine();
  const storage = memoryStorage();
  seedRecentProjects(storage);
  const { binding, restore } = await bootstrappedBinding(engine, storage);
  try {
    // demo 可读，future 版本过高被整体拒绝：两者都不许改动列表。
    engine.files.set("E:\\circuits\\demo.circuit.json", simpleProjectFileText());
    engine.files.set("E:\\circuits\\future.circuit.json", JSON.stringify({ version: 99, circuit: { components: [], connections: [] } }));

    // 示例加载后文档置脏（规格语义）：打开先经过置脏确认。
    await binding.requestOpenRecent("E:\\circuits\\future.circuit.json");
    assert.notEqual(binding.pendingFileAction.value, null, "置脏文档打开前必须先确认");
    await binding.confirmPendingFileAction();
    assert.match(binding.openError.value ?? "", /不支持.*version 99/);
    assert.deepEqual(binding.recentProjects.value.map((item) => item.path), [
      "E:\\circuits\\gone.circuit.json", "E:\\circuits\\demo.circuit.json",
    ]);
    assert.deepEqual(readRecentProjects(storage).map((item) => item.path), [
      "E:\\circuits\\gone.circuit.json", "E:\\circuits\\demo.circuit.json",
    ]);
    // 编辑器状态原样保留。
    assert.equal(binding.editorState.value?.document.components.length, 4);
  } finally {
    restore();
  }
});

test("opening from the recent list confirms unsaved changes first and opens the chosen path", async () => {
  const engine = new OpenFlowEngine();
  const storage = memoryStorage();
  const { binding, restore } = await bootstrappedBinding(engine, storage);
  try {
    engine.files.set("E:\\circuits\\demo.circuit.json", simpleProjectFileText());
    await binding.setInputBit("input-a", 0, "0");
    assert.equal(binding.isDirty.value, true);

    await binding.requestOpenRecent("E:\\circuits\\gone.circuit.json");
    assert.equal(binding.pendingFileAction.value, "open", "置脏文档的最近项目打开先挂起待确认");
    assert.equal(binding.editorState.value?.document.components.length, 4, "确认之前不加载");

    // 取消后换一个条目：挂起的路径不能泄漏到下一次请求。
    binding.cancelPendingFileAction();
    await binding.requestOpenRecent("E:\\circuits\\demo.circuit.json");
    assert.equal(binding.pendingFileAction.value, "open");
    await binding.confirmPendingFileAction();

    assert.equal(binding.editorState.value?.document.components.length, 2);
    assert.equal(binding.projectPath.value, "E:\\circuits\\demo.circuit.json");
    assert.equal(binding.pendingFileAction.value, null);
    // 打开成功把该条目置顶并刷新时间戳。
    assert.deepEqual(binding.recentProjects.value.map((item) => item.path), ["E:\\circuits\\demo.circuit.json"]);
  } finally {
    restore();
  }
});
