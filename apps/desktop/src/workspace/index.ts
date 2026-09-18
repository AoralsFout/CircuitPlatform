import type { ComponentKindName, EngineResponse, Signal } from "@circuit-platform/protocol";

/** 输入设置项的稳定键；键是编辑器组件 ID，与引擎身份无关。 */
export type InputKey = string;
export type BinarySignal = 0 | 1;
export type WorkspaceEngineState = "checking" | "ready" | "unavailable" | "error";
export type SimulationState = "idle" | "running";

export interface EngineHealth {
  status: "ok" | "error" | "unavailable";
  message?: string;
  engine?: string;
}

/**
 * 引擎 adapter 的最小接口，隔离渲染层与 Electron/C++ 通信细节。
 * adapter 必须返回协议响应；协议错误由工作区模块统一转换为可展示状态。
 */
export interface EngineAdapter {
  checkEngine(): Promise<EngineHealth>;
  addComponent(kind: ComponentKindName): Promise<EngineResponse>;
  addConnection(
    source: { componentId: number; port: string },
    target: { componentId: number; port: string },
  ): Promise<EngineResponse>;
  removeComponent(componentId: number): Promise<EngineResponse>;
  removeConnection(connectionId: number): Promise<EngineResponse>;
  setInput(componentId: number, value: Signal): Promise<EngineResponse>;
  settle(): Promise<EngineResponse>;
  tick(): Promise<EngineResponse>;
  getSignal(componentId: number, port: string): Promise<EngineResponse>;
}

/**
 * 一份电路文档中参与结构推送的最小投影；`EditorDocument` 结构上是它的超集。
 * 工作区不依赖编辑器模块，只接受它理解的结构子集。
 */
export interface CircuitDocument {
  components: readonly { id: string; kind: ComponentKindName }[];
  connections: readonly {
    id: string;
    source: { componentId: string; port: string };
    target: { componentId: string; port: string };
  }[];
}

/** 编辑器向仿真工作区提供的通用运行时绑定，不依赖任何固定示例身份。 */
export interface SimulationBindings {
  components: Readonly<Partial<Record<string, number>>>;
  componentKinds?: Readonly<Partial<Record<string, ComponentKindName>>>;
  connections?: Readonly<Partial<Record<string, number>>>;
}

export interface CircuitLoadResult {
  snapshot: WorkspaceSnapshot;
  bindings: SimulationBindings | null;
}

export interface WaveformPoint {
  step: number;
  a: BinarySignal;
  b: BinarySignal;
  output: Signal;
}

export interface WorkspaceSnapshot {
  engineState: WorkspaceEngineState;
  engineName: string;
  message: string;
  operationError: string | null;
  isBusy: boolean;
  simulationState: SimulationState;
  /** 兼容投影：按绑定顺序的前两个 Input 元件。 */
  inputA: BinarySignal;
  inputB: BinarySignal;
  /** 当前所有 Input Component 的值，键为工作区绑定中的编辑器 ID。 */
  inputValues: Readonly<Record<InputKey, BinarySignal>>;
  /** 最近一次稳定求值后的端口信号，键为 `${editorComponentId}:${portId}`。 */
  signals: Readonly<Record<string, Signal>>;
  /**
   * 兼容投影：文档中第一个 Output 元件的值；全部输出见 `signals`。
   * 它由提交输入并稳定求值的路径刷新；`step` 只带回输出 Port 的快照，接收端由场景投影
   * 沿 Connection 推导，因此这条兼容标量在单步之后保持上一次求值的读数。
   */
  outputValue: Signal;
  hasCircuit: boolean;
  simulationStep: number;
  waveform: readonly WaveformPoint[];
  canRun: boolean;
}

/**
 * 工作区领域行为的窄接口：负责引擎检查、文档推送、求值、输入切换和展示快照。
 * 操作失败不会抛给 UI；错误会被记录到返回快照的 message，且保留此前可用状态。
 */
export interface Workspace {
  checkEngine(): Promise<WorkspaceSnapshot>;
  /** 把一份电路文档整体推送到引擎，并返回本次会话的编辑器 ID → 引擎 ID 绑定。 */
  loadCircuit(document: CircuitDocument): Promise<CircuitLoadResult>;
  /** 由编辑器会话在结构提交后更新仿真所使用的临时引擎身份。 */
  rebindSimulation(bindings: SimulationBindings | null): WorkspaceSnapshot;
  runSimulation(): Promise<WorkspaceSnapshot>;
  /** 推进仿真一个 tick，并用响应带回的输出 Port 快照刷新信号。 */
  step(): Promise<WorkspaceSnapshot>;
  toggleInput(key: InputKey): Promise<WorkspaceSnapshot>;
  snapshot(): WorkspaceSnapshot;
}

interface MutableState {
  engineState: WorkspaceEngineState;
  engineName: string;
  message: string;
  operationError: string | null;
  isBusy: boolean;
  simulationState: SimulationState;
  inputA: BinarySignal;
  inputB: BinarySignal;
  inputValues: Record<InputKey, BinarySignal>;
  signals: Record<string, Signal>;
  outputValue: Signal;
  hasCircuit: boolean;
  runtimeBindings: RuntimeSimulationBindings | null;
  simulationStep: number;
  waveform: WaveformPoint[];
}

interface RuntimeInputBinding {
  key: InputKey;
  componentId: number;
}

interface RuntimeSignalBinding {
  key: string;
  componentId: number;
  port: string;
}

interface RuntimeSimulationBindings {
  inputs: readonly RuntimeInputBinding[];
  /** 文档中全部 Output 元件的接收端；每个 Output 单独读取自己的值。 */
  outputs: readonly RuntimeSignalBinding[];
  observedSignals: readonly RuntimeSignalBinding[];
}

// 只向引擎读取元件的驱动端；Input 的值来自本次提交，接收端由编辑器沿 Connection 投影。
const observableOutputPorts: Readonly<Partial<Record<ComponentKindName, readonly string[]>>> = {
  and: ["out"],
  or: ["out"],
  nand: ["out"],
  nor: ["out"],
  xor: ["out"],
  xnor: ["out"],
  not: ["out"],
  clock: ["out"],
  d_flip_flop: ["q"],
};

// 承载可展示读数的接收端；Output 元件的值来自它的输入 Port。
const observableInputPorts: Readonly<Partial<Record<ComponentKindName, string>>> = {
  output: "in",
};

function isErrorResponse(response: EngineResponse): response is Extract<EngineResponse, { type: "error" }> {
  return response.type === "error";
}

class ProtocolResponseError extends Error {}

function expectResponse<T extends EngineResponse["type"]>(
  response: EngineResponse,
  expectedType: T,
): Extract<EngineResponse, { type: T }> {
  if (isErrorResponse(response)) throw new ProtocolResponseError(response.message);
  if (response.type !== expectedType) {
    throw new Error(`引擎返回了意外响应：${response.type}`);
  }
  return response as Extract<EngineResponse, { type: T }>;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function createInitialState(): MutableState {
  return {
    engineState: "checking",
    engineName: "未连接",
    message: "正在连接 C++ 仿真引擎…",
    operationError: null,
    isBusy: false,
    simulationState: "idle",
    inputA: 1,
    inputB: 1,
    inputValues: {},
    signals: {},
    outputValue: "X",
    hasCircuit: false,
    runtimeBindings: null,
    simulationStep: 0,
    waveform: [],
  };
}

function createWorkspaceSnapshot(state: MutableState): WorkspaceSnapshot {
  return {
    engineState: state.engineState,
    engineName: state.engineName,
    message: state.message,
    operationError: state.operationError,
    isBusy: state.isBusy,
    simulationState: state.simulationState,
    inputA: state.inputA,
    inputB: state.inputB,
    outputValue: state.outputValue,
    inputValues: { ...state.inputValues },
    signals: { ...state.signals },
    hasCircuit: state.hasCircuit,
    simulationStep: state.simulationStep,
    waveform: state.waveform.map((point) => ({ ...point })),
    canRun:
      state.engineState === "ready" &&
      state.runtimeBindings !== null &&
      !state.isBusy &&
      state.simulationState === "idle",
  };
}

/**
 * 从编辑器绑定推导本次求值需要提交和读取的运行时身份。
 * 收集文档中全部 Input 与全部 Output 元件，不对电路形状做任何假设。
 */
function runtimeBindingsFrom(bindings: SimulationBindings): RuntimeSimulationBindings | null {
  const components = Object.entries(bindings.components)
    .filter((entry): entry is [string, number] => entry[1] !== undefined);
  if (components.length === 0) return null;

  const inputs = components
    .filter(([id]) => bindings.componentKinds?.[id] === "input")
    .map(([key, componentId]) => ({ key, componentId }));

  const outputs = components.flatMap(([id, componentId]) => {
    const kind = bindings.componentKinds?.[id];
    if (kind === undefined) return [];
    const port = observableInputPorts[kind];
    return port === undefined ? [] : [{ key: `${id}:${port}`, componentId, port }];
  });

  const observedSignals = components.flatMap(([key, componentId]) => {
    const kind = bindings.componentKinds?.[key];
    if (kind === undefined) return [];
    return (observableOutputPorts[kind] ?? []).map((port) => ({
      key: `${key}:${port}`,
      componentId,
      port,
    }));
  });

  return { inputs, outputs, observedSignals };
}

function valuesForBindings(
  bindings: RuntimeSimulationBindings,
  existing: Readonly<Record<InputKey, BinarySignal>>,
  inputA: BinarySignal,
  inputB: BinarySignal,
): Record<InputKey, BinarySignal> {
  return Object.fromEntries(bindings.inputs.map((binding, index) => [
    binding.key,
    existing[binding.key] ?? (index === 0 ? inputA : index === 1 ? inputB : 0),
  ]));
}

/**
 * 创建一个由指定引擎 adapter 驱动的电路工作区。
 * @param adapter 实际 Electron adapter 或测试 fake；其响应必须符合共享协议。
 * @returns 可观察快照并提供通用文档推送与求值行为的工作区模块。
 */
export function createWorkspace(adapter: EngineAdapter): Workspace {
  const state = createInitialState();

  async function checkEngine(): Promise<WorkspaceSnapshot> {
    if (state.isBusy) return createWorkspaceSnapshot(state);
    state.isBusy = true;
    state.engineState = "checking";
    state.message = "正在连接 C++ 仿真引擎…";
    state.operationError = null;
    try {
      const result = await adapter.checkEngine();
      if (result.status === "ok") {
        state.engineState = "ready";
        state.engineName = result.engine ?? "CircuitPlatform C++ Engine";
        state.message = "引擎已就绪，可以编辑电路。";
      } else {
        state.engineState = result.status;
        state.message = result.message ?? "无法获得引擎状态。";
      }
    } catch (error) {
      state.engineState = "error";
      state.message = errorMessage(error, "无法连接到 Electron 主进程。");
      state.operationError = state.message;
    } finally {
      state.isBusy = false;
    }
    return createWorkspaceSnapshot(state);
  }

  async function addComponent(kind: ComponentKindName): Promise<number> {
    return expectResponse(await adapter.addComponent(kind), "component_added").componentId;
  }

  async function addConnection(
    sourceComponentId: number,
    sourcePort: string,
    targetComponentId: number,
    targetPort: string,
  ): Promise<number> {
    return expectResponse(
      await adapter.addConnection(
        { componentId: sourceComponentId, port: sourcePort },
        { componentId: targetComponentId, port: targetPort },
      ),
      "connection_added",
    ).connectionId;
  }

  async function runSimulationInternal(
    bindings: RuntimeSimulationBindings | null,
    nextInputValues: Readonly<Record<InputKey, BinarySignal>> = state.inputValues,
  ): Promise<boolean> {
    if (!bindings) return false;
    state.simulationState = "running";
    state.operationError = null;
    try {
      const committedValues = bindings.inputs.map((binding) => ({
        binding,
        value: nextInputValues[binding.key] ?? 0,
      }));
      for (const { binding, value } of committedValues) {
        expectResponse(await adapter.setInput(binding.componentId, value), "input_set");
      }
      expectResponse(await adapter.settle(), "settled");

      // 每个 Output 元件读取自己的接收端，不假设文档中只有一个 Output。
      const outputSignals: Record<string, Signal> = {};
      for (const binding of bindings.outputs) {
        outputSignals[binding.key] = expectResponse(
          await adapter.getSignal(binding.componentId, binding.port),
          "signal_result",
        ).value;
      }

      const observedSignals: Record<string, Signal> = {};
      for (const binding of bindings.observedSignals) {
        observedSignals[binding.key] = expectResponse(
          await adapter.getSignal(binding.componentId, binding.port),
          "signal_result",
        ).value;
      }

      state.inputValues = Object.fromEntries(committedValues.map(({ binding, value }) => [binding.key, value]));
      state.inputA = committedValues[0]?.value ?? state.inputA;
      state.inputB = committedValues[1]?.value ?? state.inputB;
      state.outputValue = bindings.outputs.length > 0 ? outputSignals[bindings.outputs[0].key] ?? "X" : "X";
      state.signals = {
        ...Object.fromEntries(committedValues.map(({ binding, value }) => [`${binding.key}:out`, value])),
        ...observedSignals,
        ...outputSignals,
      };
      state.simulationStep += 1;
      state.waveform.push({
        step: state.simulationStep,
        a: state.inputA,
        b: state.inputB,
        output: state.outputValue,
      });
      state.message = "仿真已稳定，信号已更新。";
      return true;
    } catch (error) {
      state.message = errorMessage(error, "仿真失败。");
      state.operationError = state.message;
      if (!(error instanceof ProtocolResponseError)) state.engineState = "error";
      return false;
    } finally {
      state.simulationState = "idle";
    }
  }

  /**
   * 把一份文档按顺序推送到引擎：先建全部 Component，再建全部 Connection。
   * 任何一步失败都按创建顺序反向补偿，不留下半成品结构。
   */
  async function loadCircuit(document: CircuitDocument): Promise<CircuitLoadResult> {
    if (state.hasCircuit || state.isBusy || state.engineState !== "ready") {
      return { snapshot: createWorkspaceSnapshot(state), bindings: null };
    }
    state.isBusy = true;
    state.message = "正在把电路结构推送到仿真引擎…";
    state.operationError = null;
    const components: Record<string, number> = {};
    const connections: Record<string, number> = {};
    const componentKinds: Record<string, ComponentKindName> = {};
    const createdComponentIds: number[] = [];
    const createdConnectionIds: number[] = [];
    try {
      for (const component of document.components) {
        const id = await addComponent(component.kind);
        createdComponentIds.push(id);
        components[component.id] = id;
        componentKinds[component.id] = component.kind;
      }
      for (const connection of document.connections) {
        const source = components[connection.source.componentId];
        const target = components[connection.target.componentId];
        if (source === undefined || target === undefined) {
          throw new Error(`连接 ${connection.id} 引用了文档中不存在的 Component。`);
        }
        const id = await addConnection(source, connection.source.port, target, connection.target.port);
        createdConnectionIds.push(id);
        connections[connection.id] = id;
      }
      const bindings: SimulationBindings = { components, connections, componentKinds };
      const runtimeBindings = runtimeBindingsFrom(bindings);
      state.runtimeBindings = runtimeBindings;
      if (runtimeBindings) {
        state.inputValues = valuesForBindings(runtimeBindings, state.inputValues, state.inputA, state.inputB);
      }
      state.hasCircuit = true;
      state.message = "电路已就绪，试着切换输入。";
      await runSimulationInternal(state.runtimeBindings);
      state.isBusy = false;
      return { snapshot: createWorkspaceSnapshot(state), bindings };
    } catch (error) {
      state.message = errorMessage(error, "推送电路结构失败。");
      state.operationError = state.message;
      for (const connectionId of createdConnectionIds.reverse()) {
        try { await adapter.removeConnection(connectionId); } catch { /* 保留原始创建错误。 */ }
      }
      for (const componentId of createdComponentIds.reverse()) {
        try { await adapter.removeComponent(componentId); } catch { /* 保留原始创建错误。 */ }
      }
      state.runtimeBindings = null;
      state.hasCircuit = false;
    } finally {
      state.isBusy = false;
    }
    return { snapshot: createWorkspaceSnapshot(state), bindings: null };
  }

  function rebindSimulation(bindings: SimulationBindings | null): WorkspaceSnapshot {
    state.runtimeBindings = bindings ? runtimeBindingsFrom(bindings) : null;
    state.signals = {};
    state.outputValue = "X";
    if (state.runtimeBindings) {
      state.inputValues = valuesForBindings(state.runtimeBindings, state.inputValues, state.inputA, state.inputB);
      state.inputA = state.runtimeBindings.inputs[0] ? state.inputValues[state.runtimeBindings.inputs[0].key] ?? state.inputA : state.inputA;
      state.inputB = state.runtimeBindings.inputs[1] ? state.inputValues[state.runtimeBindings.inputs[1].key] ?? state.inputB : state.inputB;
    }
    return createWorkspaceSnapshot(state);
  }

  async function runSimulation(): Promise<WorkspaceSnapshot> {
    if (!state.runtimeBindings || state.isBusy || state.simulationState === "running") {
      return createWorkspaceSnapshot(state);
    }
    state.isBusy = true;
    await runSimulationInternal(state.runtimeBindings);
    state.isBusy = false;
    return createWorkspaceSnapshot(state);
  }

  /**
   * 推进一个 tick。响应一次带回电路中全部输出 Port 的当前值，因此每步只有一次跨进程往返，
   * 往返次数不随电路规模增长；Output 这类接收端的值继续由场景投影沿 Connection 推导。
   */
  async function stepInternal(bindings: RuntimeSimulationBindings): Promise<boolean> {
    state.simulationState = "running";
    state.operationError = null;
    try {
      const ticked = expectResponse(await adapter.tick(), "ticked");

      // 引擎按引擎身份回传快照，这里映射回工作区既有的 `${editorId}:${portId}` 键空间。
      const enginePorts = new Map(
        ticked.signals.map((signal) => [`${signal.componentId}:${signal.port}`, signal.value]),
      );
      const observedSignals: Record<string, Signal> = {};
      for (const binding of bindings.observedSignals) {
        const value = enginePorts.get(`${binding.componentId}:${binding.port}`);
        if (value !== undefined) observedSignals[binding.key] = value;
      }

      // Input 的值来自工作区已提交的输入，不由引擎快照覆盖。
      state.signals = {
        ...Object.fromEntries(
          bindings.inputs.map((binding) => [`${binding.key}:out`, state.inputValues[binding.key] ?? 0]),
        ),
        ...observedSignals,
      };
      state.simulationStep += 1;
      state.waveform.push({
        step: state.simulationStep,
        a: state.inputA,
        b: state.inputB,
        output: state.outputValue,
      });
      state.message = `已推进到第 ${ticked.step} 步。`;
      return true;
    } catch (error) {
      state.message = errorMessage(error, "推进失败。");
      state.operationError = state.message;
      if (!(error instanceof ProtocolResponseError)) state.engineState = "error";
      return false;
    } finally {
      state.simulationState = "idle";
    }
  }

  async function step(): Promise<WorkspaceSnapshot> {
    if (!state.runtimeBindings || state.isBusy || state.simulationState === "running") {
      return createWorkspaceSnapshot(state);
    }
    state.isBusy = true;
    await stepInternal(state.runtimeBindings);
    state.isBusy = false;
    return createWorkspaceSnapshot(state);
  }

  async function toggleInput(key: InputKey): Promise<WorkspaceSnapshot> {
    if (!state.runtimeBindings || state.isBusy || state.simulationState === "running") {
      return createWorkspaceSnapshot(state);
    }
    if (!state.runtimeBindings.inputs.some((binding) => binding.key === key)) return createWorkspaceSnapshot(state);
    const nextInputValues: Record<InputKey, BinarySignal> = { ...state.inputValues, [key]: (state.inputValues[key] === 1 ? 0 : 1) as BinarySignal };
    state.isBusy = true;
    await runSimulationInternal(state.runtimeBindings, nextInputValues);
    state.isBusy = false;
    return createWorkspaceSnapshot(state);
  }

  return {
    checkEngine,
    loadCircuit,
    rebindSimulation,
    runSimulation,
    step,
    toggleInput,
    snapshot: () => createWorkspaceSnapshot(state),
  };
}
