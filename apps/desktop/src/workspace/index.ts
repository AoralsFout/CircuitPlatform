import type { ComponentKindName, EngineResponse, Signal } from "@circuit-platform/protocol";

export type InputKey = "a" | "b";
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
  getSignal(componentId: number, port: string): Promise<EngineResponse>;
}

export interface LabIds {
  inputA: number;
  inputB: number;
  andGate: number;
  output: number;
}

export interface DemoRuntimeBindings {
  components: LabIds;
  connections: {
    wireA: number;
    wireB: number;
    wireOutput: number;
  };
}

export interface DemoLoadResult {
  snapshot: WorkspaceSnapshot;
  bindings: DemoRuntimeBindings | null;
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
  inputA: BinarySignal;
  inputB: BinarySignal;
  outputValue: Signal;
  outputDescription: string;
  hasLab: boolean;
  simulationStep: number;
  waveform: readonly WaveformPoint[];
  canRun: boolean;
}

/**
 * 工作区领域行为的窄接口：负责引擎检查、AND 示例编排、求值、输入切换和展示快照。
 * 操作失败不会抛给 UI；错误会被记录到返回快照的 message，且保留此前可用状态。
 */
export interface Workspace {
  checkEngine(): Promise<WorkspaceSnapshot>;
  loadDemoCircuit(): Promise<DemoLoadResult>;
  /** 由编辑器会话在结构提交后更新仿真所使用的临时引擎身份。 */
  rebindSimulation(ids: LabIds | null): WorkspaceSnapshot;
  runSimulation(): Promise<WorkspaceSnapshot>;
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
  outputValue: Signal;
  hasLab: boolean;
  labIds: LabIds | null;
  simulationStep: number;
  waveform: WaveformPoint[];
}

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

function outputDescription(value: Signal): string {
  if (value === "X") return "等待稳定求值";
  return value === 1 ? "两个输入都为 1" : "至少一个输入为 0";
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
    outputValue: "X",
    hasLab: false,
    labIds: null,
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
    outputDescription: outputDescription(state.outputValue),
    hasLab: state.hasLab,
    simulationStep: state.simulationStep,
    waveform: state.waveform.map((point) => ({ ...point })),
    canRun:
      state.engineState === "ready" &&
      state.labIds !== null &&
      !state.isBusy &&
      state.simulationState === "idle",
  };
}

/**
 * 创建一个由指定引擎 adapter 驱动的电路工作区。
 * @param adapter 实际 Electron adapter 或测试 fake；其响应必须符合共享协议。
 * @returns 可观察快照并提供完整示例行为的工作区模块。
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
        state.message = "引擎已就绪，可以运行示例电路。";
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
    ids: LabIds | null,
    nextInputA = state.inputA,
    nextInputB = state.inputB,
  ): Promise<boolean> {
    if (!ids) return false;
    state.simulationState = "running";
    state.operationError = null;
    try {
      expectResponse(await adapter.setInput(ids.inputA, nextInputA), "input_set");
      expectResponse(await adapter.setInput(ids.inputB, nextInputB), "input_set");
      expectResponse(await adapter.settle(), "settled");
      const result = expectResponse(await adapter.getSignal(ids.output, "in"), "signal_result");
      state.inputA = nextInputA;
      state.inputB = nextInputB;
      state.outputValue = result.value;
      state.simulationStep += 1;
      state.waveform.push({
        step: state.simulationStep,
        a: state.inputA,
        b: state.inputB,
        output: state.outputValue,
      });
      state.message = "仿真已稳定，输出值已更新。";
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

  async function loadDemoCircuit(): Promise<DemoLoadResult> {
    if (state.hasLab || state.isBusy || state.engineState !== "ready") {
      return { snapshot: createWorkspaceSnapshot(state), bindings: null };
    }
    state.isBusy = true;
    state.message = "正在创建 2 个输入、AND 门和输出端…";
    state.operationError = null;
    const createdComponentIds: number[] = [];
    const createdConnectionIds: number[] = [];
    const addTrackedComponent = async (kind: ComponentKindName): Promise<number> => {
      const id = await addComponent(kind);
      createdComponentIds.push(id);
      return id;
    };
    try {
      const ids: LabIds = {
        inputA: await addTrackedComponent("input"),
        inputB: await addTrackedComponent("input"),
        andGate: await addTrackedComponent("and"),
        output: await addTrackedComponent("output"),
      };
      const wireA = await addConnection(ids.inputA, "out", ids.andGate, "in1");
      createdConnectionIds.push(wireA);
      const wireB = await addConnection(ids.inputB, "out", ids.andGate, "in2");
      createdConnectionIds.push(wireB);
      const wireOutput = await addConnection(ids.andGate, "out", ids.output, "in");
      createdConnectionIds.push(wireOutput);
      const connections = { wireA, wireB, wireOutput };
      state.labIds = ids;
      state.hasLab = true;
      state.message = "示例已创建，试着切换输入 A 或输入 B。";
      await runSimulationInternal(ids);
      state.isBusy = false;
      return {
        snapshot: createWorkspaceSnapshot(state),
        bindings: { components: { ...ids }, connections },
      };
    } catch (error) {
      state.message = errorMessage(error, "创建示例电路失败。");
      state.operationError = state.message;
      for (const connectionId of createdConnectionIds.reverse()) {
        try { await adapter.removeConnection(connectionId); } catch { /* 保留原始创建错误。 */ }
      }
      for (const componentId of createdComponentIds.reverse()) {
        try { await adapter.removeComponent(componentId); } catch { /* 保留原始创建错误。 */ }
      }
    } finally {
      state.isBusy = false;
    }
    return { snapshot: createWorkspaceSnapshot(state), bindings: null };
  }

  function rebindSimulation(ids: LabIds | null): WorkspaceSnapshot {
    state.labIds = ids ? { ...ids } : null;
    return createWorkspaceSnapshot(state);
  }

  async function runSimulation(): Promise<WorkspaceSnapshot> {
    if (!state.labIds || state.isBusy || state.simulationState === "running") {
      return createWorkspaceSnapshot(state);
    }
    state.isBusy = true;
    await runSimulationInternal(state.labIds);
    state.isBusy = false;
    return createWorkspaceSnapshot(state);
  }

  async function toggleInput(key: InputKey): Promise<WorkspaceSnapshot> {
    if (!state.labIds || state.isBusy || state.simulationState === "running") {
      return createWorkspaceSnapshot(state);
    }
    const nextInputA = key === "a" ? (state.inputA === 1 ? 0 : 1) : state.inputA;
    const nextInputB = key === "b" ? (state.inputB === 1 ? 0 : 1) : state.inputB;
    state.isBusy = true;
    await runSimulationInternal(state.labIds, nextInputA, nextInputB);
    state.isBusy = false;
    return createWorkspaceSnapshot(state);
  }

  return {
    checkEngine,
    loadDemoCircuit,
    rebindSimulation,
    runSimulation,
    toggleInput,
    snapshot: () => createWorkspaceSnapshot(state),
  };
}
