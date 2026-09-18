import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentKindName, EngineResponse, PortSpec, Signal } from "@circuit-platform/protocol";
import { useWorkspace } from "../src/composables/useWorkspace.ts";
import type { EngineAdapter } from "../src/workspace/index.ts";
import { parseProjectFile } from "../src/project-file/index.ts";
import { readRecentProjects, RECENT_PROJECTS_STORAGE_KEY, type KeyValueStorage } from "../src/project-file/recent-projects.ts";
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
 * 保存流程测试的最小假引擎：只为示例文档的推送与输入提交提供可观察语义，
 * 不实现完整求值——保存与脏标记关心的是内容变化，不是信号值。
 * `pickSavePath` / `writeProjectFile` 与真实 preload 一样长在同一个 `window.circuitPlatform` 上。
 */
class SaveFlowEngine implements EngineAdapter {
  readonly calls: Call[] = [];
  nextComponentId = 1;
  nextConnectionId = 1;
  errorOn: "addComponent" | "setInput" | null = null;
  /** 让下一次写文件失败的原因；null 表示写文件成功。 */
  writeFailure: string | null = null;
  readonly pickedDialogs: { defaultPath?: string }[] = [];
  readonly writtenFiles: { path: string; content: string }[] = [];
  /** 对话框的应答队列；空队列时按取消处理。 */
  readonly dialogResults: ({ ok: true; path: string } | { ok: false; reason: string })[] = [];

  async checkEngine() {
    this.calls.push({ type: "checkEngine" });
    return { status: "ok" as const, engine: "fake-engine" };
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
    if (this.errorOn === "setInput") return this.error("输入设置失败");
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

  async pickSavePath(options?: { defaultPath?: string }): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
    this.pickedDialogs.push(options ?? {});
    const result = this.dialogResults.shift();
    return result ?? { ok: false, reason: "canceled" };
  }

  async writeProjectFile(filePath: string, content: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (this.writeFailure !== null) return { ok: false, reason: this.writeFailure };
    this.writtenFiles.push({ path: filePath, content });
    return { ok: true };
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
function stubWindow(engine: SaveFlowEngine, storage: KeyValueStorage): () => void {
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

/** 启动后的示例电路是一份未保存文档：脏标记干净、没有任何路径。 */
async function bootstrappedBinding(engine: SaveFlowEngine, storage: KeyValueStorage) {
  const restore = stubWindow(engine, storage);
  try {
    const binding = useWorkspace();
    await binding.bootstrap();
    assert.equal(binding.isDirty.value, false);
    assert.equal(binding.projectPath.value, null);
    assert.equal(binding.saveState.value, "saved");
    return { binding, restore };
  } catch (error) {
    restore();
    throw error;
  }
}

test("saving a pathless document asks for a location, writes the file and clears the dirty marker", async () => {
  const engine = new SaveFlowEngine();
  const storage = memoryStorage();
  const { binding, restore } = await bootstrappedBinding(engine, storage);
  try {
    // 拨输入是文档改动：输入值进文件，所以置脏。
    await binding.setInputBit("input-a", 0, "0");
    assert.equal(binding.isDirty.value, true);
    assert.equal(binding.saveState.value, "dirty");

    engine.dialogResults.push({ ok: true, path: "E:\\circuits\\demo.circuit.json" });
    assert.equal(await binding.save(), true);

    assert.equal(engine.pickedDialogs.length, 1, "无路径的「保存」必须走另存为对话框");
    assert.deepEqual(engine.pickedDialogs[0]?.defaultPath, "未命名电路.circuit.json");
    assert.equal(engine.writtenFiles.length, 1);
    assert.equal(engine.writtenFiles[0]?.path, "E:\\circuits\\demo.circuit.json");
    assert.equal(binding.isDirty.value, false);
    assert.equal(binding.saveState.value, "saved");
    assert.equal(binding.saveError.value, null);
    assert.equal(binding.projectPath.value, "E:\\circuits\\demo.circuit.json");
    assert.equal(binding.projectName.value, "demo.circuit.json");

    // 落盘内容与序列化模块的输出一致：结构、Input 当前值齐全，且能被同一份校验打开。
    const parsed = parseProjectFile(JSON.parse(engine.writtenFiles[0]?.content ?? "{}"));
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.value.version, 1);
      assert.equal(parsed.value.inputValues["input-a"], "0");
      assert.equal(parsed.value.inputValues["input-b"], "1");
      const inputA = parsed.value.document.components.find((component) => component.id === "input-a");
      assert.equal(inputA?.kind, "input");
    }

    // 保存成功后记录最近项目：规范化路径、文件名显示、最近在前。
    const recent = readRecentProjects(storage);
    assert.equal(recent.length, 1);
    assert.equal(recent[0]?.path, "E:\\circuits\\demo.circuit.json");
    assert.equal(recent[0]?.displayName, "demo.circuit.json");
  } finally {
    restore();
  }
});

test("saving a path-bearing document overwrites it without asking again", async () => {
  const engine = new SaveFlowEngine();
  const storage = memoryStorage();
  const { binding, restore } = await bootstrappedBinding(engine, storage);
  try {
    engine.dialogResults.push({ ok: true, path: "E:\\circuits\\demo.circuit.json" });
    await binding.save();
    assert.equal(engine.pickedDialogs.length, 1);

    await binding.moveComponent("and-gate", { x: 500, y: 300 });
    assert.equal(binding.isDirty.value, true);

    assert.equal(await binding.save(), true);
    assert.equal(engine.pickedDialogs.length, 1, "已有路径的「保存」直接覆写，不再询问");
    assert.equal(engine.writtenFiles.length, 2);
    assert.equal(engine.writtenFiles[1]?.path, "E:\\circuits\\demo.circuit.json");
    assert.equal(binding.isDirty.value, false);
  } finally {
    restore();
  }
});

test("save as always asks and switches the document identity to the new path", async () => {
  const engine = new SaveFlowEngine();
  const storage = memoryStorage();
  const { binding, restore } = await bootstrappedBinding(engine, storage);
  try {
    engine.dialogResults.push({ ok: true, path: "E:\\circuits\\first.circuit.json" });
    await binding.save();
    assert.equal(binding.projectPath.value, "E:\\circuits\\first.circuit.json");

    engine.dialogResults.push({ ok: true, path: "E:\\circuits\\second.circuit.json" });
    assert.equal(await binding.saveAs(), true);

    assert.equal(engine.pickedDialogs.length, 2, "另存为总是询问位置");
    // 另存为的对话框默认位置是当前身份所在的路径。
    assert.deepEqual(engine.pickedDialogs[1]?.defaultPath, "E:\\circuits\\first.circuit.json");
    assert.equal(engine.writtenFiles[1]?.path, "E:\\circuits\\second.circuit.json");
    assert.equal(binding.projectPath.value, "E:\\circuits\\second.circuit.json");
    assert.equal(binding.projectName.value, "second.circuit.json");
    assert.equal(binding.isDirty.value, false);

    // 最近项目去重后两条并存，最新一次在头部。
    const recent = readRecentProjects(storage);
    assert.deepEqual(recent.map((item) => item.displayName), ["second.circuit.json", "first.circuit.json"]);
  } finally {
    restore();
  }
});

test("a failed write surfaces a displayable reason and keeps the dirty editor state", async () => {
  const engine = new SaveFlowEngine();
  const storage = memoryStorage();
  const { binding, restore } = await bootstrappedBinding(engine, storage);
  try {
    await binding.setInputBit("input-a", 0, "0");
    assert.equal(binding.isDirty.value, true);
    const componentsBefore = binding.editorState.value?.document.components.length ?? -1;

    engine.writeFailure = "磁盘已满";
    engine.dialogResults.push({ ok: true, path: "E:\\circuits\\demo.circuit.json" });
    assert.equal(await binding.save(), false);

    assert.equal(binding.saveError.value, "磁盘已满");
    assert.equal(binding.saveState.value, "error");
    assert.equal(binding.isDirty.value, true, "保存失败不改变脏标记：改动仍未落盘");
    assert.equal(binding.editorState.value?.document.components.length, componentsBefore, "编辑器状态原样保留");
    assert.equal(binding.projectPath.value, null);
    assert.equal(engine.writtenFiles.length, 0);
    assert.equal(readRecentProjects(storage).length, 0, "保存失败不记录最近项目");

    // 修好之后重试成功，错误提示清除。
    engine.writeFailure = null;
    engine.dialogResults.push({ ok: true, path: "E:\\circuits\\demo.circuit.json" });
    assert.equal(await binding.save(), true);
    assert.equal(binding.saveError.value, null);
  } finally {
    restore();
  }
});

test("a canceled dialog is not an error and keeps the document untouched", async () => {
  const engine = new SaveFlowEngine();
  const storage = memoryStorage();
  const { binding, restore } = await bootstrappedBinding(engine, storage);
  try {
    await binding.setInputBit("input-a", 0, "0");
    assert.equal(await binding.save(), false);
    assert.equal(engine.pickedDialogs.length, 1, "对话框默认按取消处理");
    assert.equal(binding.saveError.value, null);
    assert.equal(binding.isDirty.value, true);
    assert.equal(binding.projectPath.value, null);
  } finally {
    restore();
  }
});

test("engine-rejected submissions do not mark the document dirty", async () => {
  const engine = new SaveFlowEngine();
  const storage = memoryStorage();
  const { binding, restore } = await bootstrappedBinding(engine, storage);
  try {
    // 被拒绝的输入提交：inputValues 不变，不置脏。
    engine.errorOn = "setInput";
    await binding.setInputBit("input-a", 0, "0");
    assert.equal(binding.isDirty.value, false);
    assert.notEqual(binding.state.value.operationError, null);

    // 被拒绝的结构提交：文档不变，不置脏。
    engine.errorOn = "addComponent";
    const componentsBefore = binding.editorState.value?.document.components.length ?? -1;
    await binding.addComponent("output", { x: 1040, y: 240 });
    assert.equal(binding.isDirty.value, false);
    assert.equal(binding.editorState.value?.document.components.length, componentsBefore);
  } finally {
    restore();
  }
});

test("a successful save after edits records the project in recent storage once per identity", async () => {
  const engine = new SaveFlowEngine();
  const storage = memoryStorage();
  const { binding, restore } = await bootstrappedBinding(engine, storage);
  try {
    engine.dialogResults.push({ ok: true, path: "e:\\circuits\\Demo.circuit.json" });
    await binding.save();

    await binding.moveComponent("and-gate", { x: 480, y: 260 });
    // 同一份文件的不同写法是同一条最近项目记录。
    engine.dialogResults.push({ ok: true, path: "E:/CIRCUITS/demo.circuit.json" });
    await binding.saveAs();

    const raw = storage.data.get(RECENT_PROJECTS_STORAGE_KEY);
    assert.ok(raw);
    const recent = readRecentProjects(storage);
    assert.equal(recent.length, 1);
    assert.equal(recent[0]?.lastUsedAt >= 0, true);
    assert.equal(raw, JSON.stringify(recent));
  } finally {
    restore();
  }
});
