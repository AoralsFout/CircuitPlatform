import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentKindName, EngineResponse, Signal } from "@circuit-platform/protocol";
import { createComponentDefinitionRegistry, projectCanvasScene } from "../src/canvas/index.ts";
import {
  createAndDemoDocument,
  createEditorSession,
  type EditorBindings,
  type EditorDocument,
  type EditorSnapshot,
} from "../src/editor/index.ts";
import { createProtocolEnginePort } from "../src/editor/protocolEnginePort.ts";
import { createSimulationSnapshot } from "../src/editor/simulation.ts";
import { useWorkspace } from "../src/composables/useWorkspace.ts";
import { createWorkspace, type EngineAdapter, type SimulationBindings } from "../src/workspace/index.ts";

type Call =
  | { type: "checkEngine" }
  | { type: "addComponent"; kind: ComponentKindName }
  | { type: "addConnection"; sourceComponentId: number; sourcePort: string; targetComponentId: number; targetPort: string }
  | { type: "removeComponent"; componentId: number }
  | { type: "removeConnection"; connectionId: number }
  | { type: "setInput"; componentId: number; value: Signal }
  | { type: "settle" }
  | { type: "getSignal"; componentId: number; port: string };

/**
 * 按连接求值的测试引擎：`getSignal` 沿 Connection 回溯到驱动端再计算。
 * 这样多个 Output 元件会得到各自不同的值，而不是共享同一个读数。
 */
class FakeEngine implements EngineAdapter {
  readonly calls: Call[] = [];
  nextComponentId = 1;
  nextConnectionId = 1;
  errorOn: Call["type"] | null = null;
  private readonly kinds = new Map<number, ComponentKindName>();
  private readonly inputs = new Map<number, Signal>();
  private readonly connections: { source: { componentId: number; port: string }; target: { componentId: number; port: string } }[] = [];

  async checkEngine() {
    this.calls.push({ type: "checkEngine" });
    return { status: "ok" as const, engine: "fake-engine" };
  }

  async addComponent(kind: ComponentKindName): Promise<EngineResponse> {
    this.calls.push({ type: "addComponent", kind });
    if (this.errorOn === "addComponent") return this.error("创建元件失败");
    const componentId = this.nextComponentId++;
    this.kinds.set(componentId, kind);
    return { type: "component_added", requestId: "fake", componentId };
  }

  async addConnection(source: { componentId: number; port: string }, target: { componentId: number; port: string }): Promise<EngineResponse> {
    this.calls.push({ type: "addConnection", sourceComponentId: source.componentId, sourcePort: source.port, targetComponentId: target.componentId, targetPort: target.port });
    if (this.errorOn === "addConnection") return this.error("连接失败");
    this.connections.push({ source, target });
    return { type: "connection_added", requestId: "fake", connectionId: this.nextConnectionId++ };
  }

  async removeComponent(componentId: number): Promise<EngineResponse> {
    this.calls.push({ type: "removeComponent", componentId });
    if (this.errorOn === "removeComponent") return this.error("删除元件失败");
    return { type: "component_removed", requestId: "fake", componentId };
  }

  async removeConnection(connectionId: number): Promise<EngineResponse> {
    this.calls.push({ type: "removeConnection", connectionId });
    if (this.errorOn === "removeConnection") return this.error("删除连接失败");
    return { type: "connection_removed", requestId: "fake", connectionId };
  }

  async setInput(componentId: number, value: Signal): Promise<EngineResponse> {
    this.calls.push({ type: "setInput", componentId, value });
    if (this.errorOn === "setInput") return this.error("输入设置失败");
    this.inputs.set(componentId, value);
    return { type: "input_set", requestId: "fake" };
  }

  async settle(): Promise<EngineResponse> {
    this.calls.push({ type: "settle" });
    if (this.errorOn === "settle") return this.error("稳定求值失败");
    return { type: "settled", requestId: "fake", status: "ok" };
  }

  async getSignal(componentId: number, port: string): Promise<EngineResponse> {
    this.calls.push({ type: "getSignal", componentId, port });
    if (this.errorOn === "getSignal") return this.error("读取输出失败");
    return { type: "signal_result", requestId: "fake", value: this.evaluate(componentId, port, 0) };
  }

  private evaluate(componentId: number, port: string, depth: number): Signal {
    if (depth > 16) return "X";
    const kind = this.kinds.get(componentId);
    if (kind === undefined) return "X";
    if (kind === "input") return this.inputs.get(componentId) ?? 0;
    if (kind === "output") return this.resolveInto(componentId, port, depth);
    if (kind === "not") return invert(this.resolveInto(componentId, "in", depth));
    if (kind === "and") {
      const values = ["in1", "in2"].map((name) => this.resolveInto(componentId, name, depth));
      if (values.some((value) => value === "X")) return "X";
      return values.every((value) => value === 1) ? 1 : 0;
    }
    return "X";
  }

  private resolveInto(componentId: number, port: string, depth: number): Signal {
    const connection = this.connections.find(
      (candidate) => candidate.target.componentId === componentId && candidate.target.port === port,
    );
    if (!connection) return "X";
    return this.evaluate(connection.source.componentId, connection.source.port, depth + 1);
  }

  private error(message: string): EngineResponse {
    return { type: "error", requestId: "fake", code: "FAKE_ERROR", message };
  }
}

function invert(value: Signal): Signal {
  if (value === "X") return "X";
  return value === 1 ? 0 : 1;
}

/** 与 `useWorkspace` 相同的桥接：工作区绑定是可选的，编辑器绑定要求 connections 存在。 */
function bindingsFrom(loaded: SimulationBindings): EditorBindings {
  return {
    components: loaded.components,
    connections: loaded.connections ?? {},
    componentKinds: loaded.componentKinds,
  };
}

function editorSnapshotOf(document: EditorDocument): EditorSnapshot {
  return {
    document,
    selection: null,
    operation: "idle",
    canUndo: false,
    canRedo: false,
    confirmation: null,
    error: null,
  };
}

test("creates and runs the example circuit through the generic document path", async () => {
  const engine = new FakeEngine();
  const workspace = createWorkspace(engine);

  await workspace.checkEngine();
  const loaded = await workspace.loadCircuit(createAndDemoDocument());
  const state = loaded.snapshot;

  assert.equal(state.engineState, "ready");
  assert.equal(state.hasCircuit, true);
  assert.deepEqual(loaded.bindings, {
    components: { "input-a": 1, "input-b": 2, "and-gate": 3, output: 4 },
    connections: { "wire-a": 1, "wire-b": 2, "wire-output": 3 },
    componentKinds: { "input-a": "input", "input-b": "input", "and-gate": "and", output: "output" },
  });
  assert.equal(state.outputValue, 1);
  assert.equal(state.waveform.length, 1);
  assert.deepEqual(state.waveform[0], { step: 1, a: 1, b: 1, output: 1 });
  assert.deepEqual(engine.calls.map((call) => call.type), [
    "checkEngine",
    "addComponent",
    "addComponent",
    "addComponent",
    "addComponent",
    "addConnection",
    "addConnection",
    "addConnection",
    "setInput",
    "setInput",
    "settle",
    "getSignal",
    "getSignal",
  ]);
});

test("turns an engine error response into visible workspace error state", async () => {
  const engine = new FakeEngine();
  engine.errorOn = "addConnection";
  const workspace = createWorkspace(engine);
  await workspace.checkEngine();

  const state = (await workspace.loadCircuit(createAndDemoDocument())).snapshot;

  assert.equal(state.hasCircuit, false);
  assert.equal(state.outputValue, "X");
  assert.equal(state.message, "连接失败");
  assert.equal(state.operationError, "连接失败");
  assert.equal(state.canRun, false);
  assert.deepEqual(
    engine.calls.slice(-4),
    [
      { type: "removeComponent", componentId: 4 },
      { type: "removeComponent", componentId: 3 },
      { type: "removeComponent", componentId: 2 },
      { type: "removeComponent", componentId: 1 },
    ],
  );
});

test("toggles an input, runs the circuit, and appends a waveform point", async () => {
  const engine = new FakeEngine();
  const workspace = createWorkspace(engine);
  await workspace.checkEngine();
  await workspace.loadCircuit(createAndDemoDocument());

  const state = await workspace.toggleInput("input-a");

  assert.equal(state.inputA, 0);
  assert.equal(state.inputB, 1);
  assert.equal(state.outputValue, 0);
  assert.deepEqual(state.waveform, [
    { step: 1, a: 1, b: 1, output: 1 },
    { step: 2, a: 0, b: 1, output: 0 },
  ]);
});

test("projects the settled AND result onto the gate output wire", async () => {
  const engine = new FakeEngine();
  const workspace = createWorkspace(engine);
  await workspace.checkEngine();
  await workspace.loadCircuit(createAndDemoDocument());

  const state = await workspace.toggleInput("input-b");
  const registry = createComponentDefinitionRegistry();
  const editorSnapshot = editorSnapshotOf(createAndDemoDocument());
  const simulation = createSimulationSnapshot(editorSnapshot, registry, {
    inputA: state.inputA,
    inputB: state.inputB,
    inputValues: state.inputValues,
    signals: state.signals,
  });
  const scene = projectCanvasScene(editorSnapshot, simulation, registry);

  assert.equal(state.outputValue, 0);
  const andGate = scene.nodes.find((node) => node.id === "and-gate");
  assert.equal(andGate?.ports.find((port) => port.id === "in1")?.signal, 1);
  assert.equal(andGate?.ports.find((port) => port.id === "in2")?.signal, 0);
  assert.equal(andGate?.ports.find((port) => port.id === "out")?.signal, 0);
  assert.equal(scene.wires.find((wire) => wire.id === "wire-output")?.signal, 0);
});

test("pushes a document that is not the AND example", async () => {
  const engine = new FakeEngine();
  const workspace = createWorkspace(engine);
  await workspace.checkEngine();

  // 没有 AND 门、只有一个 Input：旧实现会因为不匹配示例形状而整体不可运行。
  const document: EditorDocument = {
    components: [
      { id: "input", kind: "input", displayName: "输入", position: { x: 0, y: 0 }, lifecycle: "active" },
      { id: "inverter", kind: "not", displayName: "NOT 门", position: { x: 200, y: 0 }, lifecycle: "active" },
      { id: "result", kind: "output", displayName: "结果", position: { x: 400, y: 0 }, lifecycle: "active" },
    ],
    connections: [
      { id: "wire-in", source: { componentId: "input", port: "out", point: { x: 100, y: 50 } }, target: { componentId: "inverter", port: "in", point: { x: 200, y: 50 } }, lifecycle: "visible", danglingEndpoints: [] },
      { id: "wire-out", source: { componentId: "inverter", port: "out", point: { x: 300, y: 50 } }, target: { componentId: "result", port: "in", point: { x: 400, y: 50 } }, lifecycle: "visible", danglingEndpoints: [] },
    ],
  };

  const state = (await workspace.loadCircuit(document)).snapshot;

  assert.equal(state.hasCircuit, true);
  assert.equal(state.canRun, true);
  assert.equal(state.inputValues["input"], 1);
  assert.equal(state.signals["result:in"], 0);
  assert.equal(state.outputValue, 0);
});

test("reads every Output component's own signal instead of reusing the first one", async () => {
  const engine = new FakeEngine();
  const workspace = createWorkspace(engine);
  await workspace.checkEngine();

  // 一个 Input 同时驱动一个反相器和一个直连输出，两个 Output 的稳定值必然不同。
  const document: EditorDocument = {
    components: [
      { id: "input", kind: "input", displayName: "输入", position: { x: 0, y: 0 }, lifecycle: "active" },
      { id: "inverter", kind: "not", displayName: "NOT 门", position: { x: 200, y: 0 }, lifecycle: "active" },
      { id: "inverted", kind: "output", displayName: "反相输出", position: { x: 400, y: 0 }, lifecycle: "active" },
      { id: "direct", kind: "output", displayName: "直连输出", position: { x: 400, y: 200 }, lifecycle: "active" },
    ],
    connections: [
      { id: "wire-in", source: { componentId: "input", port: "out", point: { x: 100, y: 50 } }, target: { componentId: "inverter", port: "in", point: { x: 200, y: 50 } }, lifecycle: "visible", danglingEndpoints: [] },
      { id: "wire-inverted", source: { componentId: "inverter", port: "out", point: { x: 300, y: 50 } }, target: { componentId: "inverted", port: "in", point: { x: 400, y: 50 } }, lifecycle: "visible", danglingEndpoints: [] },
      { id: "wire-direct", source: { componentId: "input", port: "out", point: { x: 100, y: 50 } }, target: { componentId: "direct", port: "in", point: { x: 400, y: 250 } }, lifecycle: "visible", danglingEndpoints: [] },
    ],
  };

  const state = (await workspace.loadCircuit(document)).snapshot;

  assert.equal(state.signals["inverted:in"], 0);
  assert.equal(state.signals["direct:in"], 1);
  // 两个 Output 都被单独读取，而不是共用一个读数。
  assert.deepEqual(
    engine.calls.filter((call) => call.type === "getSignal"),
    [
      { type: "getSignal", componentId: 3, port: "in" },
      { type: "getSignal", componentId: 4, port: "in" },
      { type: "getSignal", componentId: 2, port: "out" },
    ],
  );

  const registry = createComponentDefinitionRegistry();
  const simulation = createSimulationSnapshot(editorSnapshotOf(document), registry, {
    inputA: state.inputA,
    inputB: state.inputB,
    inputValues: state.inputValues,
    signals: state.signals,
  });
  const scene = projectCanvasScene(editorSnapshotOf(document), simulation, registry);
  const signalAt = (id: string): Signal | undefined =>
    scene.nodes.find((node) => node.id === id)?.ports.find((port) => port.direction === "input")?.signal;

  assert.equal(signalAt("inverted"), 0);
  assert.equal(signalAt("direct"), 1);
});

test("refreshes the AND output signal immediately after creating its output wire", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const engine = new FakeEngine();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { circuitPlatform: engine },
  });

  try {
    const binding = useWorkspace();
    await binding.bootstrap();
    assert.equal(await binding.addComponent("output", { x: 1040, y: 240 }), true);
    const newOutput = binding.editorState.value?.document.components.find((component) => component.kind === "output" && component.id !== "output");
    assert.ok(newOutput);

    const created = await binding.createConnection(
      { componentId: "and-gate", port: "out", direction: "output", point: { x: 588, y: 262 } },
      { componentId: newOutput.id, port: "in", direction: "input", point: { x: 1040, y: 282 } },
    );
    assert.equal(created.ok, true, created.error);

    const editorSnapshot = binding.editorState.value as EditorSnapshot;
    const state = binding.state.value;
    const registry = createComponentDefinitionRegistry();
    const simulation = createSimulationSnapshot(editorSnapshot, registry, {
      inputA: state.inputA,
      inputB: state.inputB,
      inputValues: state.inputValues,
      signals: state.signals,
    });
    const scene = projectCanvasScene(editorSnapshot, simulation, registry);
    const outputWire = scene.wires.find((wire) => wire.source.componentId === "and-gate" && wire.target.componentId === newOutput.id);

    assert.equal(outputWire?.signal, 1);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("deletes a connection loaded with the example through the workspace binding", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const engine = new FakeEngine();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { circuitPlatform: engine },
  });

  try {
    const binding = useWorkspace();
    await binding.bootstrap();
    engine.calls.length = 0;

    await binding.deleteConnection("wire-a");

    assert.equal(binding.editorState.value?.error, null);
    assert.equal(
      binding.editorState.value?.document.connections.some((connection) => connection.id === "wire-a"),
      false,
    );
    assert.deepEqual(engine.calls[0], { type: "removeConnection", connectionId: 1 });
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("clears an example loaded through the workspace binding", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const engine = new FakeEngine();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { circuitPlatform: engine },
  });

  try {
    const binding = useWorkspace();
    await binding.bootstrap();
    engine.calls.length = 0;

    await binding.requestClear();
    await binding.confirmClear();

    assert.equal(binding.editorState.value?.error, null);
    assert.equal(binding.editorState.value?.document.components.length, 0);
    assert.equal(binding.editorState.value?.document.connections.length, 0);
    assert.deepEqual(
      engine.calls.filter((call) => call.type === "removeConnection"),
      [
        { type: "removeConnection", connectionId: 1 },
        { type: "removeConnection", connectionId: 2 },
        { type: "removeConnection", connectionId: 3 },
      ],
    );
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("keeps the committed input when the next simulation is rejected", async () => {
  const engine = new FakeEngine();
  const workspace = createWorkspace(engine);
  await workspace.checkEngine();
  await workspace.loadCircuit(createAndDemoDocument());
  engine.errorOn = "setInput";

  const state = await workspace.toggleInput("input-a");

  assert.equal(state.inputA, 1);
  assert.equal(state.outputValue, 1);
  assert.equal(state.operationError, "输入设置失败");
  assert.equal(state.engineState, "ready");
  assert.equal(state.canRun, true);
});

test("recognizes every input component in generic editor bindings", async () => {
  const engine = new FakeEngine();
  const workspace = createWorkspace(engine);
  await workspace.checkEngine();

  workspace.rebindSimulation({
    components: { "input-a": 1, "input-b": 2, "input-c": 3, "and-gate": 4, output: 5 },
    componentKinds: { "input-a": "input", "input-b": "input", "input-c": "input", "and-gate": "and", output: "output" },
  });

  assert.equal(workspace.snapshot().canRun, true);
  assert.equal(workspace.snapshot().inputValues["input-c"], 0);
  const state = await workspace.toggleInput("input-c");

  assert.equal(state.inputValues["input-c"], 1);
  assert.deepEqual(engine.calls.filter((call) => call.type === "setInput").slice(-3), [
    { type: "setInput", componentId: 1, value: 1 },
    { type: "setInput", componentId: 2, value: 1 },
    { type: "setInput", componentId: 3, value: 1 },
  ]);
});

test("rebinds simulation to the new engine ID after undo", async () => {
  const engine = new FakeEngine();
  engine.nextComponentId = 41;
  engine.nextConnectionId = 71;
  const workspace = createWorkspace(engine);
  await workspace.checkEngine();
  const loaded = await workspace.loadCircuit(createAndDemoDocument());
  assert.ok(loaded.bindings);

  const session = createEditorSession(
    { document: createAndDemoDocument(), bindings: bindingsFrom(loaded.bindings) },
    createProtocolEnginePort(engine),
    {
      onBindingsChanged(bindings) {
        workspace.rebindSimulation(bindings);
      },
    },
  );

  await session.dispatch({ type: "delete-component", componentId: "input-a" });
  await session.dispatch({ type: "undo" });
  assert.equal(workspace.snapshot().canRun, true);

  engine.calls.length = 0;
  await workspace.runSimulation();
  assert.deepEqual(engine.calls[0], { type: "setInput", componentId: 45, value: 1 });
  assert.equal(JSON.stringify(session.snapshot()).includes("41"), false);
});

test("disables simulation after clear and rebinds it after one undo", async () => {
  const engine = new FakeEngine();
  const workspace = createWorkspace(engine);
  await workspace.checkEngine();
  const loaded = await workspace.loadCircuit(createAndDemoDocument());
  assert.ok(loaded.bindings);
  const session = createEditorSession(
    { document: createAndDemoDocument(), bindings: bindingsFrom(loaded.bindings) },
    createProtocolEnginePort(engine),
    {
      onBindingsChanged(bindings) {
        workspace.rebindSimulation(bindings);
      },
    },
  );

  await session.dispatch({ type: "request-clear" });
  await session.dispatch({ type: "confirm-clear" });
  assert.equal(workspace.snapshot().canRun, false);

  await session.dispatch({ type: "undo" });
  assert.equal(workspace.snapshot().canRun, true);
});
