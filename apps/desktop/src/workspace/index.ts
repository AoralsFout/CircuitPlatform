import type { ComponentKindName, EngineResponse, PortSpec, Signal } from "@circuit-platform/protocol";
import { createEngineCallQueue, type EngineCallQueue } from "./engineQueue.ts";

/** 输入设置项的稳定键；键是编辑器组件 ID，与引擎身份无关。 */
export type InputKey = string;
/**
 * 一位输入信号的取值。
 * Input 只能被驱动到确定的 `0` 或 `1`——`X` 只可能来自引擎读数。这里保留字面量联合而不是
 * 直接用协议的宽 `Signal`，输入侧的取值因此在编译期仍有约束：`?? "0"` 之类的兜底写错会报错。
 */
export type BinarySignal = "0" | "1";
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
  /**
   * 引擎调用的串行化队列；省略时新建一条。
   * 编辑器的结构提交经 `CircuitEnginePort` 走另一条调用路径，只有把**同一条**队列同时交给
   * 工作区与那个端口，运行中的推进才与结构提交排在同一队里（见 `useWorkspace`）。
   */
  queue?: EngineCallQueue;
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
  /** `ports` 省略时引擎回退到内置定义；省略是内置元件的常规路径。 */
  addComponent(kind: ComponentKindName, ports?: readonly PortSpec[]): Promise<EngineResponse>;
  /** 整体替换一个 Component 的端口清单，并带回因本次改宽而转为悬空的 Connection 身份。 */
  setPortWidth(componentId: number, ports: readonly PortSpec[]): Promise<EngineResponse>;
  addConnection(
    source: { componentId: number; port: string },
    target: { componentId: number; port: string },
  ): Promise<EngineResponse>;
  removeComponent(componentId: number): Promise<EngineResponse>;
  removeConnection(connectionId: number): Promise<EngineResponse>;
  setInput(componentId: number, value: Signal): Promise<EngineResponse>;
  settle(): Promise<EngineResponse>;
  tick(): Promise<EngineResponse>;
  reset(): Promise<EngineResponse>;
  getSignal(componentId: number, port: string): Promise<EngineResponse>;
}

/**
 * 一份电路文档中参与结构推送的最小投影；`EditorDocument` 结构上是它的超集。
 * 工作区不依赖编辑器模块，只接受它理解的结构子集。
 */
export interface CircuitDocument {
  /**
   * 端口清单是位宽的唯一权威来源。内置元件省略它，由引擎回退到内置定义并在响应里回传；
   * 前端只在数据驱动的元件上才自己生成清单，不内置一份无人校验的副本。
   */
  components: readonly { id: string; kind: ComponentKindName; ports?: readonly PortSpec[] }[];
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
  /**
   * 每个元件由引擎回传的端口清单，键为编辑器元件 ID。
   * 运行时要读哪些端口由它推导，因此前端不需要再内置一份 kind → 端口名的副本。
   */
  ports?: Readonly<Partial<Record<string, readonly PortSpec[]>>>;
  connections?: Readonly<Partial<Record<string, number>>>;
}

export interface CircuitLoadResult {
  snapshot: WorkspaceSnapshot;
  bindings: SimulationBindings | null;
  /**
   * 推送过程中由 `component_added` 收集到的端口清单，键为编辑器元件 ID。
   * 编辑器文档用它填自己的端口清单，不必在推送前先写一份内置副本。
   */
  ports: Readonly<Record<string, readonly PortSpec[]>>;
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
   * 工作区自当前电路加载或上次重置以来**推进电路**的次数，是界面上唯一的步数。
   * 推进指 `step` 与连续运行发出的 tick；把电路求值到稳定（加载后的首次求值、重置后的
   * 重新求值、结构变更后的读数刷新）不是推进，不加这个计数——否则同一个「刚求值到稳定的
   * 状态」会一处显示第 1 步、另一处显示第 0 步。
   * 引擎的 `ticked.step` 是另一个量：它属于当下那份引擎仿真状态，结构变更后仍保留，
   * 重置才归零。
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
  /** 可以把仿真恢复到初始状态：清空全部运行时状态，但保留 Circuit 结构。 */
  canReset: boolean;
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
  /**
   * 由编辑器会话在结构提交后更新仿真所使用的临时引擎身份。
   * 只有拓扑真的变了才把连续运行切到暂停，并按元件身份保留已积累的读数；内容相同的绑定原样返回。
   */
  rebindSimulation(bindings: SimulationBindings | null): WorkspaceSnapshot;
  /**
   * 按当前输入重新求值到稳定，并刷新全部可展示读数；结构变更之后由调用方触发，用来把
   * 新元件与新连接上的读数补齐。
   * 它**不推进电路**：不加步数、不追加波形记录，因此不是「运行一次」的入口——界面上唯一的
   * 推进原语是 `step` 与连续运行。
   */
  refreshReadings(): Promise<WorkspaceSnapshot>;
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
  /**
   * 把仿真恢复到刚加载后的状态：全部输出回到初始值、Clock 回到 `0`、D Flip-Flop 的 `q` 回到 `X`、
   * 步数归零、波形历史与信号读数清空、运行状态回到 `stopped`。Circuit 结构不变。
   * @returns 重置之后的快照；不可重置时原样返回当前快照。
   */
  reset(): Promise<WorkspaceSnapshot>;
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
  /**
   * 上一次绑定的原始形态。仿真只关心从它推导出的运行时身份，但「拓扑是否真的变了」必须拿
   * 原始绑定来比：连接不参与运行时身份，却是实打实的拓扑。
   */
  lastBindings: SimulationBindings | null;
  simulationStep: number;
  waveform: WaveformPoint[];
}

interface RuntimeSignalBinding {
  key: string;
  componentId: number;
  port: string;
}

interface RuntimeInputBinding {
  key: string;
  componentId: number;
  /** Input 元件被驱动的输出端口名；来自引擎回传的端口清单，不是前端写死的常量。 */
  port: string;
}

interface RuntimeSimulationBindings {
  inputs: readonly RuntimeInputBinding[];
  /** 文档中全部 Output 元件的接收端；每个 Output 单独读取自己的值。 */
  outputs: readonly RuntimeSignalBinding[];
  observedSignals: readonly RuntimeSignalBinding[];
}

/**
 * 比较两份「编辑器 ID → 引擎 ID」映射。键集合与取值都一致才算没变。
 * @param left 上一份映射。
 * @param right 这一份映射。
 * @returns 两份映射表达同一批引擎身份时返回 true。
 */
function sameIdentityMap(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean {
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => left[key] === right[key]);
}

/**
 * 判断一次绑定更新是否真的改动了拓扑。
 * 只移动元件或改 Route 的编辑不会分配新的引擎身份，`publishBindings` 也不会为它们触发；
 * 因此这里相等就表示电路结构没变，运行态与已积累的读数都不该被动到。
 * @param left 上一份绑定。
 * @param right 这一份绑定。
 * @returns 元件、连接与元件类型三份映射都一致时返回 true。
 */
function sameBindings(left: SimulationBindings | null, right: SimulationBindings | null): boolean {
  if (left === null || right === null) return left === right;
  return sameIdentityMap(left.components, right.components) &&
    sameIdentityMap(left.connections ?? {}, right.connections ?? {}) &&
    sameIdentityMap(left.componentKinds ?? {}, right.componentKinds ?? {});
}

/** 信号读数的键空间：编辑器元件 ID 加端口名，画布、检查器与波形共用同一套键。 */
function signalKey(editorComponentId: string, port: string): string {
  return `${editorComponentId}:${port}`;
}

/**
 * 按新的绑定集合裁剪信号读数：仍然存在的键保留当前值，消失的键连同它的值一起丢弃。
 * 这是引擎「结构变更按元件身份保留状态」在编辑器键空间上的同一条规则。
 * @param signals 上一次求值得到的读数，键为 `${editorComponentId}:${portId}`。
 * @param bindings 结构变更后重新推导出的运行时绑定。
 * @returns 只保留当前绑定里仍然存在的键的新读数表。
 */
function pruneSignals(
  signals: Readonly<Record<string, Signal>>,
  bindings: RuntimeSimulationBindings,
): Record<string, Signal> {
  const liveKeys = new Set([
    ...bindings.inputs.map((binding) => signalKey(binding.key, binding.port)),
    ...bindings.observedSignals.map((binding) => binding.key),
    ...bindings.outputs.map((binding) => binding.key),
  ]);
  return Object.fromEntries(Object.entries(signals).filter(([key]) => liveKeys.has(key)));
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

function createInitialState(): MutableState {
  return {
    engineState: "checking",
    engineName: "未连接",
    message: "正在连接 C++ 仿真引擎…",
    operationError: null,
    isBusy: false,
    simulationState: "stopped",
    inputA: "1",
    inputB: "1",
    inputValues: {},
    signals: {},
    outputValue: "X",
    hasCircuit: false,
    runtimeBindings: null,
    lastBindings: null,
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
    // 重置在任何运行态下都成立：运行中重置同样是「从现在回到初始状态」。
    canReset: runnable,
    canToggleInput: state.engineState === "ready" && state.runtimeBindings !== null,
  };
}

/**
 * 从编辑器绑定推导本次求值需要提交和读取的运行时身份。
 * 收集文档中全部 Input 与全部 Output 元件，不对电路形状做任何假设。
 *
 * 要读哪些端口完全由引擎回传的端口清单推导：Input 被驱动的端口、Output 的接收端，以及其余
 * 元件自己的输出端口。前端因此不再内置一份 kind → 端口名的副本——那正是 ADR 0016 里
 * 「前端声明 clk、引擎期望 clock」那类分歧的来源。
 */
function runtimeBindingsFrom(bindings: SimulationBindings): RuntimeSimulationBindings | null {
  const components = Object.entries(bindings.components)
    .filter((entry): entry is [string, number] => entry[1] !== undefined);
  if (components.length === 0) return null;

  const kindOf = (id: string): ComponentKindName | undefined => bindings.componentKinds?.[id];
  const portsOf = (id: string): readonly PortSpec[] => bindings.ports?.[id] ?? [];
  const portsFacing = (id: string, direction: PortSpec["direction"]) =>
    portsOf(id).filter((port) => port.direction === direction);

  const inputs = components
    .filter(([id]) => kindOf(id) === "input")
    .flatMap(([key, componentId]) =>
      portsFacing(key, "output").map((port) => ({ key, componentId, port: port.name })));

  const outputs = components.flatMap(([id, componentId]) => {
    if (kindOf(id) !== "output") return [];
    return portsFacing(id, "input").map((port) => ({
      key: signalKey(id, port.name),
      componentId,
      port: port.name,
    }));
  });

  // 其余元件的读数来自它们自己的输出端口；Input 的值来自本次提交，不向引擎读。
  const observedSignals = components.flatMap(([key, componentId]) => {
    const kind = kindOf(key);
    if (kind === undefined || kind === "input" || kind === "output") return [];
    return portsFacing(key, "output").map((port) => ({
      key: signalKey(key, port.name),
      componentId,
      port: port.name,
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
    existing[binding.key] ?? (index === 0 ? inputA : index === 1 ? inputB : "0"),
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
   * 引擎调用队列：运行中的推进、输入提交与工作区自己发起的结构推送共用这一条队列，
   * 任意两条请求不交错；一条请求进行中到达的请求会排队等待，而不是被丢弃或与前者并发。
   *
   * 编辑器发出的结构提交不经过 `Workspace`，它由 `createProtocolEnginePort` 直接调用 adapter。
   * 那条路径要排进同一条队列，就必须拿到同一个队列对象——`useWorkspace` 因此在这里注入，
   * 并把同一个实例转交给编辑器端口。只建队列而不共享，等于结构提交仍在队列外面。
   */
  const queue = options.queue ?? createEngineCallQueue();

  /**
   * 统一记录一次引擎操作失败：可展示的文案进 message 与 operationError。
   * 只有传输层故障（拿不到协议响应）才把引擎打成 `error`；协议内的业务错误说明引擎还在，
   * 保留 `ready` 让用户能继续操作。
   * @param error 捕获到的异常。
   * @param fallback 拿不到异常信息时的兜底文案。
   */
  function recordEngineFailure(error: unknown, fallback: string): void {
    state.message = errorMessage(error, fallback);
    state.operationError = state.message;
    if (!(error instanceof ProtocolResponseError)) state.engineState = "error";
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
    const advanced = await queue.enqueue(() => stepInternal(bindings, { record: false }));
    if (!advanced) {
      // 推进失败时不继续排定，避免每一拍都重复报同一个错误；用户修好电路后可以继续。
      state.simulationState = "paused";
      state.message = `${state.operationError ?? "推进失败。"}${pausedAtStepMessage()}`;
      notifyAdvanced();
      return;
    }
    scheduleTick();
    notifyAdvanced();
  }

  /** 「已暂停在第 N 步」的文案；暂停与推进失败自暂停共用同一种说法。 */
  function pausedAtStepMessage(): string {
    return `已暂停在第 ${state.simulationStep} 步。`;
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

  async function addComponent(
    kind: ComponentKindName,
    ports?: readonly PortSpec[],
  ): Promise<{ componentId: number; ports: readonly PortSpec[] }> {
    const response = expectResponse(await adapter.addComponent(kind, ports), "component_added");
    return { componentId: response.componentId, ports: response.ports };
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

  /**
   * 提交全部输入并求值到稳定，然后刷新可展示读数。
   *
   * 「把电路求值到稳定」与「推进电路」是两件事，由 `countAsAdvance` 区分：加载后的首次求值、
   * 重置后的重新求值与结构变更后的读数刷新都只求值不推进，因此同一个刚稳定的状态不会一处
   * 记成第 1 步、另一处记成第 0 步。
   * @param bindings 本次会话的运行时身份绑定。
   * @param nextInputValues 本次要提交的输入值；省略时提交当前值。
   * @param options `countAsAdvance` 为真时把这次求值计为一次推进并追加波形记录，为假时两者都不做。
   */
  async function submitInputsAndSettle(
    bindings: RuntimeSimulationBindings | null,
    nextInputValues: Readonly<Record<InputKey, BinarySignal>> = state.inputValues,
    options: { countAsAdvance: boolean },
  ): Promise<boolean> {
    if (!bindings) return false;
    state.operationError = null;
    try {
      const committedValues = bindings.inputs.map((binding) => ({
        binding,
        value: nextInputValues[binding.key] ?? "0",
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
        ...Object.fromEntries(
          committedValues.map(({ binding, value }) => [signalKey(binding.key, binding.port), value]),
        ),
        ...observedSignals,
        ...outputSignals,
      };
      if (options.countAsAdvance) {
        state.simulationStep += 1;
        state.waveform.push({
          step: state.simulationStep,
          a: state.inputA,
          b: state.inputB,
          output: state.outputValue,
        });
      }
      state.message = "仿真已稳定，信号已更新。";
      return true;
    } catch (error) {
      recordEngineFailure(error, "仿真失败。");
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
    const ports: Record<string, readonly PortSpec[]> = {};
    const createdComponentIds: number[] = [];
    const createdConnectionIds: number[] = [];
    try {
      for (const component of document.components) {
        // 文档带了端口清单就一并送达（数据驱动的元件）；内置元件不带，由引擎回退到内置定义。
        const added = await addComponent(component.kind, component.ports);
        createdComponentIds.push(added.componentId);
        components[component.id] = added.componentId;
        componentKinds[component.id] = component.kind;
        ports[component.id] = added.ports;
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
      const bindings: SimulationBindings = { components, connections, componentKinds, ports };
      const runtimeBindings = runtimeBindingsFrom(bindings);
      state.runtimeBindings = runtimeBindings;
      state.lastBindings = bindings;
      if (runtimeBindings) {
        state.inputValues = valuesForBindings(runtimeBindings, state.inputValues, state.inputA, state.inputB);
      }
      state.hasCircuit = true;
      state.message = "电路已就绪，试着切换输入。";
      // 加载后的首次稳定求值不是一次推进：它把电路求值到稳定并填满读数，但不加步数、
      // 不追加波形记录。重置之后的重新求值走同一条规则，两者因此都停在「第 0 步」。
      await submitInputsAndSettle(state.runtimeBindings, state.inputValues, { countAsAdvance: false });
      state.isBusy = false;
      return { snapshot: createWorkspaceSnapshot(state), bindings, ports };
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
      state.lastBindings = null;
      state.hasCircuit = false;
    } finally {
      state.isBusy = false;
    }
    return { snapshot: createWorkspaceSnapshot(state), bindings: null, ports: {} };
  }

  /** 把整份文档推送到引擎；调用方负责保证它排在引擎调用队列里。 */
  function loadCircuit(document: CircuitDocument): Promise<CircuitLoadResult> {
    if (state.hasCircuit || state.isBusy || state.engineState !== "ready") {
      return Promise.resolve({ snapshot: createWorkspaceSnapshot(state), bindings: null, ports: {} });
    }
    return queue.enqueue(() => loadCircuitInternal(document));
  }

  function rebindSimulation(bindings: SimulationBindings | null): WorkspaceSnapshot {
    // 只有拓扑真的变了才算结构修改。位置、Route 与线色不会分配新的引擎身份，
    // 因此这类更新既不该停掉连续运行，也不该动到已积累的读数。
    if (sameBindings(state.lastBindings, bindings)) {
      return createWorkspaceSnapshot(state);
    }

    // 结构修改把连续运行切到暂停：电路变了，要不要接着跑由用户显式决定。
    if (state.simulationState === "running") {
      cancelTick();
      state.simulationState = "paused";
      state.message = "电路结构已修改，连续运行已暂停。";
    }

    state.lastBindings = bindings;
    state.runtimeBindings = bindings ? runtimeBindingsFrom(bindings) : null;
    if (state.runtimeBindings) {
      // 按元件身份保留已积累的运行时状态：还在的端口读数留着，消失的键连同它的值一起丢弃。
      // 引擎侧同样按身份保留，因此这里留下的读数下一拍就能对上。
      state.signals = pruneSignals(state.signals, state.runtimeBindings);
      commitInputValues(valuesForBindings(state.runtimeBindings, state.inputValues, state.inputA, state.inputB));
    } else {
      // 没有任何元件可仿真：读数没有载体，运行态回到起点。
      state.signals = {};
      state.outputValue = "X";
      state.simulationState = "stopped";
    }
    return createWorkspaceSnapshot(state);
  }

  async function refreshReadingsQueued(): Promise<WorkspaceSnapshot> {
    const bindings = state.runtimeBindings;
    if (bindings === null) return createWorkspaceSnapshot(state);
    state.isBusy = true;
    try {
      await submitInputsAndSettle(bindings, state.inputValues, { countAsAdvance: false });
    } finally {
      state.isBusy = false;
    }
    return createWorkspaceSnapshot(state);
  }

  function refreshReadings(): Promise<WorkspaceSnapshot> {
    return queue.enqueue(refreshReadingsQueued);
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

      // 引擎按引擎身份回传快照，这里按同一套「引擎身份 + 端口名」的键查回工作区的编辑器键。
      const enginePorts = new Map(
        ticked.signals.map((signal) => [signalKey(String(signal.componentId), signal.port), signal.value]),
      );
      const readBindings = (candidates: readonly RuntimeSignalBinding[]): Record<string, Signal> => {
        const values: Record<string, Signal> = {};
        for (const binding of candidates) {
          const value = enginePorts.get(signalKey(String(binding.componentId), binding.port));
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
          bindings.inputs.map((binding) => [
            signalKey(binding.key, binding.port),
            state.inputValues[binding.key] ?? "0",
          ]),
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
      recordEngineFailure(error, "推进失败。");
      return false;
    }
  }

  function step(): Promise<WorkspaceSnapshot> {
    if (state.simulationState === "running") return Promise.resolve(createWorkspaceSnapshot(state));
    return queue.enqueue(async () => {
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

  /**
   * 把仿真恢复到刚加载后的状态。重置是用户显式要求的清空，与「结构变更保留运行时状态」是两件
   * 互相独立的事：它只清运行时状态，不碰 `Circuit` 结构，因此元件与连接的引擎身份原样保留。
   * 重置是一条独立请求，不是推进的一个参数。
   */
  function reset(): Promise<WorkspaceSnapshot> {
    if (!createWorkspaceSnapshot(state).canReset) return Promise.resolve(createWorkspaceSnapshot(state));
    // 同步取消已排定的推进：重置必须立刻把连续运行停下来，而不是等下一拍落地。
    cancelTick();
    state.simulationState = "stopped";
    return queue.enqueue(async () => {
      const bindings = state.runtimeBindings;
      state.isBusy = true;
      try {
        expectResponse(await adapter.reset(), "reset_done");
        state.operationError = null;
        // 运行时状态是整份清空的：步数、波形历史与信号读数都不再属于重置后的那份仿真。
        state.simulationStep = 0;
        state.waveform = [];
        state.signals = {};
        state.outputValue = "X";
        // 重置把引擎里的 Input 也清回了初值，因此必须重新提交当前输入并求值到稳定，
        // 否则画布会停在「全部 X」上。这次求值不计步数，也不追加波形记录。
        if (bindings !== null) {
          await submitInputsAndSettle(bindings, state.inputValues, { countAsAdvance: false });
        }
        if (state.operationError === null) state.message = "已重置到初始状态。";
      } catch (error) {
        recordEngineFailure(error, "重置失败。");
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
    const value: BinarySignal = state.inputValues[key] === "1" ? "0" : "1";
    const nextInputValues: Record<InputKey, BinarySignal> = { ...state.inputValues, [key]: value };
    // 运行中只提交 set_input，不额外 settle；下一次推进自然会带上新值。
    const running = state.simulationState === "running";
    return queue.enqueue(async () => {
      if (!running) {
        state.isBusy = true;
        try {
          await submitInputsAndSettle(bindings, nextInputValues, { countAsAdvance: true });
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
        recordEngineFailure(error, "输入设置失败。");
      }
      return createWorkspaceSnapshot(state);
    });
  }

  /**
   * 让运行循环跑起来：开始与继续是同一个动作，区别只在进入前的运行态。
   * 调度器每排定一次就只执行一拍，因此这里只负责排定第一拍。
   */
  function beginRunning(): WorkspaceSnapshot {
    state.operationError = null;
    state.simulationState = "running";
    state.message = "正在连续推进。";
    scheduleTick();
    return createWorkspaceSnapshot(state);
  }

  async function start(): Promise<WorkspaceSnapshot> {
    if (!createWorkspaceSnapshot(state).canStart) return createWorkspaceSnapshot(state);
    return beginRunning();
  }

  async function pause(): Promise<WorkspaceSnapshot> {
    if (state.simulationState !== "running") return createWorkspaceSnapshot(state);
    cancelTick();
    state.simulationState = "paused";
    state.message = pausedAtStepMessage();
    return createWorkspaceSnapshot(state);
  }

  async function resume(): Promise<WorkspaceSnapshot> {
    if (!createWorkspaceSnapshot(state).canResume) return createWorkspaceSnapshot(state);
    return beginRunning();
  }

  return {
    checkEngine,
    loadCircuit,
    rebindSimulation,
    refreshReadings,
    start,
    pause,
    resume,
    step,
    reset,
    toggleInput,
    snapshot: () => createWorkspaceSnapshot(state),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
