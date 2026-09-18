import type { ComponentKindName, EngineResponse, Signal } from "@circuit-platform/protocol";

/** 输入设置项的稳定键；键是编辑器组件 ID，与引擎身份无关。 */
export type InputKey = string;
export type BinarySignal = 0 | 1;
export type WorkspaceEngineState = "checking" | "ready" | "unavailable" | "error";
/**
 * 运行态：`stopped` 从未开始或已停止，`running` 连续推进中，`paused` 停在当前状态。
 * 它只描述运行循环，不描述「某条请求正在进行」——后者由 `isBusy` 表达。
 */
export type SimulationState = "stopped" | "running" | "paused";

/**
 * 连续运行的调度接缝。默认实现包一层 `setTimeout`；测试注入假实现即可无头驱动整个运行循环。
 */
export interface TickScheduler {
  /**
   * 在 delayMs 之后执行 run。
   * @param delayMs 距离这次执行的毫秒数。
   * @param run 到点后执行的回调。
   * @returns 取消这次调度的函数。
   */
  schedule(delayMs: number, run: () => void): () => void;
}

/** 连续运行两次推进之间的默认间隔；下一次推进总在上一次响应之后才排定，因此它是下限而不是频率。 */
export const TICK_INTERVAL_MS = 100;

const defaultTickScheduler: TickScheduler = {
  schedule(delayMs, run) {
    const handle = setTimeout(run, delayMs);
    return () => clearTimeout(handle);
  },
};

export interface WorkspaceOptions {
  /** 连续运行的调度器；省略时使用 `setTimeout`。 */
  scheduler?: TickScheduler;
}

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
   * 提交输入并稳定求值的路径与推进路径都会刷新它：`ticked` 快照同时带回每个 Output 元件的
   * 接收端，因此波形记录的是这一拍的真实读数。
   */
  outputValue: Signal;
  hasCircuit: boolean;
  /**
   * 工作区自当前电路加载以来完成的推进次数，只增不减，是界面上唯一的步数。
   * 引擎的 `ticked.step` 是另一个量——它属于引擎当前那份仿真状态，结构变更重建仿真时归零；
   * 状态文案、设置页与波形标签都读这个本地计数，因此界面上不会出现两个对不上的数字。
   */
  simulationStep: number;
  waveform: readonly WaveformPoint[];
  /** 可以让电路从停止态开始连续运行。 */
  canStart: boolean;
  /** 正在连续运行，可以暂停。 */
  canPause: boolean;
  /** 停在暂停态，可以继续。 */
  canResume: boolean;
  /** 可以精确推进一步；连续运行中不可用。 */
  canStep: boolean;
  /**
   * 可以切换 Input。运行中同样成立——那次切换只提交 `set_input`，由下一次推进带上新值。
   */
  canToggleInput: boolean;
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
  /**
   * 开始连续运行：反复排定推进，每一次都在上一次响应之后才排定。
   * @returns 置为运行中之后的快照；不可开始时原样返回当前快照。
   */
  start(): Promise<WorkspaceSnapshot>;
  /**
   * 暂停连续运行，并取消已经排定的下一次推进；已积累的时序状态保持不变。
   * @returns 置为已暂停之后的快照。
   */
  pause(): Promise<WorkspaceSnapshot>;
  /**
   * 从暂停处继续连续运行，不重放也不丢弃已推进的步数。
   * @returns 置为运行中之后的快照；不可继续时原样返回当前快照。
   */
  resume(): Promise<WorkspaceSnapshot>;
  /** 推进仿真一个 tick，并用响应带回的输出 Port 快照刷新信号。 */
  step(): Promise<WorkspaceSnapshot>;
  /** 切换一个 Input；运行中只提交 `set_input`，停止或暂停时提交后立刻求值。 */
  toggleInput(key: InputKey): Promise<WorkspaceSnapshot>;
  snapshot(): WorkspaceSnapshot;
  /**
   * 订阅连续运行自行推进产生的快照。
   * 调用方主动发起的操作会直接返回快照，因此只有后台推进需要这条通知通道。
   * @param listener 每一拍推进完成（含推进失败导致的自暂停）后收到最新快照。
   * @returns 取消订阅的函数。
   */
  subscribe(listener: (snapshot: WorkspaceSnapshot) => void): () => void;
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
    simulationState: "stopped",
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
  // 「可以做某事」由一个共同的可用性条件加上互斥的运行态组成，不再用一个布尔表达全部运行语义。
  const runnable = state.engineState === "ready" && state.runtimeBindings !== null && !state.isBusy;
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
    canStart: runnable && state.simulationState === "stopped",
    canPause: state.simulationState === "running",
    canResume: runnable && state.simulationState === "paused",
    canStep: runnable && state.simulationState !== "running",
    canToggleInput: state.engineState === "ready" && state.runtimeBindings !== null,
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
 * @param options 可注入的连续运行调度器；省略时使用 `setTimeout`。
 * @returns 可观察快照，并提供文档推送、求值、单步与连续运行的工作区模块。
 */
export function createWorkspace(adapter: EngineAdapter, options: WorkspaceOptions = {}): Workspace {
  const scheduler = options.scheduler ?? defaultTickScheduler;
  const state = createInitialState();

  /**
   * 引擎调用队列：运行中的推进、输入提交与结构推送共用这一条队列，任意两条请求不交错。
   * 一条请求进行中到达的请求会排队等待，而不是被丢弃或与前者并发。
   */
  let engineQueue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = engineQueue.then(task, task);
    engineQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  /** 连续运行期间每一拍完成后通知的订阅者；调用方发起的操作不需要这条通道。 */
  const listeners = new Set<(snapshot: WorkspaceSnapshot) => void>();

  function notifyAdvanced(): void {
    if (listeners.size === 0) return;
    const snapshot = createWorkspaceSnapshot(state);
    for (const listener of [...listeners]) listener(snapshot);
  }

  /** 已排定但还没执行的下一次推进的取消函数；没有排定时为 null。 */
  let cancelScheduledTick: (() => void) | null = null;

  function cancelTick(): void {
    cancelScheduledTick?.();
    cancelScheduledTick = null;
  }

  /** 在收到上一次响应之后才排定下一次推进：引擎变慢时自动降速，不会有两个推进同时在飞。 */
  function scheduleTick(): void {
    if (state.simulationState !== "running" || state.runtimeBindings === null) return;
    cancelScheduledTick = scheduler.schedule(TICK_INTERVAL_MS, () => {
      cancelScheduledTick = null;
      void advanceOnce();
    });
  }

  async function advanceOnce(): Promise<void> {
    const bindings = state.runtimeBindings;
    if (state.simulationState !== "running" || bindings === null) return;
    // 自动推进不追加波形记录：波形历史只记录用户发起的推进。
    const advanced = await enqueue(() => stepInternal(bindings, { record: false }));
    if (!advanced) {
      // 推进失败时不继续排定，避免每一拍都重复报同一个错误；用户修好电路后可以继续。
      state.simulationState = "paused";
      state.message = `${state.operationError ?? "推进失败。"}已暂停在第 ${state.simulationStep} 步。`;
      notifyAdvanced();
      return;
    }
    scheduleTick();
    notifyAdvanced();
  }

  /** 把提交后的输入值写回状态，并同步 `inputA` / `inputB` 兼容投影。 */
  function commitInputValues(values: Record<InputKey, BinarySignal>): void {
    state.inputValues = values;
    const bindings = state.runtimeBindings;
    if (bindings === null) return;
    const [first, second] = bindings.inputs;
    if (first !== undefined) state.inputA = values[first.key] ?? state.inputA;
    if (second !== undefined) state.inputB = values[second.key] ?? state.inputB;
  }

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

      commitInputValues(Object.fromEntries(committedValues.map(({ binding, value }) => [binding.key, value])));
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
    }
  }

  /**
   * 把一份文档按顺序推送到引擎：先建全部 Component，再建全部 Connection。
   * 任何一步失败都按创建顺序反向补偿，不留下半成品结构。
   */
  async function loadCircuitInternal(document: CircuitDocument): Promise<CircuitLoadResult> {
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

  /** 把整份文档推送到引擎；调用方负责保证它排在引擎调用队列里。 */
  function loadCircuit(document: CircuitDocument): Promise<CircuitLoadResult> {
    if (state.hasCircuit || state.isBusy || state.engineState !== "ready") {
      return Promise.resolve({ snapshot: createWorkspaceSnapshot(state), bindings: null });
    }
    return enqueue(() => loadCircuitInternal(document));
  }

  function rebindSimulation(bindings: SimulationBindings | null): WorkspaceSnapshot {
    // 结构修改把连续运行切到暂停：电路变了，要不要接着跑由用户显式决定。
    if (state.simulationState === "running") {
      cancelTick();
      state.simulationState = "paused";
      state.message = "电路结构已修改，连续运行已暂停。";
    }
    state.runtimeBindings = bindings ? runtimeBindingsFrom(bindings) : null;
    state.signals = {};
    state.outputValue = "X";
    if (state.runtimeBindings) {
      commitInputValues(valuesForBindings(state.runtimeBindings, state.inputValues, state.inputA, state.inputB));
    } else {
      state.simulationState = "stopped";
    }
    return createWorkspaceSnapshot(state);
  }

  async function runSimulationQueued(): Promise<WorkspaceSnapshot> {
    const bindings = state.runtimeBindings;
    if (bindings === null) return createWorkspaceSnapshot(state);
    state.isBusy = true;
    try {
      await runSimulationInternal(bindings);
    } finally {
      state.isBusy = false;
    }
    return createWorkspaceSnapshot(state);
  }

  function runSimulation(): Promise<WorkspaceSnapshot> {
    return enqueue(runSimulationQueued);
  }

  /**
   * 推进一个 tick。响应一次带回电路中全部输出 Port 与每个 Output 元件接收端的当前值，
   * 因此每步只有一次跨进程往返，往返次数不随电路规模增长，波形也能记录这一拍的真实读数。
   * @param bindings 本次会话的运行时身份绑定。
   * @param options `record` 为真时追加一条波形记录；自动推进不追加，波形只记录用户发起的推进。
   */
  async function stepInternal(
    bindings: RuntimeSimulationBindings,
    options: { record: boolean },
  ): Promise<boolean> {
    state.operationError = null;
    try {
      const ticked = expectResponse(await adapter.tick(), "ticked");

      // 引擎按引擎身份回传快照，这里映射回工作区既有的 `${editorId}:${portId}` 键空间。
      const enginePorts = new Map(
        ticked.signals.map((signal) => [`${signal.componentId}:${signal.port}`, signal.value]),
      );
      const readBindings = (candidates: readonly RuntimeSignalBinding[]): Record<string, Signal> => {
        const values: Record<string, Signal> = {};
        for (const binding of candidates) {
          const value = enginePorts.get(`${binding.componentId}:${binding.port}`);
          if (value !== undefined) values[binding.key] = value;
        }
        return values;
      };
      const observedSignals = readBindings(bindings.observedSignals);
      // Output 元件的接收端也在快照里，因此 `outputValue` 与波形记录的是这一拍的真实读数。
      const outputSignals = readBindings(bindings.outputs);

      // Input 的值来自工作区已提交的输入，不由引擎快照覆盖。
      state.signals = {
        ...Object.fromEntries(
          bindings.inputs.map((binding) => [`${binding.key}:out`, state.inputValues[binding.key] ?? 0]),
        ),
        ...observedSignals,
        ...outputSignals,
      };
      if (bindings.outputs.length > 0) {
        state.outputValue = outputSignals[bindings.outputs[0].key] ?? state.outputValue;
      }
      state.simulationStep += 1;
      if (options.record) {
        state.waveform.push({
          step: state.simulationStep,
          a: state.inputA,
          b: state.inputB,
          output: state.outputValue,
        });
      }
      // 引用工作区自己的步数：引擎的 `ticked.step` 属于当前那份引擎仿真状态，结构变更后会归零。
      state.message = `已推进到第 ${state.simulationStep} 步。`;
      return true;
    } catch (error) {
      state.message = errorMessage(error, "推进失败。");
      state.operationError = state.message;
      if (!(error instanceof ProtocolResponseError)) state.engineState = "error";
      return false;
    }
  }

  function step(): Promise<WorkspaceSnapshot> {
    if (state.simulationState === "running") return Promise.resolve(createWorkspaceSnapshot(state));
    return enqueue(async () => {
      const bindings = state.runtimeBindings;
      if (bindings === null) return createWorkspaceSnapshot(state);
      state.isBusy = true;
      try {
        await stepInternal(bindings, { record: true });
      } finally {
        state.isBusy = false;
      }
      return createWorkspaceSnapshot(state);
    });
  }

  function toggleInput(key: InputKey): Promise<WorkspaceSnapshot> {
    const bindings = state.runtimeBindings;
    if (bindings === null) return Promise.resolve(createWorkspaceSnapshot(state));
    const binding = bindings.inputs.find((candidate) => candidate.key === key);
    if (binding === undefined) return Promise.resolve(createWorkspaceSnapshot(state));
    const value = (state.inputValues[key] === 1 ? 0 : 1) as BinarySignal;
    const nextInputValues: Record<InputKey, BinarySignal> = { ...state.inputValues, [key]: value };
    // 运行中只提交 set_input，不额外 settle；下一次推进自然会带上新值。
    const running = state.simulationState === "running";
    return enqueue(async () => {
      if (!running) {
        state.isBusy = true;
        try {
          await runSimulationInternal(bindings, nextInputValues);
        } finally {
          state.isBusy = false;
        }
        return createWorkspaceSnapshot(state);
      }
      state.operationError = null;
      try {
        expectResponse(await adapter.setInput(binding.componentId, value), "input_set");
        commitInputValues(nextInputValues);
        state.message = "输入已提交，将在下一次推进时生效。";
      } catch (error) {
        state.message = errorMessage(error, "输入设置失败。");
        state.operationError = state.message;
        if (!(error instanceof ProtocolResponseError)) state.engineState = "error";
      }
      return createWorkspaceSnapshot(state);
    });
  }

  async function start(): Promise<WorkspaceSnapshot> {
    if (!createWorkspaceSnapshot(state).canStart) return createWorkspaceSnapshot(state);
    state.operationError = null;
    state.simulationState = "running";
    state.message = "正在连续推进。";
    scheduleTick();
    return createWorkspaceSnapshot(state);
  }

  async function pause(): Promise<WorkspaceSnapshot> {
    if (state.simulationState !== "running") return createWorkspaceSnapshot(state);
    cancelTick();
    state.simulationState = "paused";
    state.message = `已暂停在第 ${state.simulationStep} 步。`;
    return createWorkspaceSnapshot(state);
  }

  async function resume(): Promise<WorkspaceSnapshot> {
    if (!createWorkspaceSnapshot(state).canResume) return createWorkspaceSnapshot(state);
    state.operationError = null;
    state.simulationState = "running";
    state.message = "正在连续推进。";
    scheduleTick();
    return createWorkspaceSnapshot(state);
  }

  return {
    checkEngine,
    loadCircuit,
    rebindSimulation,
    runSimulation,
    start,
    pause,
    resume,
    step,
    toggleInput,
    snapshot: () => createWorkspaceSnapshot(state),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
