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
import { createEngineCallQueue } from "../src/workspace/engineQueue.ts";
import {
  createWorkspace,
  type EngineAdapter,
  type SimulationBindings,
} from "../src/workspace/index.ts";
import { drain, FakeScheduler } from "./fake-scheduler.ts";

type Call =
  | { type: "checkEngine" }
  | { type: "addComponent"; kind: ComponentKindName }
  | { type: "addConnection"; sourceComponentId: number; sourcePort: string; targetComponentId: number; targetPort: string }
  | { type: "removeComponent"; componentId: number }
  | { type: "removeConnection"; connectionId: number }
  | { type: "setInput"; componentId: number; value: Signal }
  | { type: "settle" }
  | { type: "tick" }
  | { type: "reset" }
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
  /** 让 tick 悬停，用于验证下一次推进必须等上一次响应。 */
  holdTick: (() => Promise<void>) | null = null;
  step = 0;
  /** Clock 的输出初值为 0，每推进一次翻转一次。 */
  private readonly clocks = new Map<number, Signal>();
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

  async tick(): Promise<EngineResponse> {
    this.calls.push({ type: "tick" });
    if (this.holdTick) await this.holdTick();
    if (this.errorOn === "tick") return this.error("推进一步失败");
    this.step += 1;
    for (const [componentId, kind] of this.kinds) {
      if (kind === "clock") this.clocks.set(componentId, this.clocks.get(componentId) === 1 ? 0 : 1);
    }
    // 快照覆盖每一个输出端口，外加每个 Output 元件的接收端，因此工作区不必再逐端口 get_signal。
    const signals = [...this.kinds].flatMap(([componentId, kind]) => {
      const entries: { componentId: number; port: string; value: Signal }[] = [];
      const outputPort = fakeOutputPorts[kind];
      if (outputPort !== undefined) {
        entries.push({ componentId, port: outputPort, value: this.evaluate(componentId, outputPort, 0) });
      }
      if (kind === "output") {
        entries.push({ componentId, port: "in", value: this.evaluate(componentId, "in", 0) });
      }
      return entries;
    });
    return { type: "ticked", requestId: "fake", step: this.step, signals };
  }

  async reset(): Promise<EngineResponse> {
    this.calls.push({ type: "reset" });
    if (this.errorOn === "reset") return this.error("重置失败");
    // 只要「按连接求值」这个最小可观察语义：步数归零、Clock 回到 0、Input 回到初值。
    // 真正的重置语义（q 回到 X、前值快照清空）由 C++ 测试负责，不在这里重新实现。
    this.step = 0;
    this.clocks.clear();
    this.inputs.clear();
    return { type: "reset_done", requestId: "fake", status: "ok" };
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
    if (kind === "clock") return this.clocks.get(componentId) ?? 0;
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

/** FakeEngine 认识的、带可观察输出端口的元件类型；真正的时序语义仍由 C++ 测试负责。 */
const fakeOutputPorts: Readonly<Partial<Record<ComponentKindName, string>>> = {
  input: "out",
  clock: "out",
  not: "out",
  and: "out",
  d_flip_flop: "q",
};

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
  // 加载后的首次稳定求值不是一次推进：步数停在 0，波形历史也还是空的。
  assert.equal(state.simulationStep, 0);
  assert.deepEqual(state.waveform, []);
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
  assert.equal(state.canStep, false);
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
  // 切换输入是用户发起的一次推进：它是波形历史里的第一个点，也是第 1 步。
  assert.deepEqual(state.waveform, [{ step: 1, a: 0, b: 1, output: 0 }]);
  assert.equal(state.simulationStep, 1);
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
  assert.equal(state.canStep, true);
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

/** Clock 驱动一个 Output 的最小文档；它没有 Input，因此只由推进改变。 */
function clockDocument(): EditorDocument {
  return {
    components: [
      { id: "clock", kind: "clock", displayName: "Clock", position: { x: 0, y: 0 }, lifecycle: "active" },
      { id: "monitor", kind: "output", displayName: "输出", position: { x: 400, y: 0 }, lifecycle: "active" },
    ],
    connections: [
      { id: "wire", source: { componentId: "clock", port: "out", point: { x: 100, y: 50 } }, target: { componentId: "monitor", port: "in", point: { x: 400, y: 50 } }, lifecycle: "visible", danglingEndpoints: [] },
    ],
  };
}

test("advances the clock one tick per single step with a single round trip", async () => {
  const engine = new FakeEngine();
  const workspace = createWorkspace(engine);
  await workspace.checkEngine();
  const document = clockDocument();
  const loaded = await workspace.loadCircuit(document);
  const registry = createComponentDefinitionRegistry();

  // Clock 的输出初值是 0 而不是 X，否则永远判不出第一次上升沿。
  assert.equal(loaded.snapshot.signals["clock:out"], 0);

  engine.calls.length = 0;
  const first = await workspace.step();

  // 一次推进只有一次跨进程往返：不再逐端口 get_signal。
  assert.deepEqual(engine.calls.map((call) => call.type), ["tick"]);
  assert.equal(first.signals["clock:out"], 1);

  const scene = projectCanvasScene(
    editorSnapshotOf(document),
    createSimulationSnapshot(editorSnapshotOf(document), registry, {
      inputA: first.inputA,
      inputB: first.inputB,
      inputValues: first.inputValues,
      signals: first.signals,
    }),
    registry,
  );
  // 接收端的值由场景投影沿 Connection 推导，因此画布、检查器与输出面板读的是同一次推进。
  assert.equal(scene.nodes.find((node) => node.id === "monitor")?.ports.find((port) => port.id === "in")?.signal, 1);
  assert.equal(scene.wires.find((wire) => wire.id === "wire")?.signal, 1);

  const second = await workspace.step();
  assert.deepEqual(engine.calls.map((call) => call.type), ["tick", "tick"]);
  assert.equal(second.signals["clock:out"], 0);
  assert.equal(second.canStep, true);
});

test("records the advanced reading in the waveform instead of the previous settle", async () => {
  const engine = new FakeEngine();
  const workspace = createWorkspace(engine);
  await workspace.checkEngine();
  const loaded = await workspace.loadCircuit(clockDocument());

  // 加载时 Clock 的输出是 0，Output 的接收端也是 0；这次稳定求值不计步，也不进波形历史。
  assert.equal(loaded.snapshot.outputValue, 0);
  assert.deepEqual(loaded.snapshot.waveform, []);

  const advanced = await workspace.step();

  // Output 元件的接收端由同一次推进的快照带回，因此兼容标量与波形记录的都是这一拍的读数。
  assert.equal(advanced.outputValue, 1);
  assert.equal(advanced.signals["monitor:in"], 1);
  assert.equal(advanced.waveform.at(-1)?.output, 1);
});

test("starts, pauses, and resumes continuous running without losing accumulated steps", async () => {
  const engine = new FakeEngine();
  const scheduler = new FakeScheduler();
  const workspace = createWorkspace(engine, { scheduler });
  await workspace.checkEngine();
  const loaded = await workspace.loadCircuit(clockDocument());
  const waveformPoints = loaded.snapshot.waveform.length;
  // 加载时的稳定求值不计步，连续运行从第 0 步往上走。
  const baseStep = loaded.snapshot.simulationStep;
  assert.equal(baseStep, 0);
  engine.calls.length = 0;

  const started = await workspace.start();
  assert.equal(started.simulationState, "running");
  assert.equal(started.canPause, true);
  assert.equal(started.canStart, false);
  assert.equal(started.canStep, false);
  // 开始只是排定第一次推进，还没有请求在飞。
  assert.equal(engine.calls.length, 0);

  scheduler.fire();
  await drain();
  assert.deepEqual(engine.calls.map((call) => call.type), ["tick"]);
  assert.equal(workspace.snapshot().simulationStep, baseStep + 1);
  assert.equal(workspace.snapshot().signals["clock:out"], 1);

  scheduler.fire();
  await drain();
  assert.equal(workspace.snapshot().simulationStep, baseStep + 2);
  assert.equal(workspace.snapshot().signals["clock:out"], 0);

  const paused = await workspace.pause();
  assert.equal(paused.simulationState, "paused");
  assert.equal(paused.canResume, true);
  assert.equal(paused.canPause, false);
  assert.equal(paused.canStep, true);
  // 暂停取消了已经排定的下一次推进：暂停期间不再前进。
  assert.equal(scheduler.fire(), false);
  await drain();
  assert.equal(engine.calls.length, 2);
  assert.equal(workspace.snapshot().simulationStep, baseStep + 2);
  assert.equal(workspace.snapshot().message, `已暂停在第 ${baseStep + 2} 步。`);

  const resumed = await workspace.resume();
  assert.equal(resumed.simulationState, "running");
  scheduler.fire();
  await drain();
  // 继续从暂停处接着跑：步数与时钟相位都接上，不从头开始。
  assert.equal(workspace.snapshot().simulationStep, baseStep + 3);
  assert.equal(workspace.snapshot().signals["clock:out"], 1);

  // 自动推进不追加波形记录：波形历史只记录用户发起的推进。
  assert.equal(workspace.snapshot().waveform.length, waveformPoints);
});

test("schedules the next advance only after the previous response arrives", async () => {
  const engine = new FakeEngine();
  const scheduler = new FakeScheduler();
  const workspace = createWorkspace(engine, { scheduler });
  await workspace.checkEngine();
  await workspace.loadCircuit(clockDocument());

  let release: () => void = () => {};
  engine.holdTick = () => new Promise<void>((resolve) => { release = resolve; });
  engine.calls.length = 0;
  await workspace.start();
  assert.equal(scheduler.scheduled, 1);

  scheduler.fire();
  await drain();
  // 上一次响应还没回来，因此没有新的调度被排定：引擎变慢时不会积压请求。
  assert.equal(engine.calls.length, 1);
  assert.equal(scheduler.scheduled, 1);
  assert.equal(scheduler.fire(), false);

  release();
  await drain();
  assert.equal(scheduler.scheduled, 2);
});

test("queues an input commit behind an in-flight advance while running", async () => {
  const engine = new FakeEngine();
  const scheduler = new FakeScheduler();
  const workspace = createWorkspace(engine, { scheduler });
  await workspace.checkEngine();
  await workspace.loadCircuit(createAndDemoDocument());
  await workspace.start();

  let release: () => void = () => {};
  engine.holdTick = () => new Promise<void>((resolve) => { release = resolve; });
  engine.calls.length = 0;

  scheduler.fire();
  await drain();
  const toggling = workspace.toggleInput("input-a");
  await drain();
  // 推进还在飞，输入提交因此排在它之后，两条请求不交错。
  assert.deepEqual(engine.calls.map((call) => call.type), ["tick"]);

  release();
  await drain();
  await toggling;
  assert.deepEqual(engine.calls.map((call) => call.type), ["tick", "setInput"]);
  // 运行中切换只提交 set_input，不额外 settle；新值由下一次推进带上。
  assert.equal(workspace.snapshot().inputValues["input-a"], 0);
  assert.equal(workspace.snapshot().canToggleInput, true);
});

test("queues a structural commit behind an in-flight advance while running", async () => {
  const engine = new FakeEngine();
  const scheduler = new FakeScheduler();
  // 生产接线就是这样：一条队列同时交给工作区与编辑器端口。
  // 编辑器发出的结构提交不经过工作区，只有共享同一个队列对象才能与在飞的推进排在一队。
  const queue = createEngineCallQueue();
  const workspace = createWorkspace(engine, { scheduler, queue });
  await workspace.checkEngine();
  const document = clockDocument();
  const loaded = await workspace.loadCircuit(document);
  assert.ok(loaded.bindings);
  const session = createEditorSession(
    { document, bindings: bindingsFrom(loaded.bindings) },
    createProtocolEnginePort(engine, queue),
    {
      onBindingsChanged(bindings) {
        workspace.rebindSimulation(bindings);
      },
    },
  );

  await workspace.start();
  let release: () => void = () => {};
  engine.holdTick = () => new Promise<void>((resolve) => { release = resolve; });
  engine.calls.length = 0;

  scheduler.fire();
  await drain();
  const deleting = session.dispatch({ type: "delete-component", componentId: "monitor" });
  await drain();

  // 推进还在飞，结构提交因此排在它之后：队列外面那条直连 adapter 的路径已经没有了。
  assert.deepEqual(engine.calls.map((call) => call.type), ["tick"]);

  release();
  await drain();
  await deleting;

  const types = engine.calls.map((call) => call.type);
  assert.equal(types[0], "tick", "那一拍先完成");
  assert.equal(types[1], "removeComponent", "结构提交紧随其后，不与之交错");
  // 结构提交完成后照常收尾：工作区按身份保留读数，并把连续运行切到暂停。
  assert.equal(workspace.snapshot().simulationState, "paused");
  assert.equal(workspace.snapshot().signals["clock:out"], 1);
});

test("pauses continuous running when the circuit structure changes", async () => {
  const engine = new FakeEngine();
  const scheduler = new FakeScheduler();
  const workspace = createWorkspace(engine, { scheduler });
  await workspace.checkEngine();
  await workspace.loadCircuit(clockDocument());
  await workspace.start();
  assert.equal(workspace.snapshot().simulationState, "running");

  const rebound = workspace.rebindSimulation({
    components: { clock: 1, monitor: 2 },
    componentKinds: { clock: "clock", monitor: "output" },
  });

  // 结构修改把运行切到暂停，并要求用户显式继续；已排定的推进被取消。
  assert.equal(rebound.simulationState, "paused");
  assert.equal(scheduler.cancelled, 1);
  assert.equal(scheduler.fire(), false);
  assert.equal(rebound.canResume, true);
});

test("keeps the accumulated readings when the circuit structure changes", async () => {
  const engine = new FakeEngine();
  const scheduler = new FakeScheduler();
  const workspace = createWorkspace(engine, { scheduler });
  await workspace.checkEngine();
  await workspace.loadCircuit(clockDocument());
  await workspace.start();
  scheduler.fire();
  await drain();
  assert.equal(workspace.snapshot().signals["clock:out"], 1);

  // 删掉一个与 Clock 无关的元件：拓扑变了，但 Clock 与那条 Wire 都还在。
  const rebound = workspace.rebindSimulation({
    components: { clock: 1 },
    connections: { wire: 1 },
    componentKinds: { clock: "clock" },
  });

  assert.equal(rebound.simulationState, "paused");
  assert.equal(rebound.canResume, true);
  // 旧实现把 signals 整体清空、outputValue 置 X，这两条会分别读到 undefined 与 "X"。
  assert.equal(rebound.signals["clock:out"], 1);
  assert.equal(rebound.outputValue, 1);
  // 消失的元件连同它的读数一起被丢弃，不留下已经无从展示的键。
  assert.equal(rebound.signals["monitor:in"], undefined);
});

test("distinguishes a real topology change from a geometry-only update", async () => {
  const engine = new FakeEngine();
  const scheduler = new FakeScheduler();
  const workspace = createWorkspace(engine, { scheduler });
  await workspace.checkEngine();
  const loaded = await workspace.loadCircuit(clockDocument());
  assert.ok(loaded.bindings);
  await workspace.start();
  scheduler.fire();
  await drain();

  // 只移动元件或改 Route 的编辑不会分配新的引擎身份，publishBindings 也不会为它们触发。
  // 即使收到一份内容相同的绑定，拓扑没变就不该停掉运行，也不该动到已积累的读数。
  const unchanged = workspace.rebindSimulation({ ...loaded.bindings });
  assert.equal(unchanged.simulationState, "running");
  assert.equal(scheduler.cancelled, 0);
  assert.equal(unchanged.signals["clock:out"], 1);

  // 连接不参与运行时身份，却是实打实的拓扑：把它从绑定里去掉必须停下来。
  const rebound = workspace.rebindSimulation({
    components: { clock: 1, monitor: 2 },
    componentKinds: { clock: "clock", monitor: "output" },
  });
  assert.equal(rebound.simulationState, "paused");
  assert.equal(scheduler.cancelled, 1);
});

test("notifies subscribers about each advance the run loop makes on its own", async () => {
  const engine = new FakeEngine();
  const scheduler = new FakeScheduler();
  const workspace = createWorkspace(engine, { scheduler });
  await workspace.checkEngine();
  await workspace.loadCircuit(clockDocument());

  const observed: number[] = [];
  const unsubscribe = workspace.subscribe((snapshot) => observed.push(snapshot.simulationStep));
  await workspace.start();
  scheduler.fire();
  await drain();
  scheduler.fire();
  await drain();
  unsubscribe();
  await workspace.pause();

  // 自行排定的每一拍都通知一次；取消订阅后不再收到。加载不计步，因此从第 1 步开始。
  assert.deepEqual(observed, [1, 2]);
});

test("pauses continuous running when an advance fails instead of repeating the error", async () => {
  const engine = new FakeEngine();
  const scheduler = new FakeScheduler();
  const workspace = createWorkspace(engine, { scheduler });
  await workspace.checkEngine();
  await workspace.loadCircuit(clockDocument());
  engine.errorOn = "tick";
  await workspace.start();

  scheduler.fire();
  await drain();

  const state = workspace.snapshot();
  assert.equal(state.simulationState, "paused");
  assert.equal(state.operationError, "推进一步失败");
  assert.equal(state.engineState, "ready");
  // 失败之后不再排定：每一拍重复报同一个错误没有意义。
  assert.equal(scheduler.fire(), false);
  assert.equal(state.canResume, true);
});

test("surfaces a failed tick without leaving the workspace stuck", async () => {
  const engine = new FakeEngine();
  const workspace = createWorkspace(engine);
  await workspace.checkEngine();
  await workspace.loadCircuit(clockDocument());
  engine.errorOn = "tick";

  const state = await workspace.step();

  assert.equal(state.operationError, "推进一步失败");
  assert.equal(state.engineState, "ready");
  assert.equal(state.simulationState, "stopped");
  assert.equal(state.canStep, true);
});

test("resets the simulation back to its initial state", async () => {
  const engine = new FakeEngine();
  const workspace = createWorkspace(engine);
  await workspace.checkEngine();
  const loaded = await workspace.loadCircuit(clockDocument());
  assert.equal(loaded.snapshot.canReset, true);

  const advanced = await workspace.step();
  assert.equal(advanced.signals["clock:out"], 1);
  assert.equal(advanced.simulationStep, loaded.snapshot.simulationStep + 1);
  assert.equal(advanced.waveform.length > loaded.snapshot.waveform.length, true);

  engine.calls.length = 0;
  const state = await workspace.reset();

  // 重置后重新提交当前输入并求值到稳定：信号读数来自重置后的那次求值，而不是重置前的残留。
  assert.deepEqual(
    engine.calls.map((call) => call.type),
    ["reset", "settle", "getSignal", "getSignal"],
  );
  assert.equal(state.simulationState, "stopped");
  assert.equal(state.simulationStep, 0);
  assert.deepEqual(state.waveform, []);
  assert.equal(state.signals["clock:out"], 0);
  assert.equal(state.signals["monitor:in"], 0);
  assert.equal(state.outputValue, 0);
  assert.equal(state.message, "已重置到初始状态。");
  assert.equal(state.canReset, true);
  assert.equal(state.canStart, true);
});

test("resets from the running state and cancels the scheduled advance", async () => {
  const engine = new FakeEngine();
  const scheduler = new FakeScheduler();
  const workspace = createWorkspace(engine, { scheduler });
  await workspace.checkEngine();
  await workspace.loadCircuit(clockDocument());
  await workspace.start();
  scheduler.fire();
  await drain();
  assert.equal(workspace.snapshot().simulationState, "running");
  assert.equal(workspace.snapshot().signals["clock:out"], 1);
  engine.calls.length = 0;

  const state = await workspace.reset();

  assert.equal(state.simulationState, "stopped");
  assert.equal(state.simulationStep, 0);
  assert.equal(state.signals["clock:out"], 0);
  // 重置取消了已经排定的下一次推进：重置之后不会再有推进自行落地。
  assert.equal(scheduler.fire(), false);
  await drain();
  assert.equal(engine.calls.filter((call) => call.type === "tick").length, 0);
});

test("re-submits the current input values after a reset", async () => {
  const engine = new FakeEngine();
  const workspace = createWorkspace(engine);
  await workspace.checkEngine();
  await workspace.loadCircuit(createAndDemoDocument());
  await workspace.toggleInput("input-a");
  assert.equal(workspace.snapshot().inputValues["input-a"], 0);
  engine.calls.length = 0;

  const state = await workspace.reset();

  // 重置把引擎里的 Input 也清回了初值，因此工作区必须重新提交当前输入，否则画面会停在全部 X 上。
  assert.deepEqual(
    engine.calls.map((call) => call.type),
    ["reset", "setInput", "setInput", "settle", "getSignal", "getSignal"],
  );
  assert.deepEqual(engine.calls.slice(1, 3), [
    { type: "setInput", componentId: 1, value: 0 },
    { type: "setInput", componentId: 2, value: 1 },
  ]);
  assert.equal(state.inputValues["input-a"], 0);
  assert.equal(state.inputValues["input-b"], 1);
  assert.equal(state.outputValue, 0);
  assert.equal(state.simulationStep, 0);
  assert.deepEqual(state.waveform, []);
});

test("surfaces a failed reset without half-clearing the readings", async () => {
  const engine = new FakeEngine();
  const workspace = createWorkspace(engine);
  await workspace.checkEngine();
  await workspace.loadCircuit(clockDocument());
  await workspace.step();
  assert.equal(workspace.snapshot().signals["clock:out"], 1);
  engine.errorOn = "reset";

  const state = await workspace.reset();

  assert.equal(state.operationError, "重置失败");
  assert.equal(state.engineState, "ready");
  // 引擎没有重置，因此已读到的读数与步数都不该被清掉：加载不计步，那次单步是第 1 步。
  assert.equal(state.signals["clock:out"], 1);
  assert.equal(state.simulationStep, 1);
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
  assert.equal(state.canStep, true);
});

test("recognizes every input component in generic editor bindings", async () => {
  const engine = new FakeEngine();
  const workspace = createWorkspace(engine);
  await workspace.checkEngine();

  workspace.rebindSimulation({
    components: { "input-a": 1, "input-b": 2, "input-c": 3, "and-gate": 4, output: 5 },
    componentKinds: { "input-a": "input", "input-b": "input", "input-c": "input", "and-gate": "and", output: "output" },
  });

  assert.equal(workspace.snapshot().canStep, true);
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
  // 与生产接线一致：编辑器端口与工作区共用同一条引擎调用队列。
  const queue = createEngineCallQueue();
  const workspace = createWorkspace(engine, { queue });
  await workspace.checkEngine();
  const loaded = await workspace.loadCircuit(createAndDemoDocument());
  assert.ok(loaded.bindings);

  const session = createEditorSession(
    { document: createAndDemoDocument(), bindings: bindingsFrom(loaded.bindings) },
    createProtocolEnginePort(engine, queue),
    {
      onBindingsChanged(bindings) {
        workspace.rebindSimulation(bindings);
      },
    },
  );

  await session.dispatch({ type: "delete-component", componentId: "input-a" });
  await session.dispatch({ type: "undo" });
  assert.equal(workspace.snapshot().canStep, true);

  engine.calls.length = 0;
  await workspace.refreshReadings();
  assert.deepEqual(engine.calls[0], { type: "setInput", componentId: 45, value: 1 });
  assert.equal(JSON.stringify(session.snapshot()).includes("41"), false);
});

test("disables simulation after clear and rebinds it after one undo", async () => {
  const engine = new FakeEngine();
  const queue = createEngineCallQueue();
  const workspace = createWorkspace(engine, { queue });
  await workspace.checkEngine();
  const loaded = await workspace.loadCircuit(createAndDemoDocument());
  assert.ok(loaded.bindings);
  const session = createEditorSession(
    { document: createAndDemoDocument(), bindings: bindingsFrom(loaded.bindings) },
    createProtocolEnginePort(engine, queue),
    {
      onBindingsChanged(bindings) {
        workspace.rebindSimulation(bindings);
      },
    },
  );

  await session.dispatch({ type: "request-clear" });
  await session.dispatch({ type: "confirm-clear" });
  assert.equal(workspace.snapshot().canStep, false);

  await session.dispatch({ type: "undo" });
  assert.equal(workspace.snapshot().canStep, true);
});
