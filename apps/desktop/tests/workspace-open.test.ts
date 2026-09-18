import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentKindName, EngineResponse, PortSpec, Signal } from "@circuit-platform/protocol";
import { createAndDemoDocument } from "../src/editor/index.ts";
import {
  createWorkspace,
  type CircuitDocument,
  type EngineAdapter,
  type EngineHealth,
} from "../src/workspace/index.ts";
import { drain, FakeScheduler } from "./fake-scheduler.ts";
import { portsForAddComponent } from "./fake-ports.ts";

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
 * 整体替换推送测试的最小假引擎：记录调用序列并允许让指定类型的调用失败，
 * 断言关心的是「先推新、成功删旧、失败补偿」的顺序，不是信号求值的细节。
 */
class FakeEngine implements EngineAdapter {
  readonly calls: Call[] = [];
  nextComponentId = 1;
  nextConnectionId = 1;
  errorOn: Call["type"] | null = null;

  async checkEngine(): Promise<EngineHealth> {
    this.calls.push({ type: "checkEngine" });
    return { status: "ok" as const, engine: "fake-engine" };
  }

  async addComponent(kind: ComponentKindName, ports?: readonly PortSpec[]): Promise<EngineResponse> {
    this.calls.push({ type: "addComponent", kind });
    if (this.errorOn === "addComponent") return this.error("创建元件失败");
    const componentId = this.nextComponentId++;
    const resolved = portsForAddComponent(kind, ports);
    return { type: "component_added", requestId: "fake", componentId, ports: resolved };
  }

  async setPortWidth(componentId: number, ports: readonly PortSpec[]): Promise<EngineResponse> {
    return { type: "port_width_set", requestId: "fake", componentId, ports, danglingConnectionIds: [] };
  }

  async addConnection(
    source: { componentId: number; port: string },
    target: { componentId: number; port: string },
  ): Promise<EngineResponse> {
    this.calls.push({
      type: "addConnection",
      sourceComponentId: source.componentId,
      sourcePort: source.port,
      targetComponentId: target.componentId,
      targetPort: target.port,
    });
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
    return { type: "connection_removed", requestId: "fake", connectionId };
  }

  async setInput(componentId: number, value: Signal): Promise<EngineResponse> {
    this.calls.push({ type: "setInput", componentId, value });
    if (this.errorOn === "setInput") return this.error("输入设置失败");
    return { type: "input_set", requestId: "fake" };
  }

  async settle(): Promise<EngineResponse> {
    this.calls.push({ type: "settle" });
    if (this.errorOn === "settle") return this.error("稳定求值失败");
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

  private error(message: string): EngineResponse {
    return { type: "error", requestId: "fake", code: "FAKE_ERROR", message };
  }
}

/** 与示例不同的另一份文档：一个 NOT 门直连一个 Output。 */
function notGateDocument(): CircuitDocument {
  return {
    components: [
      { id: "not-gate", kind: "not" },
      { id: "out-y", kind: "output" },
    ],
    connections: [
      { id: "wire-y", source: { componentId: "not-gate", port: "out" }, target: { componentId: "out-y", port: "in" } },
    ],
  };
}

/** 带一个 2 位 Input 的文档，供输入值提交断言使用。 */
function wideInputDocument(): CircuitDocument {
  return {
    components: [
      { id: "in-wide", kind: "input", ports: [{ name: "out", direction: "output", width: 2 }] },
      { id: "out-y", kind: "output" },
    ],
    connections: [],
  };
}

/** 推开示例文档并返回工作区；这是全部用例的共同前置。 */
async function workspaceWithExample(engine: FakeEngine) {
  const workspace = createWorkspace(engine);
  await workspace.checkEngine();
  const loaded = await workspace.loadCircuit(createAndDemoDocument());
  assert.ok(loaded.bindings, "示例必须推送成功");
  engine.calls.length = 0;
  return { workspace, exampleBindings: loaded.bindings };
}

/** 提取调用序列里可读的短描述，供调用顺序断言输出对比。 */
function callTrace(calls: readonly Call[]): string[] {
  return calls.map((call) => {
    switch (call.type) {
      case "addComponent": return `addComponent(${call.kind})`;
      case "addConnection": return `addConnection(${call.sourceComponentId}:${call.sourcePort}->${call.targetComponentId}:${call.targetPort})`;
      case "removeComponent": return `removeComponent(${call.componentId})`;
      case "removeConnection": return `removeConnection(${call.connectionId})`;
      case "setInput": return `setInput(${call.componentId})`;
      default: return call.type;
    }
  });
}

/** 只保留结构调用：稳定求值与读数与整体替换的顺序断言无关。 */
function structuralCallsOf(engine: FakeEngine): Call[] {
  return engine.calls.filter((call) =>
    call.type === "addComponent" ||
    call.type === "addConnection" ||
    call.type === "removeComponent" ||
    call.type === "removeConnection");
}

test("opening onto an existing circuit pushes the new document first and removes the old structure only after success", async () => {
  const engine = new FakeEngine();
  const { workspace, exampleBindings } = await workspaceWithExample(engine);

  const opened = await workspace.openCircuit(notGateDocument());

  assert.ok(opened.bindings);
  // 引擎身份单调递增：新元件接着旧元件的最大 ID 继续编号，两份电路短暂共存。
  assert.deepEqual(callTrace(structuralCallsOf(engine)), [
    "addComponent(not)",
    "addComponent(output)",
    "addConnection(5:out->6:in)",
    // 全部成功后才移除旧电路：连接先于元件（引擎的连接独立生命周期），都按创建顺序反向。
    "removeConnection(3)",
    "removeConnection(2)",
    "removeConnection(1)",
    "removeComponent(4)",
    "removeComponent(3)",
    "removeComponent(2)",
    "removeComponent(1)",
  ]);
  assert.equal(engine.calls.filter((call) => call.type === "addComponent").length, 2);
  // 绑定整体替换为新文档的身份。
  assert.deepEqual(opened.bindings.components, { "not-gate": 5, "out-y": 6 });
  assert.deepEqual(opened.bindings.connections, { "wire-y": 4 });
  assert.ok(exampleBindings.components["input-a"] !== undefined, "旧绑定快照保留旧身份供对照");
  const state = opened.snapshot;
  assert.equal(state.hasCircuit, true);
  assert.equal(state.operationError, null);
});

test("a failed open compensates the new structure, keeps the old one, and restores the previous bindings", async () => {
  const engine = new FakeEngine();
  const { workspace } = await workspaceWithExample(engine);
  // 推进两步，制造一份有步数与波形历史的运行时状态。
  await workspace.step();
  await workspace.step();
  const before = workspace.snapshot();
  assert.equal(before.simulationStep, 2);
  assert.equal(before.waveform.length, 2);

  engine.errorOn = "addConnection";
  const opened = await workspace.openCircuit(notGateDocument());
  engine.errorOn = null;

  assert.equal(opened.bindings, null);
  // 新元件已建、新连接失败：补偿只移除新建结构（反向），旧电路从头到尾没被碰。
  assert.deepEqual(callTrace(structuralCallsOf(engine)), [
    "addComponent(not)",
    "addComponent(output)",
    "addConnection(5:out->6:in)",
    "removeComponent(6)",
    "removeComponent(5)",
  ]);
  // 打开前的运行时状态原样保留。
  const state = opened.snapshot;
  assert.equal(state.hasCircuit, true);
  assert.equal(state.simulationStep, 2);
  assert.equal(state.waveform.length, 2);
  assert.deepEqual(state.inputValues, { "input-a": "1", "input-b": "1" });
  assert.notEqual(state.operationError, null);
  // 旧绑定仍然可用：按编辑器 ID 提交输入成功，读数照常刷新。
  const afterToggle = await workspace.setInputBit("input-a", 0, "0");
  assert.equal(afterToggle.simulationStep, 3);
  assert.equal(afterToggle.signals["input-a:out"], "0");
});

test("a failed open restores the input values that the open had seeded from the project file", async () => {
  const engine = new FakeEngine();
  const { workspace } = await workspaceWithExample(engine);

  // 打开先把文件里的输入值种进工作区；推送失败后恢复必须把种子值一起回滚。
  engine.errorOn = "addComponent";
  const opened = await workspace.openCircuit(notGateDocument(), {
    inputValues: { "in-x": "1" },
  });
  engine.errorOn = null;

  assert.equal(opened.bindings, null);
  const state = opened.snapshot;
  assert.equal(state.hasCircuit, true, "旧电路仍在线");
  assert.deepEqual(state.inputValues, { "input-a": "1", "input-b": "1" }, "种子值随失败回滚");
  assert.notEqual(state.operationError, null);
  // 补偿没有结构可移除（第一个元件就失败了），旧电路的结构调用一个都没有。
  assert.deepEqual(
    engine.calls.filter((call) => call.type === "removeComponent" || call.type === "removeConnection"),
    [],
  );
});

test("opening resets the timeline to step 0 and records no waveform point for the first settle", async () => {
  const engine = new FakeEngine();
  const { workspace } = await workspaceWithExample(engine);
  await workspace.step();
  await workspace.step();
  assert.equal(workspace.snapshot().waveform.length, 2);

  const opened = await workspace.openCircuit(notGateDocument());

  assert.ok(opened.bindings);
  const state = opened.snapshot;
  assert.equal(state.simulationStep, 0);
  assert.equal(state.waveform.length, 0);
  // 读数是加载后首次求值的第 0 步：输入值在快照里，信号来自这次求值而不是旧文档的残留。
  assert.equal(state.inputValues["not-gate"], undefined);
  assert.equal(state.signals["not-gate:out"], "0");
  assert.equal(state.signals["input-a:out"], undefined, "旧文档的读数键不残留");
});

test("opening commits the input values carried by the project file", async () => {
  const engine = new FakeEngine();
  const { workspace } = await workspaceWithExample(engine);

  const opened = await workspace.openCircuit(wideInputDocument(), {
    inputValues: { "in-wide": "10" },
  });

  assert.ok(opened.bindings);
  const state = opened.snapshot;
  assert.equal(state.inputValues["in-wide"], "10");
  // 兼容投影同步到新文档的第一个 Input。
  assert.equal(state.inputA, "10");
  // 文件里的取值按引擎回传位宽提交：2 位输入提交整值 "10"。
  const committed = engine.calls.filter((call) => call.type === "setInput");
  assert.equal(committed.length, 1);
  assert.equal(committed[0].value, "10");
});

test("opening an empty document removes the old circuit and leaves no circuit behind", async () => {
  const engine = new FakeEngine();
  const { workspace } = await workspaceWithExample(engine);

  const opened = await workspace.openCircuit({ components: [], connections: [] });

  assert.ok(opened.bindings, "空文档推送没有任何引擎调用，必然成功");
  assert.deepEqual(callTrace(structuralCallsOf(engine)), [
    "removeConnection(3)",
    "removeConnection(2)",
    "removeConnection(1)",
    "removeComponent(4)",
    "removeComponent(3)",
    "removeComponent(2)",
    "removeComponent(1)",
  ]);
  const state = opened.snapshot;
  assert.equal(state.hasCircuit, false, "新建之后没有电路");
  assert.deepEqual(state.inputValues, {});
  assert.equal(state.canStart, false);
  assert.equal(state.simulationStep, 0);
});

test("opening while running stops the loop, and a failed open parks it in paused", async () => {
  const engine = new FakeEngine();
  const scheduler = new FakeScheduler();
  const workspace = createWorkspace(engine, { scheduler });
  await workspace.checkEngine();
  await workspace.loadCircuit(createAndDemoDocument());
  await workspace.start();
  scheduler.fire();
  await drain();
  assert.equal(workspace.snapshot().simulationState, "running");

  // 打开成功：时间线随旧文档结束，连续运行停回 stopped，不再有排定的推进。
  const opened = await workspace.openCircuit(notGateDocument());
  assert.ok(opened.bindings);
  assert.equal(opened.snapshot.simulationState, "stopped");
  assert.equal(scheduler.pendingCount(), 0);

  // 打开失败：旧电路恢复后可以继续，但运行循环已停且不会自启，停回 paused 而不是假运行态。
  engine.errorOn = "addComponent";
  await workspace.start();
  assert.equal(workspace.snapshot().simulationState, "running");
  const failed = await workspace.openCircuit(notGateDocument());
  engine.errorOn = null;
  assert.equal(failed.bindings, null);
  assert.equal(failed.snapshot.simulationState, "paused");
  assert.equal(scheduler.pendingCount(), 0);
  assert.equal(failed.snapshot.hasCircuit, true);

  // 打开前的暂停态同样要恢复：失败不能把 paused 悄悄变成 stopped。
  await workspace.pause();
  engine.errorOn = "addConnection";
  const failedWhilePaused = await workspace.openCircuit(notGateDocument());
  engine.errorOn = null;
  assert.equal(failedWhilePaused.bindings, null);
  assert.equal(failedWhilePaused.snapshot.simulationState, "paused");
});

test("openCircuit refuses to push while the engine has not been confirmed ready", async () => {
  const engine = new FakeEngine();
  const workspace = createWorkspace(engine);

  const opened = await workspace.openCircuit(notGateDocument());

  assert.equal(opened.bindings, null);
  assert.equal(engine.calls.filter((call) => call.type === "addComponent").length, 0);
});

test("opening keeps the workspace usable after the old circuit's components were all deleted in the editor", async () => {
  const engine = new FakeEngine();
  const { workspace } = await workspaceWithExample(engine);

  // 极端前置：编辑器里删光了元件（工作区仍有旧绑定），打开推的是一份全新文档。
  const opened = await workspace.openCircuit(notGateDocument());
  assert.ok(opened.bindings);
  assert.equal(opened.snapshot.hasCircuit, true);
  assert.deepEqual(opened.bindings.components, { "not-gate": 5, "out-y": 6 });
});
