import type { ComponentKindName, EngineResponse, PortSpec, Signal } from "@circuit-platform/protocol";
import {
  engineComponentIds,
  engineConnectionIds,
  type EditorComponentKind,
  type EditorPortSource,
  type EngineComponentBinding,
  type EngineConnectionBinding,
  type EnginePortRef,
  type InternalComponentDescriptor,
} from "../editor/index.ts";
import { createEngineCallQueue, type EngineCallQueue } from "./engineQueue.ts";

export {
  createDocumentRuntime,
  type DocumentProjectState,
  type DocumentRuntime,
  type DocumentRuntimeOptions,
  type DocumentRuntimeSnapshot,
  type DocumentViewState,
  type PendingFileAction,
} from "./documentRuntime.ts";
export {
  createDocumentCoordinator,
  createWindowDocumentRuntimeFactory,
  type CoordinatorCloseResult,
  type CoordinatorNewDocumentResult,
  type CoordinatorOpenResult,
  type CoordinatorProjectReader,
  type CoordinatorProjectWriter,
  type CoordinatorSaveConflict,
  type DocumentCoordinator,
  type DocumentCoordinatorOptions,
  type DocumentCoordinatorSnapshot,
  type DocumentRuntimeFactory,
  type DocumentRuntimeFactoryContext,
  type DocumentTabSnapshot,
} from "./documentCoordinator.ts";

/** 输入设置项的稳定键；键是编辑器组件 ID，与引擎身份无关。 */
export type InputKey = string;
/**
 * 一位输入信号的取值。用户可以任意驱动一位到 `0`、`1` 或 `X`——`X` 表达「这一位未知」，
 * 与引擎读数里的 `X` 是同一个值，某一位未知不影响同一个值里的其余位。
 */
export type InputBit = "0" | "1" | "X";
/**
 * 一个 Input Component 当前被驱动的多位取值：逐位文本，长度等于该端口声明的位宽，
 * 最左边是最高位（`[N-1:0]`），与画布和波形上的位序一致。
 *
 * 这里保留宽 `string` 而不是字面量联合：位宽让合法取值的集合不再有限。需要编译期约束的地方
 * （例如「左键点击的结果必然是确定的」）另用更窄的联合。
 */
export type InputValue = string;
/**
 * 确定的一位取值 `0` / `1`。它标记出那些**不可能**是 `X` 的位置——例如左键点击一位之后的结果，
 * 点击的意思是「让它变成确定的」，因此 `X` 不在它的值域里。
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

/**
 * 波形历史上限：超出后丢弃最旧的点，长时间连续运行不会耗尽内存。
 * 第一版固定为常量，不提供配置；记录的键空间与行投影不受裁剪影响。
 */
const WAVEFORM_HISTORY_LIMIT = 1000;

const defaultTickScheduler: TickScheduler = {
  schedule(delayMs, run) {
    const handle = setTimeout(run, delayMs);
    return () => clearTimeout(handle);
  },
};

/**
 * 引擎进程死亡时传输层错误消息的稳定前缀。
 * Electron IPC 只把 Error 的 message 带到渲染层，识别「进程死亡」靠这段文案；它与
 * `apps/desktop/electron/engine-client.cjs` 里生成的死亡错误共用同一句，两处必须同步修改。
 */
const ENGINE_PROCESS_EXITED_MARKER = "C++ 引擎进程已退出";

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
  /**
   * 引擎进程代号：主进程每次成功拉起新进程时递增。
   * 同号表示健康检查看到的仍是同一个进程（电路还在引擎里）；缺省表示调用方无法提供
   * （测试假引擎），此时恢复流程按「进程已更换」处理。
   */
  processEpoch?: number;
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
  components: readonly { id: string; kind: EditorComponentKind; ports?: readonly PortSpec[]; flatId?: string }[];
  connections: readonly {
    id: string;
    source: { componentId: string; port: string };
    target: { componentId: string; port: string };
    flatId?: string;
  }[];
  /** 可选的层次投影来源；工作区仍只负责扁平 Circuit 的生命周期。 */
  portSources?: Readonly<Partial<Record<string, Readonly<Partial<Record<string, EditorPortSource>>>>>>;
  /** 展平层次的只读内部描述；不会进入共享协议或持久化文件。 */
  internalComponents?: readonly InternalComponentDescriptor[];
}

/** 编辑器向仿真工作区提供的通用运行时绑定，不依赖任何固定示例身份。 */
export interface SimulationBindings {
  components: Readonly<Partial<Record<string, EngineComponentBinding>>>;
  componentKinds?: Readonly<Partial<Record<string, EditorComponentKind>>>;
  /**
   * 每个元件由引擎回传的端口清单，键为编辑器元件 ID。
   * 运行时要读哪些端口由它推导，因此前端不需要再内置一份 kind → 端口名的副本。
   */
  ports?: Readonly<Partial<Record<string, readonly PortSpec[]>>>;
  connections?: Readonly<Partial<Record<string, EngineConnectionBinding>>>;
  /** 稳定扁平 ID 到引擎身份；局部 projection diff 据此保留未受影响对象。 */
  flatComponents?: Readonly<Partial<Record<string, number>>>;
  flatConnections?: Readonly<Partial<Record<string, number>>>;
  componentFlatIds?: Readonly<Partial<Record<string, readonly string[]>>>;
  connectionFlatIds?: Readonly<Partial<Record<string, readonly string[]>>>;
  portSources?: Readonly<Partial<Record<string, Readonly<Partial<Record<string, EditorPortSource>>>>>>;
  /** 已解析层次的内部只读描述；只含 stable flat identity，不含 Engine ID。 */
  internalComponents?: readonly InternalComponentDescriptor[];
}

export interface InternalSignalRead {
  /** 只读表中的稳定行键；不会暴露临时引擎身份。 */
  key: string;
  flatId: string;
  port: string;
}

export interface InternalSignalReadResult {
  snapshot: WorkspaceSnapshot;
  values: Readonly<Record<string, Signal>>;
  errors: Readonly<Record<string, string>>;
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
  /**
   * 这一拍读到的信号，键为 `${editorComponentId}:${portId}`，与画布、检查器共用同一套键空间。
   *
   * 波形因此按编辑器 ID 索引，不再写死「输入 A / 输入 B / 输出」三个字段：一条记录里有哪些
   * 信号由电路决定，不由波形的形状决定。哪一行属于哪个信号由场景投影决定，增删元件后行跟着
   * 变，已经消失的信号不会被画出来，记录里残留的旧键也不会指向不存在的元件。
   */
  signals: Readonly<Record<string, Signal>>;
}

export interface WorkspaceSnapshot {
  engineState: WorkspaceEngineState;
  engineName: string;
  message: string;
  operationError: string | null;
  isBusy: boolean;
  simulationState: SimulationState;
  /** 兼容投影：按绑定顺序的前两个 Input 元件当前的多位取值。 */
  inputA: InputValue;
  inputB: InputValue;
  /** 当前所有 Input Component 的值，键为工作区绑定中的编辑器 ID。 */
  inputValues: Readonly<Record<InputKey, InputValue>>;
  /** 最近一次稳定求值后的端口信号，键为 `${editorComponentId}:${portId}`。 */
  signals: Readonly<Record<string, Signal>>;
  /** tick 返回的全部扁平端点快照，键为 `${flatId}:${port}`，供只读实例表投影。 */
  internalSignals?: Readonly<Record<string, Signal>>;
  /** 当前采用的内部描述；只含 stable source identity。 */
  internalComponents?: readonly InternalComponentDescriptor[];
  /** 内部表按需读取的可恢复诊断；不改变 Circuit 或已有 signals。 */
  internalReadError?: string | null;
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
  /**
   * 波形历史：每一拍推进（用户单步、输入切换与连续运行的自动 tick）各追加一个点。
   * 上限 1,000 点，超出丢弃最旧的点；重置清空，下一次推进从第 0 步重新记录。
   */
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
   * 可以设置 Input 的位。运行中同样成立——那次设置只提交 `set_input`，由下一次推进带上新值。
   */
  canToggleInput: boolean;
}

/**
 * 把一串逐位文本拆成位按钮组要渲染的位。
 * @param value 长度等于端口位宽的逐位文本。
 * @returns 从最高位到最低位排列的位；下标 0 是文本的最左一位，也是最高位。
 */
export function inputBitsOf(value: InputValue): readonly InputBit[] {
  return [...value].map((char): InputBit => (char === "0" ? "0" : char === "1" ? "1" : "X"));
}

/**
 * 左键点击一位之后的取值：在 `0` 与 `1` 之间切换。
 *
 * `X` 视作非 `1`，因此点击一个未知位会先把它变成 `1`。这条规则与改造前「整块切换一个 1 位
 * 输入」的 `=== "1" ? "0" : "1"` 同源，只是作用范围从整个 Input 缩到了一位；返回值收窄成
 * `BinarySignal` 是因为点击的目的就是让这一位变成确定的。
 * @param bit 这一位当前的取值。
 * @returns 点击后的取值，必然是确定的 `0` 或 `1`。
 */
export function toggledInputBit(bit: InputBit): BinarySignal {
  return bit === "1" ? "0" : "1";
}

/**
 * 替换多位取值里的一位；越界下标原样返回。
 * @param value 当前的逐位文本。
 * @param index 目标位在文本里的下标：0 是最左、也是最高位。
 * @param bit 这一位的新取值。
 * @returns 长度与原值相同的新逐位文本。
 */
export function withInputBit(value: InputValue, index: number, bit: InputBit): InputValue {
  if (!Number.isInteger(index) || index < 0 || index >= value.length) return value;
  return `${value.slice(0, index)}${bit}${value.slice(index + 1)}`;
}

/** 合法的逐位文本：只含 `0` / `1` / `X`。 */
const INPUT_BIT_PATTERN = /^[01X]+$/;

/**
 * 把一个 Input 的取值对齐到端口**当前**的位宽。
 *
 * 候选取值有三个来源——用户刚拨的位、上一次求值留下的快照、新绑定推导出的默认值——它们的长度
 * 不一定等于端口当前的位宽：改宽之后旧值就短了或长了，而引擎按端口位宽校验长度，对不上会以
 * `invalid_width` 拒绝。长度或字符集对不上时整体回到默认值（全 `0`，与「新增输入默认值为 0」
 * 一致），不发明按位对齐，也不做零扩展或截断——这与引擎「位宽变化的端口按初值重建」是同一条规则。
 * @param value 候选取值；`undefined` 表示这个输入还没有过取值。
 * @param width 端口声明的位宽。
 * @returns 长度等于位宽、且只含 `0` / `1` / `X` 的逐位文本。
 */
export function coerceInputValue(value: InputValue | undefined, width: number): InputValue {
  const size = Math.max(1, Math.floor(width));
  const usable = value !== undefined && value.length === size && INPUT_BIT_PATTERN.test(value);
  return usable ? value : "0".repeat(size);
}

/**
 * 工作区领域行为的窄接口：负责引擎检查、文档推送、求值、输入切换和展示快照。
 * 操作失败不会抛给 UI；错误会被记录到返回快照的 message，且保留此前可用状态。
 */
export interface OpenCircuitOptions {
  /**
   * 打开的文档里每个 Input 的初始取值（来自项目文件），键为编辑器元件 ID。
   * 提交前按引擎回传的端口位宽对齐；文件没有给出取值的输入按既有规则回退到默认值。
   */
  inputValues?: Readonly<Record<InputKey, InputValue>>;
}

export interface Workspace {
  checkEngine(): Promise<WorkspaceSnapshot>;
  /** 把一份电路文档整体推送到引擎，并返回本次会话的编辑器 ID → 引擎 ID 绑定。 */
  loadCircuit(document: CircuitDocument): Promise<CircuitLoadResult>;
  /**
   * 打开（或新建）入口：把一份文档整体替换到当前工作区，可恢复的整体替换语义。
   *
   * 与 `loadCircuit` 的区别：工作区已有电路时它不拒绝，而是先推送新文档（引擎身份单调递增，
   * 两份电路在引擎里短暂共存不冲突），全部成功后才移除旧电路的结构（旧绑定里的引擎 ID）并
   * 整体替换绑定；推送失败则按创建顺序反向补偿移除新建结构、恢复旧绑定——旧文档在引擎里的
   * 结构从头到尾没被碰过。成功后时间线清回「刚加载完」的第 0 步基线（步数与波形历史随旧文档
   * 一并清空，连续运行停回 stopped）；失败则恢复打开前的运行时状态，正在运行时停回 paused。
   * 与 `rebuildCircuit` 的区别：重建推的是空的新进程，这里推的是还留着旧电路的进程。
   */
  openCircuit(document: CircuitDocument, options?: OpenCircuitOptions): Promise<CircuitLoadResult>;
  /**
   * 引擎重启后的重建入口：把整份文档重新推送到（新的）引擎进程，整体替换引擎身份映射。
   *
   * 与 `loadCircuit` 的区别：它不做 `hasCircuit` 守卫——工作区记着的旧电路已经随旧进程
   * 消失，推送目标本来就是一份空白引擎；它同时把运行时状态清回「刚加载完」的第 0 步基线
   * （步数与波形历史随旧进程的时间线一并清空，连续运行停回 stopped），输入值由推送路径
   * 按编辑器 ID 重新提交。调用时机由组合层掌握：健康检查确认新进程就绪之后。
   */
  rebuildCircuit(document: CircuitDocument): Promise<CircuitLoadResult>;
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
  /** 在同一文档调用队列中按需读取可见实例所需端点；不会读取隐藏或未请求端点。 */
  readInternalSignals(reads: readonly InternalSignalRead[]): Promise<InternalSignalReadResult>;
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
  /**
   * 设置一个 Input 的某一位，是输入设置里唯一的驱动入口。
   * Phase 4 的运行中语义不变：停止或暂停时提交后立刻求值，连续运行中只提交 `set_input`，
   * 由下一次推进带上新值。
   * @param key 输入设置项的稳定键。
   * @param index 目标位在取值文本里的下标：0 是最左、也是最高位。
   * @param bit 这一位的新取值。
   * @returns 提交之后的快照；键、下标或取值非法时原样返回当前快照。
   */
  setInputBit(key: InputKey, index: number, bit: InputBit): Promise<WorkspaceSnapshot>;
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
  inputA: InputValue;
  inputB: InputValue;
  inputValues: Record<InputKey, InputValue>;
  signals: Record<string, Signal>;
  internalSignals: Record<string, Signal>;
  internalComponents: readonly InternalComponentDescriptor[];
  internalReadError: string | null;
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
  refs: readonly ResolvedPortRef[];
}

interface ResolvedPortRef {
  componentId: number;
  port: string;
}

interface RuntimeInputBinding {
  key: string;
  componentId: number;
  /** Input 元件被驱动的输出端口名；来自引擎回传的端口清单，不是前端写死的常量。 */
  port: string;
  /** 该端口的位宽；提交的值必须长成这样，否则引擎会以 invalid_width 拒绝。 */
  width: number;
  /** 层次投影时一个外部输入可驱动多个扁平目标；普通输入只有一个目标。 */
  targets: readonly ResolvedPortRef[];
}

interface RuntimeSimulationBindings {
  /** 稳定扁平来源到当前引擎身份的私有映射，只用于工作区内部投影。 */
  flatComponents: Readonly<Record<string, number>>;
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
  return keys.every((key) => {
    const a = left[key];
    const b = right[key];
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b)) return false;
      const aa = [...new Set(a)];
      const bb = [...new Set(b)];
      return aa.length === bb.length && aa.every((value, index) => value === bb[index]);
    }
    return a === b;
  });
}

/**
 * 比较两份端口清单映射。
 *
 * 改位宽保留 Component 与 Connection 的引擎身份（ADR 0020），因此引擎身份映射看不出这次变更——
 * 但端口清单变了，运行时要提交的值的长度和要读的键都会跟着变。只比身份会让改宽后的绑定停留在
 * 旧位宽上，提交出去的值长度对不上，引擎以 `invalid_width` 拒绝。
 * @param left 上一份映射。
 * @param right 这一份映射。
 * @returns 每个元件的端口数量与每个端口的名字、方向、位宽、位区间都一致时返回 true。
 */
function samePortLists(
  left: Readonly<Partial<Record<string, readonly PortSpec[]>>>,
  right: Readonly<Partial<Record<string, readonly PortSpec[]>>>,
): boolean {
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => {
    const ports = left[key];
    const other = right[key];
    if (ports === undefined || other === undefined) return ports === other;
    return ports.length === other.length && ports.every((port, index) => {
      const candidate = other[index];
      return candidate !== undefined &&
        port.name === candidate.name &&
        port.direction === candidate.direction &&
        port.width === candidate.width &&
        port.bitRange?.msb === candidate.bitRange?.msb &&
        port.bitRange?.lsb === candidate.bitRange?.lsb;
    });
  });
}

/**
 * 判断一次绑定更新是否真的改动了电路结构。
 * 只移动元件或改 Route 的编辑不会分配新的引擎身份，`publishBindings` 也不会为它们触发；
 * 因此这里相等就表示电路结构没变，运行态与已积累的读数都不该被动到。
 *
 * 端口清单算结构的一部分：改位宽不换引擎身份，却是实打实的结构变更，运行时要用的位宽就在这份
 * 清单里。
 * @param left 上一份绑定。
 * @param right 这一份绑定。
 * @returns 元件、连接、元件类型与端口清单四份映射都一致时返回 true。
 */
function sameBindings(left: SimulationBindings | null, right: SimulationBindings | null): boolean {
  if (left === null || right === null) return left === right;
  return sameIdentityMap(left.components, right.components) &&
    sameIdentityMap(left.connections ?? {}, right.connections ?? {}) &&
    sameIdentityMap(left.componentKinds ?? {}, right.componentKinds ?? {}) &&
    samePortLists(left.ports ?? {}, right.ports ?? {}) &&
    sameIdentityMap(left.flatComponents ?? {}, right.flatComponents ?? {}) &&
    sameIdentityMap(left.flatConnections ?? {}, right.flatConnections ?? {}) &&
    sameStringArrayMap(left.componentFlatIds ?? {}, right.componentFlatIds ?? {}) &&
    sameStringArrayMap(left.connectionFlatIds ?? {}, right.connectionFlatIds ?? {}) &&
    samePortSources(left.portSources ?? {}, right.portSources ?? {}) &&
    sameInternalComponents(left.internalComponents, right.internalComponents);
}

function sameInternalComponents(
  left: readonly InternalComponentDescriptor[] = [],
  right: readonly InternalComponentDescriptor[] = [],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((descriptor, index) => {
    const candidate = right[index];
    if (!candidate || descriptor.ownerId !== candidate.ownerId || descriptor.flatId !== candidate.flatId ||
      descriptor.kind !== candidate.kind || descriptor.displayName !== candidate.displayName ||
      descriptor.path.length !== candidate.path.length || descriptor.path.some((part, pathIndex) => part !== candidate.path[pathIndex]) ||
      descriptor.ports.length !== candidate.ports.length) return false;
    return descriptor.ports.every((port, portIndex) => {
      const other = candidate.ports[portIndex];
      return other !== undefined && port.name === other.name && port.direction === other.direction &&
        port.width === other.width && port.bitRange?.msb === other.bitRange?.msb && port.bitRange?.lsb === other.bitRange?.lsb;
    });
  });
}

function sameStringArrayMap(
  left: Readonly<Record<string, readonly string[] | undefined>>,
  right: Readonly<Record<string, readonly string[] | undefined>>,
): boolean {
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => {
    const a = left[key] ?? [];
    const b = right[key] ?? [];
    const aa = [...new Set(a)];
    const bb = [...new Set(b)];
    return aa.length === bb.length && aa.every((value, index) => value === bb[index]);
  });
}

function samePortSources(
  left: Readonly<Record<string, Readonly<Record<string, EditorPortSource | undefined>> | undefined>>,
  right: Readonly<Record<string, Readonly<Record<string, EditorPortSource | undefined>> | undefined>>,
): boolean {
  const normalizeRef = (ref: EnginePortRef) => `${ref.componentId !== undefined ? `engine:${ref.componentId}` : `flat:${ref.flatId ?? ""}`}:${ref.port}`;
  const normalize = (source: EditorPortSource | undefined): string => JSON.stringify({
    inputTargets: source?.inputTargets?.map(normalizeRef),
    outputSource: source?.outputSource ? normalizeRef(source.outputSource) : undefined,
    outputSources: source?.outputSources?.map(normalizeRef),
    readableRefs: source?.readableRefs?.map(normalizeRef),
  });
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((componentId) => {
    const lp = left[componentId] ?? {};
    const rp = right[componentId] ?? {};
    const ports = Object.keys(lp);
    return ports.length === Object.keys(rp).length && ports.every((port) => normalize(lp[port]) === normalize(rp[port]));
  });
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

function pruneInternalSignals(
  signals: Readonly<Record<string, Signal>>,
  descriptors: readonly InternalComponentDescriptor[],
): Record<string, Signal> {
  const liveKeys = new Set(descriptors.flatMap((descriptor) => descriptor.ports.map((port) => `${descriptor.flatId}:${port.name}`)));
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
    internalSignals: {},
    internalComponents: [],
    internalReadError: null,
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
    internalSignals: { ...state.internalSignals },
    internalComponents: state.internalComponents.map((descriptor) => ({
      ...descriptor,
      path: [...descriptor.path],
      ports: descriptor.ports.map((port) => ({ ...port, ...(port.bitRange ? { bitRange: { ...port.bitRange } } : {}) })),
    })),
    internalReadError: state.internalReadError,
    hasCircuit: state.hasCircuit,
    simulationStep: state.simulationStep,
    waveform: state.waveform.map((point) => ({ step: point.step, signals: { ...point.signals } })),
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
    .filter((entry): entry is [string, EngineComponentBinding] => entry[1] !== undefined);
  if (components.length === 0) return null;

  const kindOf = (id: string): EditorComponentKind | undefined => bindings.componentKinds?.[id];
  const portsOf = (id: string): readonly PortSpec[] => bindings.ports?.[id] ?? [];
  const portsFacing = (id: string, direction: PortSpec["direction"]) =>
    portsOf(id).filter((port) => port.direction === direction);
  const sourceOf = (id: string, port: string): EditorPortSource | undefined => bindings.portSources?.[id]?.[port];
  const refsFor = (componentId: number, port: string): readonly ResolvedPortRef[] => [{ componentId, port }];
  const resolveRef = (ref: EnginePortRef): ResolvedPortRef | undefined => {
    if (ref.componentId !== undefined) return { componentId: ref.componentId, port: ref.port };
    if (ref.flatId === undefined) return undefined;
    const componentId = bindings.flatComponents?.[ref.flatId];
    return componentId === undefined ? undefined : { componentId, port: ref.port };
  };
  const resolveRefs = (refs: readonly EnginePortRef[] | undefined): readonly ResolvedPortRef[] =>
    (refs ?? []).map(resolveRef).filter((ref): ref is ResolvedPortRef => ref !== undefined);

  const inputs = components
    .filter(([id, binding]) => kindOf(id) === "input" && engineComponentIds(binding).length === 1)
    .flatMap(([key, binding]) => {
      const componentId = engineComponentIds(binding)[0];
      if (componentId === undefined) return [];
      return portsFacing(key, "output").map((port) => {
        const targets = resolveRefs(sourceOf(key, port.name)?.inputTargets).length > 0
          ? resolveRefs(sourceOf(key, port.name)?.inputTargets)
          : refsFor(componentId, port.name);
        return { key, componentId, port: port.name, width: port.width, targets };
      });
    });

  const outputs = components.flatMap(([id, binding]) => {
    if (kindOf(id) !== "output") return [];
    const componentId = engineComponentIds(binding)[0];
    if (componentId === undefined) return [];
    return portsFacing(id, "input").map((port) => {
      const source = sourceOf(id, port.name);
      return {
        key: signalKey(id, port.name),
        refs: resolveRefs(source?.readableRefs ?? source?.outputSources).length > 0
          ? resolveRefs(source?.readableRefs ?? source?.outputSources)
          : source?.outputSource && resolveRef(source.outputSource)
            ? [resolveRef(source.outputSource)!]
            : refsFor(componentId, port.name),
      };
    });
  });

  // 其余元件的读数来自它们自己的输出端口；Input 的值来自本次提交，不向引擎读。
  const observedSignals = components.flatMap(([key, binding]) => {
    const kind = kindOf(key);
    if (kind === undefined || kind === "input" || kind === "output") return [];
    const componentIds = engineComponentIds(binding);
    // Subcircuit 的外部输入也属于可观察端口：它们的值来自 inputTargets（或显式 readableRefs），
    // 否则顶层信号投影会把已连接的输入误显示为 X。普通平面元件仍只观察输出端口。
    const observablePorts = kind === "subcircuit" ? portsOf(key) : portsFacing(key, "output");
    return observablePorts.map((port) => {
      const source = sourceOf(key, port.name);
      const targetRefs = source?.inputTargets?.slice(0, 1);
      return {
        key: signalKey(key, port.name),
        refs: resolveRefs(source?.readableRefs ?? source?.outputSources).length > 0
          ? resolveRefs(source?.readableRefs ?? source?.outputSources)
          : source?.outputSource && resolveRef(source.outputSource)
            ? [resolveRef(source.outputSource)!]
            : resolveRefs(targetRefs).length > 0
              ? resolveRefs(targetRefs)
            : componentIds.length > 0 ? refsFor(componentIds[0]!, port.name) : [],
      };
    }).filter((binding) => binding.refs.length > 0);
  });

  const flatComponents = Object.fromEntries(Object.entries(bindings.flatComponents ?? {})
    .filter((entry): entry is [string, number] => typeof entry[1] === "number"));
  return { flatComponents, inputs, outputs, observedSignals };
}

function valuesForBindings(
  bindings: RuntimeSimulationBindings,
  existing: Readonly<Record<InputKey, InputValue>>,
  inputA: InputValue,
  inputB: InputValue,
): Record<InputKey, InputValue> {
  return Object.fromEntries(bindings.inputs.map((binding, index) => [
    binding.key,
    // 结构变更后新建或改宽的端口都还没有这个键的合法值，按端口位宽对齐到默认值。
    coerceInputValue(existing[binding.key] ?? (index === 0 ? inputA : index === 1 ? inputB : undefined), binding.width),
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
   * 协议内的业务错误说明引擎还在，保留 `ready` 让用户能继续操作；传输层故障里，
   * 进程死亡表达为 `unavailable`（引擎本体已经消失，等待恢复），其余表达为 `error`。
   * @param error 捕获到的异常。
   * @param fallback 拿不到异常信息时的兜底文案。
   */
  function recordEngineFailure(error: unknown, fallback: string): void {
    const message = errorMessage(error, fallback);
    state.message = message;
    state.operationError = message;
    if (error instanceof ProtocolResponseError) return;
    state.engineState = message.includes(ENGINE_PROCESS_EXITED_MARKER) ? "unavailable" : "error";
  }

  /** 连续运行期间每一拍完成后通知的订阅者；调用方发起的操作不需要这条通道。 */
  const listeners = new Set<(snapshot: WorkspaceSnapshot) => void>();
  const internalReadPromises = new Map<string, Promise<InternalSignalReadResult>>();

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
    // 自动推进与用户单步走同一条「计数 + 追加波形点」路径：连续运行的每一拍都是波形历史里的一个点。
    const advanced = await queue.enqueue(() => stepInternal(bindings));
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
  function commitInputValues(values: Record<InputKey, InputValue>): void {
    state.inputValues = values;
    const bindings = state.runtimeBindings;
    if (bindings === null) return;
    const [first, second] = bindings.inputs;
    if (first !== undefined) state.inputA = values[first.key] ?? state.inputA;
    if (second !== undefined) state.inputB = values[second.key] ?? state.inputB;
  }

  /**
   * 把当前这一拍记成一个波形点，并维持历史上限。
   *
   * 用户单步、输入切换与连续运行的自动 tick 都经这里记录：每一拍推进各占一个点。
   * 点从数组尾部追加，因此最旧的点在头部；超出上限时只裁掉头部，记录的键空间与行投影不受影响。
   */
  function recordWaveformPoint(): void {
    state.waveform.push({ step: state.simulationStep, signals: { ...state.signals } });
    if (state.waveform.length > WAVEFORM_HISTORY_LIMIT) {
      state.waveform.splice(0, state.waveform.length - WAVEFORM_HISTORY_LIMIT);
    }
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
    nextInputValues: Readonly<Record<InputKey, InputValue>> = state.inputValues,
    options: { countAsAdvance: boolean },
  ): Promise<boolean> {
    if (!bindings) return false;
    state.operationError = null;
    try {
      // 提交的值的长度必须等于端口位宽，否则引擎以 invalid_width 拒绝；对齐在这里统一做。
      const committedValues = bindings.inputs.map((binding) => ({
        binding,
        value: coerceInputValue(nextInputValues[binding.key], binding.width),
      }));
      for (const { binding, value } of committedValues) {
        for (const target of binding.targets) {
          expectResponse(await adapter.setInput(target.componentId, value), "input_set");
        }
      }
      expectResponse(await adapter.settle(), "settled");

      // 每个 Output 元件读取自己的接收端，不假设文档中只有一个 Output。
      const outputSignals: Record<string, Signal> = {};
      for (const binding of bindings.outputs) {
        for (const ref of binding.refs) {
          try {
            outputSignals[binding.key] = expectResponse(await adapter.getSignal(ref.componentId, ref.port), "signal_result").value;
            break;
          } catch (error) {
            if (ref === binding.refs[binding.refs.length - 1]) throw error;
          }
        }
      }

      const observedSignals: Record<string, Signal> = {};
      for (const binding of bindings.observedSignals) {
        for (const ref of binding.refs) {
          try {
            observedSignals[binding.key] = expectResponse(await adapter.getSignal(ref.componentId, ref.port), "signal_result").value;
            break;
          } catch (error) {
            if (ref === binding.refs[binding.refs.length - 1]) throw error;
          }
        }
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
        // 记录的是这一拍全部端口读数的快照（Input 的驱动值、其余元件的输出、每个 Output 的
        // 接收端），而不是写死的三行；键与画布、检查器共用同一套 `${componentId}:${port}`。
        recordWaveformPoint();
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
   * 整体替换的恢复语义（恢复旧绑定、移除旧电路、时间线归零）由 `openCircuit` 在外层处理，
   * 这里只负责推送与新建结构的补偿，加载与重建共用同一条路径。
   * @param document 要推送的电路文档。
   * @param options `initialInputValues` 为打开路径提供的初始输入值（来自项目文件）；
   *   省略时沿用工作区当前值（示例加载与引擎重建都是这条路径）。
   */
  async function loadCircuitInternal(
    document: CircuitDocument,
    options: { initialInputValues?: Readonly<Record<InputKey, InputValue>> } = {},
  ): Promise<CircuitLoadResult> {
    state.isBusy = true;
    state.message = "正在把电路结构推送到仿真引擎…";
    state.operationError = null;
    const components: Record<string, number> = {};
    const connections: Record<string, number> = {};
    const componentKinds: Record<string, ComponentKindName> = {};
    const ports: Record<string, readonly PortSpec[]> = {};
    const flatComponents: Record<string, number> = {};
    const flatConnections: Record<string, number> = {};
    const componentFlatIds: Record<string, readonly string[]> = {};
    const connectionFlatIds: Record<string, readonly string[]> = {};
    const createdComponentIds: number[] = [];
    const createdConnectionIds: number[] = [];
    try {
      for (const component of document.components) {
        if (component.kind === "subcircuit") {
          throw new Error(`层次元件 ${component.id} 尚未展平，不能直接推送到协议引擎。`);
        }
        // 文档带了端口清单就一并送达（数据驱动的元件）；内置元件不带，由引擎回退到内置定义。
        const added = await addComponent(component.kind, component.ports);
        createdComponentIds.push(added.componentId);
        components[component.id] = added.componentId;
        if (component.flatId !== undefined) {
          flatComponents[component.flatId] = added.componentId;
          componentFlatIds[component.id] = [component.flatId];
        }
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
        if (connection.flatId !== undefined) {
          flatConnections[connection.flatId] = id;
          connectionFlatIds[connection.id] = [connection.flatId];
        }
      }
      const bindings: SimulationBindings = {
        components,
        connections,
        componentKinds,
        ports,
        ...(Object.keys(flatComponents).length > 0 ? { flatComponents, componentFlatIds } : {}),
        ...(Object.keys(flatConnections).length > 0 ? { flatConnections, connectionFlatIds } : {}),
        ...(document.portSources ? { portSources: document.portSources } : {}),
        ...(document.internalComponents ? { internalComponents: document.internalComponents } : {}),
      };
      const runtimeBindings = runtimeBindingsFrom(bindings);
      state.runtimeBindings = runtimeBindings;
      state.lastBindings = bindings;
      state.internalComponents = bindings.internalComponents ?? [];
      state.internalSignals = {};
      state.internalReadError = null;
      // 文档里没有 Input 时输入值没有载体：清空而不是留下上一份文档的旧值。
      state.inputValues = runtimeBindings
        ? valuesForBindings(runtimeBindings, options.initialInputValues ?? state.inputValues, state.inputA, state.inputB)
        : {};
      // 「有没有电路」由文档决定：新建的空文档即使推送成功也不是一份电路。
      state.hasCircuit = document.components.length > 0;
      state.message = document.components.length > 0 ? "电路已就绪，试着切换输入。" : "已进入空文档。";
      // 加载后的首次稳定求值不是一次推进：它把电路求值到稳定并填满读数，但不加步数、
      // 不追加波形记录。重置之后的重新求值走同一条规则，两者因此都停在「第 0 步」。
      await submitInputsAndSettle(state.runtimeBindings, state.inputValues, { countAsAdvance: false });
      state.isBusy = false;
      return { snapshot: createWorkspaceSnapshot(state), bindings, ports };
    } catch (error) {
      // 推送失败也要给引擎状态一个诚实的分类：协议错误说明引擎还在（保持 ready），
      // 传输层故障（例如推送途中进程又死了）进入不可用，让恢复流程能接着处理。
      recordEngineFailure(error, "推送电路结构失败。");
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

  /**
   * 引擎重启后的重建入口：忽略 `loadCircuit` 的 `hasCircuit` 守卫（旧电路已随旧进程消失，
   * 新进程本来就是空的），把整份文档重新推送并整体替换引擎身份映射，运行时状态清回
   * 「刚加载完」的第 0 步基线。调用时机由组合层掌握：健康检查确认新进程就绪之后。
   */
  function rebuildCircuit(document: CircuitDocument): Promise<CircuitLoadResult> {
    if (state.isBusy || state.engineState !== "ready") {
      return Promise.resolve({ snapshot: createWorkspaceSnapshot(state), bindings: null, ports: {} });
    }
    return queue.enqueue(async () => {
      // 新进程的仿真状态从零开始：旧进程的时间线已不可复现，步数与波形历史一并清空，
      // 连续运行停回 stopped；读数由推送路径末尾的稳定求值重新填满。
      cancelTick();
      state.simulationState = "stopped";
      state.simulationStep = 0;
      state.waveform = [];
      state.signals = {};
      state.internalSignals = {};
      state.internalComponents = [];
      state.internalReadError = null;
      state.outputValue = "X";
      return loadCircuitInternal(document);
    });
  }

  /**
   * 移除旧电路在引擎里的全部结构：连接先于元件（引擎的连接是独立生命周期，删元件不会
   * 级联删连接，留下悬空连接会在引擎里越积越多），两者都按创建顺序反向移除。
   * 移除失败只尽力而为：打开已经成功，旧结构残留不属于打开的失败原因。
   * @param bindings 打开前那份电路的引擎绑定。
   */
  async function removePreviousCircuit(bindings: SimulationBindings): Promise<void> {
    const connectionIds = [...new Set(Object.values(bindings.connections ?? {}).flatMap((binding) => engineConnectionIds(binding)))];
    for (const connectionId of connectionIds.reverse()) {
      try { await adapter.removeConnection(connectionId); } catch { /* 尽力而为，不阻塞打开。 */ }
    }
    const componentIds = [...new Set(Object.values(bindings.components).flatMap((binding) => engineComponentIds(binding)))];
    for (const componentId of componentIds.reverse()) {
      try { await adapter.removeComponent(componentId); } catch { /* 尽力而为，不阻塞打开。 */ }
    }
  }

  function openCircuit(
    document: CircuitDocument,
    options?: OpenCircuitOptions,
  ): Promise<CircuitLoadResult> {
    if (state.isBusy || state.engineState !== "ready") {
      return Promise.resolve({ snapshot: createWorkspaceSnapshot(state), bindings: null, ports: {} });
    }
    return queue.enqueue(async () => {
      // 替换开始前先停掉连续运行：排定中的推进不能再落到正在替换的绑定上。
      cancelTick();
      const wasRunning = state.simulationState === "running";
      const previousSimulationState = state.simulationState;
      state.simulationState = "stopped";
      // 打开前的运行时状态是失败时的恢复基线：旧的引擎结构从头到尾没被碰过，
      // 因此恢复绑定就等于恢复原状；步数与波形历史在失败路径上根本不会被触到。
      const previous = {
        runtimeBindings: state.runtimeBindings,
        lastBindings: state.lastBindings,
        inputValues: { ...state.inputValues },
        hasCircuit: state.hasCircuit,
        simulationState: previousSimulationState,
      };
      if (options?.inputValues) state.inputValues = { ...options.inputValues };
      const result = await loadCircuitInternal(document, { initialInputValues: options?.inputValues });
      if (result.bindings === null) {
        // 推送失败：新建结构已由推送路径补偿移除，这里恢复打开前的绑定与输入值。
        state.runtimeBindings = previous.runtimeBindings;
        state.lastBindings = previous.lastBindings;
        state.inputValues = previous.inputValues;
        state.hasCircuit = previous.hasCircuit;
        // 运行循环已停且不会自动重启，恢复成 running 会留下一个假运行态：停回 paused。
        state.simulationState = wasRunning ? "paused" : previous.simulationState;
        // 推送路径带回的快照产生于恢复之前，这里必须按恢复后的状态重新生成。
        return { snapshot: createWorkspaceSnapshot(state), bindings: null, ports: {} };
      }
      // 全部推送成功后才移除旧电路：此刻新旧绑定已经整体替换，旧引擎 ID 只存在于快照里。
      if (previous.hasCircuit && previous.lastBindings !== null) {
        await removePreviousCircuit(previous.lastBindings);
      }
      // 打开的是一份新文档：旧文档推进出来的时间线一并结束，从第 0 步重新开始。
      state.simulationStep = 0;
      state.waveform = [];
      return { snapshot: createWorkspaceSnapshot(state), bindings: result.bindings, ports: result.ports };
    });
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
    state.internalComponents = bindings?.internalComponents ?? [];
    state.internalSignals = pruneInternalSignals(state.internalSignals, state.internalComponents);
    state.internalReadError = null;
    if (state.runtimeBindings) {
      // 按元件身份保留已积累的运行时状态：还在的端口读数留着，消失的键连同它的值一起丢弃。
      // 引擎侧同样按身份保留，因此这里留下的读数下一拍就能对上。
      state.signals = pruneSignals(state.signals, state.runtimeBindings);
      commitInputValues(valuesForBindings(state.runtimeBindings, state.inputValues, state.inputA, state.inputB));
    } else {
      // 没有任何元件可仿真：读数没有载体，运行态回到起点。
      state.signals = {};
      state.internalSignals = {};
      state.internalComponents = [];
      state.internalReadError = null;
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
   * 读取当前可见内部表需要的端点。请求只接受 stable flat ID，解析临时 Engine ID
   * 与串行化都留在 Workspace 内；失败只记录内部表诊断并保留已有快照。
   */
  function readInternalSignals(reads: readonly InternalSignalRead[]): Promise<InternalSignalReadResult> {
    const unique = [...new Map(reads.map((read) => [`${read.key}\u0000${read.flatId}\u0000${read.port}`, read])).values()];
    if (unique.length === 0) return Promise.resolve({ snapshot: createWorkspaceSnapshot(state), values: {}, errors: {} });
    const signature = unique.map((read) => `${read.key}\u0000${read.flatId}\u0000${read.port}`).sort().join("\u0001");
    const previous = internalReadPromises.get(signature);
    if (previous !== undefined) return previous;
    const pending = queue.enqueue(async () => {
      const bindings = state.lastBindings;
      const values: Record<string, Signal> = {};
      const errors: Record<string, string> = {};
      if (!bindings) return { snapshot: createWorkspaceSnapshot(state), values, errors };
      const flatComponents = bindings.flatComponents ?? {};
      for (const read of unique) {
        const componentId = flatComponents[read.flatId];
        if (componentId === undefined) {
          errors[read.key] = "内部端点尚未绑定到当前仿真。";
          continue;
        }
        try {
          const response = expectResponse(await adapter.getSignal(componentId, read.port), "signal_result");
          values[read.key] = response.value;
          state.internalSignals[`${read.flatId}:${read.port}`] = response.value;
        } catch (error) {
          errors[read.key] = errorMessage(error, "读取内部信号失败。");
        }
      }
      state.internalReadError = Object.values(errors)[0] ?? null;
      return { snapshot: createWorkspaceSnapshot(state), values, errors };
    });
    internalReadPromises.set(signature, pending);
    void pending.then(() => internalReadPromises.delete(signature), () => internalReadPromises.delete(signature));
    return pending;
  }

  /**
   * 推进一个 tick，并追加这一拍的波形记录。
   * 响应一次带回电路中全部输出 Port 与每个 Output 元件接收端的当前值，
   * 因此每步只有一次跨进程往返，往返次数不随电路规模增长，波形也能记录这一拍的真实读数。
   * 连续运行的自动 tick 与用户单步共用这条路径，每一拍都计一次步数、追加一个波形点；
   * 不推进的求值（加载、重置后的重新求值、结构变更后的读数刷新）走 `submitInputsAndSettle`
   * 的 `countAsAdvance: false`，既不加步数也不进波形历史。
   * @param bindings 本次会话的运行时身份绑定。
   */
  async function stepInternal(bindings: RuntimeSimulationBindings): Promise<boolean> {
    state.operationError = null;
    try {
      const ticked = expectResponse(await adapter.tick(), "ticked");

      // 引擎按引擎身份回传快照，这里按同一套「引擎身份 + 端口名」的键查回工作区的编辑器键。
      const enginePorts = new Map(
        ticked.signals.map((signal) => [signalKey(String(signal.componentId), signal.port), signal.value]),
      );
      const flatSignals: Record<string, Signal> = {};
      for (const [flatId, componentId] of Object.entries(bindings.flatComponents ?? {})) {
        for (const signal of ticked.signals) {
          if (signal.componentId === componentId) flatSignals[`${flatId}:${signal.port}`] = signal.value;
        }
      }
      // A tick already contains the complete engine snapshot. Project it once into stable
      // occurrence-qualified keys; the inspector never performs one get_signal per Port here.
      state.internalSignals = flatSignals;
      state.internalReadError = null;
      const readBindings = (candidates: readonly RuntimeSignalBinding[]): Record<string, Signal> => {
        const values: Record<string, Signal> = {};
        for (const binding of candidates) {
          for (const ref of binding.refs) {
            const value = enginePorts.get(signalKey(String(ref.componentId), ref.port));
            if (value !== undefined) {
              values[binding.key] = value;
              break;
            }
          }
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
            coerceInputValue(state.inputValues[binding.key], binding.width),
          ]),
        ),
        ...observedSignals,
        ...outputSignals,
      };
      if (bindings.outputs.length > 0) {
        state.outputValue = outputSignals[bindings.outputs[0].key] ?? state.outputValue;
      }
      state.simulationStep += 1;
      // 每一拍推进都进波形历史：连续运行的自动 tick 与用户单步在这里没有区别；
      // 超出历史上限时由记录点统一丢弃最旧的点。
      recordWaveformPoint();
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
        await stepInternal(bindings);
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
        state.internalSignals = {};
        state.internalReadError = null;
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

  /**
   * 设置一个 Input 的某一位。
   *
   * 只有这一位变，同一位宽里的其余位保持原样；提交的值因此始终是「当前值换了那一位」，
   * 长度等于端口位宽。设成同一个值不是一次推进：既不发请求，也不追加波形记录——否则
   * 「把已经是 X 的位再设为 X」会在波形里留下一个什么都没变的点。
   * @param key 输入设置项的稳定键。
   * @param index 目标位在取值文本里的下标：0 是最左、也是最高位。
   * @param bit 这一位的新取值。
   */
  function setInputBit(key: InputKey, index: number, bit: InputBit): Promise<WorkspaceSnapshot> {
    const bindings = state.runtimeBindings;
    if (bindings === null) return Promise.resolve(createWorkspaceSnapshot(state));
    const binding = bindings.inputs.find((candidate) => candidate.key === key);
    if (binding === undefined) return Promise.resolve(createWorkspaceSnapshot(state));
    const current = coerceInputValue(state.inputValues[key], binding.width);
    const value = withInputBit(current, index, bit);
    if (value === current) return Promise.resolve(createWorkspaceSnapshot(state));
    const nextInputValues: Record<InputKey, InputValue> = { ...state.inputValues, [key]: value };
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
    openCircuit,
    rebuildCircuit,
    rebindSimulation,
    refreshReadings,
    readInternalSignals,
    start,
    pause,
    resume,
    step,
    reset,
    setInputBit,
    snapshot: () => createWorkspaceSnapshot(state),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
