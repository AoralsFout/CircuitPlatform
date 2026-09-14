import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentKindName, EngineResponse, Signal } from "@circuit-platform/protocol";
import { createAndDemoDocument, createEditorSession, type EditorBindings } from "../src/editor/index.ts";
import { createProtocolEnginePort } from "../src/editor/protocolEnginePort.ts";
import { createWorkspace, type EngineAdapter, type InputKey } from "../src/workspace/index.ts";

type Call =
  | { type: "checkEngine" }
  | { type: "addComponent"; kind: ComponentKindName }
  | { type: "addConnection"; sourceComponentId: number; sourcePort: string; targetComponentId: number; targetPort: string }
  | { type: "removeComponent"; componentId: number }
  | { type: "removeConnection"; connectionId: number }
  | { type: "setInput"; componentId: number; value: Signal }
  | { type: "settle" }
  | { type: "getSignal"; componentId: number; port: string };

class FakeEngine implements EngineAdapter {
  readonly calls: Call[] = [];
  nextComponentId = 1;
  nextConnectionId = 1;
  private inputs = new Map<number, Signal>();
  private output: Signal = "X";
  errorOn: Call["type"] | null = null;

  async checkEngine() {
    this.calls.push({ type: "checkEngine" });
    return { status: "ok" as const, engine: "fake-engine" };
  }

  async addComponent(kind: ComponentKindName): Promise<EngineResponse> {
    this.calls.push({ type: "addComponent", kind });
    if (this.errorOn === "addComponent") return this.error("创建元件失败");
    return { type: "component_added", requestId: "fake", componentId: this.nextComponentId++ };
  }

  async addConnection(source: { componentId: number; port: string }, target: { componentId: number; port: string }): Promise<EngineResponse> {
    this.calls.push({ type: "addConnection", sourceComponentId: source.componentId, sourcePort: source.port, targetComponentId: target.componentId, targetPort: target.port });
    if (this.errorOn === "addConnection") return this.error("连接失败");
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
    const values = [...this.inputs.values()];
    this.output = values.length === 2 && values.every((value) => value === 1) ? 1 : 0;
    return { type: "settled", requestId: "fake", status: "ok" };
  }

  async getSignal(componentId: number, port: string): Promise<EngineResponse> {
    this.calls.push({ type: "getSignal", componentId, port });
    if (this.errorOn === "getSignal") return this.error("读取输出失败");
    return { type: "signal_result", requestId: "fake", value: this.output };
  }

  private error(message: string): EngineResponse {
    return { type: "error", requestId: "fake", code: "FAKE_ERROR", message };
  }
}

test("creates and runs the AND example through the adapter", async () => {
  const engine = new FakeEngine();
  const workspace = createWorkspace(engine);

  await workspace.checkEngine();
  const loaded = await workspace.loadDemoCircuit();
  const state = loaded.snapshot;

  assert.equal(state.engineState, "ready");
  assert.equal(state.hasLab, true);
  assert.deepEqual(loaded.bindings, {
    components: { inputA: 1, inputB: 2, andGate: 3, output: 4 },
    connections: { wireA: 1, wireB: 2, wireOutput: 3 },
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
  ]);
});

test("turns an engine error response into visible workspace error state", async () => {
  const engine = new FakeEngine();
  engine.errorOn = "addConnection";
  const workspace = createWorkspace(engine);
  await workspace.checkEngine();

  const state = (await workspace.loadDemoCircuit()).snapshot;

  assert.equal(state.hasLab, false);
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
  await workspace.loadDemoCircuit();

  const state = await workspace.toggleInput("a" satisfies InputKey);

  assert.equal(state.inputA, 0);
  assert.equal(state.inputB, 1);
  assert.equal(state.outputValue, 0);
  assert.deepEqual(state.waveform, [
    { step: 1, a: 1, b: 1, output: 1 },
    { step: 2, a: 0, b: 1, output: 0 },
  ]);
  assert.equal(state.outputDescription, "至少一个输入为 0");
});

test("keeps the committed input when the next simulation is rejected", async () => {
  const engine = new FakeEngine();
  const workspace = createWorkspace(engine);
  await workspace.checkEngine();
  await workspace.loadDemoCircuit();
  engine.errorOn = "setInput";

  const state = await workspace.toggleInput("a");

  assert.equal(state.inputA, 1);
  assert.equal(state.outputValue, 1);
  assert.equal(state.operationError, "输入设置失败");
  assert.equal(state.engineState, "ready");
  assert.equal(state.canRun, true);
});

test("rebinds simulation to the new engine ID after undo", async () => {
  const engine = new FakeEngine();
  engine.nextComponentId = 41;
  engine.nextConnectionId = 71;
  const workspace = createWorkspace(engine);
  await workspace.checkEngine();
  const loaded = await workspace.loadDemoCircuit();
  assert.ok(loaded.bindings);

  const initialBindings: EditorBindings = {
    components: {
      "input-a": loaded.bindings.components.inputA,
      "input-b": loaded.bindings.components.inputB,
      "and-gate": loaded.bindings.components.andGate,
      output: loaded.bindings.components.output,
    },
    connections: {
      "wire-a": loaded.bindings.connections.wireA,
      "wire-b": loaded.bindings.connections.wireB,
      "wire-output": loaded.bindings.connections.wireOutput,
    },
  };
  const session = createEditorSession(
    { document: createAndDemoDocument(), bindings: initialBindings },
    createProtocolEnginePort(engine),
    {
      onBindingsChanged(bindings) {
        const inputA = bindings.components["input-a"];
        const inputB = bindings.components["input-b"];
        const andGate = bindings.components["and-gate"];
        const output = bindings.components.output;
        workspace.rebindSimulation(
          inputA === undefined || inputB === undefined || andGate === undefined || output === undefined
            ? null
            : { inputA, inputB, andGate, output },
        );
      },
    },
  );

  await session.dispatch({ type: "delete-component", componentId: "input-a" });
  assert.equal(workspace.snapshot().canRun, false);
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
  const loaded = await workspace.loadDemoCircuit();
  assert.ok(loaded.bindings);
  const session = createEditorSession(
    {
      document: createAndDemoDocument(),
      bindings: {
        components: {
          "input-a": loaded.bindings.components.inputA,
          "input-b": loaded.bindings.components.inputB,
          "and-gate": loaded.bindings.components.andGate,
          output: loaded.bindings.components.output,
        },
        connections: {
          "wire-a": loaded.bindings.connections.wireA,
          "wire-b": loaded.bindings.connections.wireB,
          "wire-output": loaded.bindings.connections.wireOutput,
        },
      },
    },
    createProtocolEnginePort(engine),
    {
      onBindingsChanged(bindings) {
        const inputA = bindings.components["input-a"];
        const inputB = bindings.components["input-b"];
        const andGate = bindings.components["and-gate"];
        const output = bindings.components.output;
        const hasCompleteWiring = ["wire-a", "wire-b", "wire-output"]
          .every((id) => bindings.connections[id] !== undefined);
        workspace.rebindSimulation(
          inputA === undefined || inputB === undefined || andGate === undefined || output === undefined || !hasCompleteWiring
            ? null
            : { inputA, inputB, andGate, output },
        );
      },
    },
  );

  await session.dispatch({ type: "request-clear" });
  await session.dispatch({ type: "confirm-clear" });
  assert.equal(workspace.snapshot().canRun, false);

  await session.dispatch({ type: "undo" });
  assert.equal(workspace.snapshot().canRun, true);
});
