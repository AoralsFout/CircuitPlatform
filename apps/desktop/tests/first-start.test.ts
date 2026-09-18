import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentKindName, EngineResponse, PortSpec, Signal } from "@circuit-platform/protocol";
import { useWorkspace } from "../src/composables/useWorkspace.ts";
import type { EngineAdapter, EngineHealth } from "../src/workspace/index.ts";
import { serializeProjectFile, type ProjectSerializationInput } from "../src/project-file/index.ts";
import { readRecentProjects, type KeyValueStorage } from "../src/project-file/recent-projects.ts";
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
 * 首启空状态测试的最小假引擎：与打开/保存流程测试同一风格。`health` 可变，
 * 供「引擎不可用时启动 → 恢复后入口可用」的用例切换引擎状态。
 */
class FirstStartEngine implements EngineAdapter {
  readonly calls: Call[] = [];
  nextComponentId = 1;
  nextConnectionId = 1;
  /** 健康检查的应答；恢复用例改写它来模拟引擎被修好。 */
  health: EngineHealth = { status: "ok", engine: "fake-engine" };
  /** 打开对话框的应答队列；空队列时按取消处理。 */
  readonly openDialogResults: ({ ok: true; path: string } | { ok: false; reason: string })[] = [];
  /** 可读取的项目文件；读取不存在的路径按「文件不存在」失败。 */
  readonly files = new Map<string, string>();

  async checkEngine() {
    this.calls.push({ type: "checkEngine" });
    return { ...this.health };
  }

  async addComponent(kind: ComponentKindName, ports?: readonly PortSpec[]): Promise<EngineResponse> {
    this.calls.push({ type: "addComponent", kind });
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
    const result = this.openDialogResults.shift();
    return result ?? { ok: false, reason: "canceled" };
  }

  async readProjectFile(filePath: string): Promise<{ ok: true; content: string } | { ok: false; reason: string; code?: string }> {
    const content = this.files.get(filePath);
    if (content === undefined) {
      return { ok: false, reason: "项目文件不存在。", code: "PROJECT_FILE_NOT_FOUND" };
    }
    return { ok: true, content };
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
function stubWindow(engine: FirstStartEngine, storage: KeyValueStorage): () => void {
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

/** 一份输入 → 输出的项目文件文本，供无会话打开用例使用。 */
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
        },
      ],
    },
    inputValues: {},
  };
  return JSON.stringify(serializeProjectFile(input));
}

test("startup enters the empty state: no session, no circuit, no engine pushes", async () => {
  const engine = new FirstStartEngine();
  const storage = memoryStorage();
  const restore = stubWindow(engine, storage);
  try {
    const binding = useWorkspace();
    await binding.bootstrap();

    assert.equal(binding.state.value.engineState, "ready");
    assert.equal(binding.canSave.value, false, "启动不再自动创建示例：没有编辑器会话");
    assert.equal(binding.state.value.hasCircuit, false);
    assert.equal(binding.canSave.value, false);
    // 引擎只收到健康检查：没有任何元件或连线被推送。
    assert.deepEqual(engine.calls.map((call) => call.type), ["checkEngine"]);
    // 示例是未保存文档的另一个侧面：启动不产生最近项目记录。
    assert.equal(binding.recentProjects.value.length, 0);
  } finally {
    restore();
  }
});

test("loading the example pushes it as an ordinary document and leaves it unsaved", async () => {
  const engine = new FirstStartEngine();
  const storage = memoryStorage();
  const restore = stubWindow(engine, storage);
  try {
    const binding = useWorkspace();
    await binding.bootstrap();
    await binding.requestLoadExample();

    // 走与打开项目相同的整体替换推送路径：先全部元件、再全部连线、最后提交输入并求值，
    // 没有任何专用路径的调用。
    assert.deepEqual(engine.calls.map((call) => call.type), [
      "checkEngine",
      "addComponent", "addComponent", "addComponent", "addComponent",
      "addConnection", "addConnection", "addConnection",
      "setInput", "setInput", "settle", "getSignal", "getSignal",
    ]);
    assert.deepEqual(
      engine.calls.filter((call) => call.type === "addComponent").map((call) => (call as { kind: ComponentKindName }).kind),
      ["input", "input", "and", "output"],
    );

    // 加载后是一份未保存文档：会话建立、有电路，但没有文件身份、不置脏、不写最近项目。
    assert.equal(binding.editorState.value?.document.components.length, 4);
    assert.equal(binding.state.value.hasCircuit, true);
    assert.equal(binding.projectPath.value, null);
    assert.equal(binding.projectName.value, null);
    assert.equal(binding.isDirty.value, false, "脏基线是示例文档本身");
    assert.equal(binding.saveState.value, "saved");
    assert.equal(binding.openError.value, null);
    assert.equal(readRecentProjects(storage).length, 0, "示例不记录最近项目");
  } finally {
    restore();
  }
});

test("an unavailable engine still starts into the empty state with displayable info and working entries once it recovers", async () => {
  const engine = new FirstStartEngine();
  engine.health = { status: "unavailable", message: "仿真引擎进程已退出。" };
  const storage = memoryStorage();
  engine.files.set("E:\\circuits\\demo.circuit.json", simpleProjectFileText());
  const restore = stubWindow(engine, storage);
  try {
    const binding = useWorkspace();
    await binding.bootstrap();

    // 不可用也要能进入空状态：没有会话，但状态与原因可展示，而不是静默白屏。
    assert.equal(binding.state.value.engineState, "unavailable");
    assert.equal(binding.state.value.message, "仿真引擎进程已退出。");
    assert.equal(binding.canSave.value, false, "没有编辑器会话");

    // 引擎恢复前入口给出可展示原因，不产生半成品。
    await binding.requestLoadExample();
    assert.equal(binding.openError.value, "仿真引擎不可用，无法加载示例。");
    assert.equal(binding.canSave.value, false, "没有编辑器会话");

    await binding.requestOpenRecent("E:\\circuits\\demo.circuit.json");
    assert.equal(binding.openError.value, "仿真引擎不可用，无法打开项目。");
    assert.equal(binding.canSave.value, false, "没有编辑器会话");
    assert.equal(binding.projectPath.value, null);

    // 引擎恢复后（手动检查，与顶栏 ↻ 同一路径），空状态的入口照常工作。
    engine.health = { status: "ok", engine: "fake-engine" };
    await binding.checkEngine();
    assert.equal(binding.state.value.engineState, "ready");

    await binding.requestLoadExample();
    assert.equal(binding.openError.value, null);
    assert.equal(binding.editorState.value?.document.components.length, 4);

    // 加载示例后再开项目走整体替换：最近项目入口同样可用。
    await binding.requestOpenRecent("E:\\circuits\\demo.circuit.json");
    assert.equal(binding.openError.value, null);
    assert.equal(binding.editorState.value?.document.components.length, 2);
    assert.equal(binding.projectPath.value, "E:\\circuits\\demo.circuit.json");
    assert.deepEqual(binding.recentProjects.value.map((item) => item.path), ["E:\\circuits\\demo.circuit.json"]);
  } finally {
    restore();
  }
});

test("without a session, new and open establish the session themselves", async () => {
  const engine = new FirstStartEngine();
  const storage = memoryStorage();
  engine.files.set("E:\\circuits\\demo.circuit.json", simpleProjectFileText());
  const restore = stubWindow(engine, storage);
  try {
    const binding = useWorkspace();
    await binding.bootstrap();

    // 无会话新建：确认以「有文档」为前提，这里直接进入空文档会话。
    await binding.requestNew();
    assert.equal(binding.pendingFileAction.value, null);
    assert.equal(binding.editorState.value?.document.components.length, 0);
    assert.equal(binding.state.value.hasCircuit, false);
    assert.equal(binding.projectPath.value, null);

    // 无会话打开：从空文档整体替换为文件内容，文档身份切换。
    engine.openDialogResults.push({ ok: true, path: "E:\\circuits\\demo.circuit.json" });
    await binding.requestOpen();
    assert.equal(binding.openError.value, null);
    assert.equal(binding.editorState.value?.document.components.length, 2);
    assert.equal(binding.projectPath.value, "E:\\circuits\\demo.circuit.json");
    assert.equal(readRecentProjects(storage).length, 1);
  } finally {
    restore();
  }
});

test("loading the example onto a dirty document confirms first, and confirming replaces it wholesale", async () => {
  const engine = new FirstStartEngine();
  const storage = memoryStorage();
  const restore = stubWindow(engine, storage);
  try {
    const binding = useWorkspace();
    await binding.bootstrap();
    await binding.requestLoadExample();
    await binding.setInputBit("input-a", 0, "0");
    assert.equal(binding.isDirty.value, true);
    assert.equal(binding.state.value.inputValues["input-a"], "0");

    // 置脏文档加载示例先挂起待确认：与打开/新建同一条确认交互。
    await binding.requestLoadExample();
    assert.equal(binding.pendingFileAction.value, "load-example");
    assert.equal(binding.state.value.inputValues["input-a"], "0", "确认之前什么都不发生");

    // 取消：文档原样保留。
    binding.cancelPendingFileAction();
    assert.equal(binding.pendingFileAction.value, null);
    assert.equal(binding.isDirty.value, true);
    assert.equal(binding.editorState.value?.document.components.length, 4);

    // 确认：示例按普通文档整体替换——结构重新推送、时间线归零，脏基线重置为替换后的
    // 示例，身份仍为无路径。输入值走推送路径的既有规则（沿用工作区当前值，与引擎重建一致）。
    await binding.requestLoadExample();
    await binding.confirmPendingFileAction();
    assert.equal(binding.pendingFileAction.value, null);
    assert.equal(binding.editorState.value?.document.components.length, 4);
    assert.equal(binding.state.value.simulationStep, 0);
    assert.equal(binding.isDirty.value, false);
    assert.equal(binding.projectPath.value, null);
    assert.equal(readRecentProjects(storage).length, 0);
  } finally {
    restore();
  }
});
