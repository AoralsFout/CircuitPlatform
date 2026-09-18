import { readonly, shallowRef, computed, type ComputedRef, type DeepReadonly, type Ref } from "vue";
import {
  createAndDemoDocument,
  createEditorSession,
  ENGINE_TRANSPORT_ERROR_CODES,
  type CommandResult,
  type EditorBindings,
  type EditorCommand,
  type EditorComponentId,
  type EditorDocument,
  type Point,
  type EditorSelection,
  type EditorSession,
  type EditorSnapshot,
  type WireColorId,
} from "../editor/index.ts";
import { createProtocolEnginePort } from "../editor/protocolEnginePort.ts";
import type { ConnectionDraftPort } from "../editor/connection-draft.ts";
import {
  createWorkspace,
  type CircuitDocument,
  type EngineAdapter,
  type EngineHealth,
  type InputBit,
  type InputKey,
  type SimulationBindings,
  type TickScheduler,
  type WorkspaceSnapshot,
} from "../workspace/index.ts";
import { createEngineCallQueue } from "../workspace/engineQueue.ts";
import { parseProjectFile, serializeProjectFile } from "../project-file/index.ts";
import {
  projectDisplayName,
  readRecentProjects,
  rememberRecentProject,
  type KeyValueStorage,
} from "../project-file/recent-projects.ts";
import type { ComponentKindName, PortSpec } from "@circuit-platform/protocol";

/**
 * 项目文件保存的主进程桥接；与引擎 adapter 一样来自 `window.circuitPlatform`。
 * 序列化与校验留在渲染层，桥接只负责保存对话框与原子写文件。
 */
interface ProjectFileBridge {
  /** 保存对话框；用户取消时返回 `reason: "canceled"`，调用方按静默放弃处理。 */
  pickSavePath(options?: { defaultPath?: string }): Promise<{ ok: true; path: string } | { ok: false; reason: string }>;
  /** 原子写入项目文件；文件系统失败以 `reason` 带回可展示原因。 */
  writeProjectFile(filePath: string, content: string): Promise<{ ok: true } | { ok: false; reason: string }>;
}

/** 顶栏保存状态的三个可见语义：已保存、有未保存改动、最近一次保存失败。 */
export type ProjectSaveState = "saved" | "dirty" | "error";

/** 未保存文档在另存为对话框里的默认文件名；与顶栏占位名一致。 */
const UNTITLED_PROJECT_NAME = "未命名电路.circuit.json";

interface WorkspaceBinding {
  state: DeepReadonly<Ref<WorkspaceSnapshot>>;
  editorState: DeepReadonly<Ref<EditorSnapshot | null>>;
  bootstrap(): Promise<void>;
  checkEngine(): Promise<void>;
  /** 开始连续运行：反复推进，直到暂停或结构修改。 */
  start(): Promise<void>;
  /** 暂停连续运行，画面停在当前状态。 */
  pause(): Promise<void>;
  /** 从暂停处继续连续运行。 */
  resume(): Promise<void>;
  /** 推进仿真一个 tick；单步是界面上唯一的推进原语。 */
  step(): Promise<void>;
  /** 把仿真恢复到初始状态；Circuit 结构不变，运行状态回到已停止。 */
  reset(): Promise<void>;
  /** 设置某个 Input 某一位的取值；运行中只提交 `set_input`，停止或暂停时提交后立刻求值。 */
  setInputBit(key: InputKey, index: number, bit: InputBit): Promise<void>;
  select(selection: EditorSelection): Promise<void>;
  moveComponent(componentId: EditorComponentId, position: Point): Promise<void>;
  editRoute(connectionId: string, route: readonly Point[]): Promise<void>;
  createConnection(left: ConnectionDraftPort, right: ConnectionDraftPort, route?: readonly Point[], connectionId?: string, color?: WireColorId): Promise<{ ok: boolean; error?: string }>;
  /** 使用稳定 Editor Connection ID 修复悬空端点或替换已占用输入。 */
  reconnectConnection(connectionId: string, left: Parameters<WorkspaceBinding["createConnection"]>[0], right: Parameters<WorkspaceBinding["createConnection"]>[1], route?: readonly Point[]): Promise<{ ok: boolean; error?: string }>;
  resetRoute(connectionId: string): Promise<void>;
  /** 修改单条 Wire 的外观预设；不触碰 C++ Circuit。 */
  setWireColor(connectionId: string, color: WireColorId): Promise<void>;
  deleteWaypoint(connectionId: string, pointIndex: number): Promise<void>;
  deleteSelection(): Promise<void>;
  /** 删除指定 Component，供对象右键菜单直接复用稳定编辑器身份。 */
  deleteComponent(componentId: EditorComponentId): Promise<void>;
  /**
   * 整份替换一个元件的端口清单；改宽是一次可撤销的结构提交，排在共享的引擎调用队列里，
   * 因此不会与推进交错。
   */
  setPortWidthCommand(componentId: EditorComponentId, ports: readonly PortSpec[]): Promise<void>;
  /** 删除指定 Connection 对应的 Wire，供对象右键菜单使用。 */
  deleteConnection(connectionId: string): Promise<void>;
  /** 请求显示清空确认；此步骤不会调用引擎。 */
  requestClear(): Promise<void>;
  /** 确认并执行可撤销的清空事务。 */
  confirmClear(): Promise<void>;
  /** 优先取消待确认操作；没有确认时清除当前选择。 */
  cancelCurrentOperation(): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  beginPlacement(kind: ComponentKindName, continuous?: boolean): Promise<void>;
  updatePlacement(center: Point, altKey?: boolean): Promise<void>;
  placeComponent(center: Point, altKey?: boolean): Promise<boolean>;
  /** 重试失败的待放置请求；保留原类型、位置与稳定身份。 */
  retryPlacement(): Promise<boolean>;
  /** 使用与画布待放置流程相同的添加命令，在指定 WorldPoint 添加一个元件。 */
  addComponent(kind: ComponentKindName, center: Point, altKey?: boolean, continuous?: boolean): Promise<boolean>;
  /** 复制指定稳定编辑器元件；副本不继承连接、路线、选择或信号。 */
  duplicateComponent(componentId?: EditorComponentId): Promise<boolean>;
  /** 当前文档已保存到的路径原始写法；从未保存过时为 null。 */
  projectPath: DeepReadonly<Ref<string | null>>;
  /** 文档内容（结构与 Input 当前值）自上次保存以来是否有改动。 */
  isDirty: DeepReadonly<Ref<boolean>>;
  /** 最近一次保存失败的展示原因；没有失败时为 null，成功的保存会清除它。 */
  saveError: DeepReadonly<Ref<string | null>>;
  /** 编辑器就绪时可以保存；保存不依赖引擎在线。 */
  canSave: ComputedRef<boolean>;
  /** 顶栏显示的项目名：已保存文档的文件名，未保存文档为 null（界面回退到占位名）。 */
  projectName: ComputedRef<string | null>;
  /** 顶栏的保存状态语义，见 `ProjectSaveState`。 */
  saveState: ComputedRef<ProjectSaveState>;
  /**
   * 保存当前文档。已有路径直接覆写；没有路径的文档等价另存为。
   * @returns 保存成功返回 true；用户取消对话框或保存失败返回 false。
   */
  save(): Promise<boolean>;
  /**
   * 另存为：总是询问位置，成功后文档身份切换为新路径。
   * @returns 保存成功返回 true；用户取消对话框或保存失败返回 false。
   */
  saveAs(): Promise<boolean>;
}

function toEditorBindings(bindings: SimulationBindings): EditorBindings {
  // 端口清单一并转交：编辑器文档里的元件靠它拿到自己的端口几何，运行时要读哪些端口也由它推导。
  return { components: bindings.components, connections: bindings.connections ?? {}, componentKinds: bindings.componentKinds, ports: bindings.ports };
}

/** 引擎不可用期间，两次健康检查重试之间的默认间隔。 */
const RECOVERY_RETRY_MS = 1000;

const defaultRecoveryScheduler: TickScheduler = {
  schedule(delayMs, run) {
    const handle = setTimeout(run, delayMs);
    return () => clearTimeout(handle);
  },
};

export interface UseWorkspaceOptions {
  /**
   * 引擎不可用期间健康检查重试的调度器；省略时使用 `setTimeout`。
   * 测试注入手动点火的假实现即可无头驱动恢复循环。
   */
  recoveryScheduler?: TickScheduler;
}

/**
 * 将工作区领域模块与 EditorSession 接入 Vue，并统一管理真实运行时身份。
 * @returns 只读仿真/编辑器快照，以及基于稳定 editor ID 的界面操作。
 */
export function useWorkspace(options: UseWorkspaceOptions = {}): WorkspaceBinding {
  const adapter = (window as unknown as { circuitPlatform: EngineAdapter & ProjectFileBridge }).circuitPlatform;
  // 记录每次健康检查看到的引擎进程代号：恢复流程靠「代号是否变化」区分「进程真的换了」
  // 与「一次超时之类的传输故障误伤了结构事务」——后者引擎还在，电路不需要重建。
  let lastKnownEngineEpoch: number | null = null;
  /**
   * 进程代号变化但还没按新进程重建的闩锁。空闲期间进程退出后，下一次成功检查可能先于
   * 任何失败调用观察到代号变化——没有这个闩锁，恢复流程会拿刷新后的代号误判「同一个
   * 进程」而只解冻不重建，留下旧绑定对上新进程的错乱。
   */
  let rebuildLatched = false;
  const monitoredAdapter: EngineAdapter = {
    checkEngine: async () => {
      const previousEpoch = lastKnownEngineEpoch;
      const health = await adapter.checkEngine();
      if (health.status === "ok" && typeof health.processEpoch === "number") {
        lastKnownEngineEpoch = health.processEpoch;
        if (previousEpoch !== null && previousEpoch !== health.processEpoch) {
          rebuildLatched = true;
          beginRecovery();
        }
      }
      return health;
    },
    addComponent: (kind, ports) => adapter.addComponent(kind, ports),
    setPortWidth: (componentId, ports) => adapter.setPortWidth(componentId, ports),
    addConnection: (source, target) => adapter.addConnection(source, target),
    removeComponent: (componentId) => adapter.removeComponent(componentId),
    removeConnection: (connectionId) => adapter.removeConnection(connectionId),
    setInput: (componentId, value) => adapter.setInput(componentId, value),
    settle: () => adapter.settle(),
    tick: () => adapter.tick(),
    reset: () => adapter.reset(),
    getSignal: (componentId, port) => adapter.getSignal(componentId, port),
  };
  // 一条队列同时交给工作区与编辑器端口：运行中的推进、输入提交与结构提交因此排在同一个队里。
  const queue = createEngineCallQueue();
  const workspace = createWorkspace(monitoredAdapter, { queue });
  const recoveryScheduler = options.recoveryScheduler ?? defaultRecoveryScheduler;
  const state = shallowRef(workspace.snapshot());
  // 连续运行的每一拍由工作区自行排定，因此界面靠订阅拿到那部分快照变化。
  workspace.subscribe((snapshot) => {
    state.value = snapshot;
  });
  const editorState = shallowRef<EditorSnapshot | null>(null);
  let editor: EditorSession | null = null;
  let unsubscribeEditor: (() => void) | null = null;
  let simulationRefreshRequested = false;
  /** 恢复循环是否在跑：防止同一次不可用触发多条并行的恢复路径。 */
  let recovering = false;

  const projectPath = shallowRef<string | null>(null);
  const isDirty = shallowRef(false);
  const saveError = shallowRef<string | null>(null);
  // 上一次落盘内容（序列化后的项目文件文本）；置脏就是拿当前内容与它比较。
  let savedFileSnapshot: string | null = null;
  const canSave = computed(() => editorState.value !== null);
  const projectName = computed(() => projectPath.value === null ? null : projectDisplayName(projectPath.value));
  const saveState = computed<ProjectSaveState>(() => {
    if (saveError.value !== null) return "error";
    return isDirty.value ? "dirty" : "saved";
  });

  /**
   * 把当前文档与 Input 当前值序列化成项目文件文本。
   * 置脏比较与实际落盘共用这一条序列化路径，保证「脏」的含义就是「落盘内容会不一样」。
   */
  function serializeCurrentProjectFile(): string | null {
    const snapshot = editor?.snapshot();
    if (!snapshot) return null;
    return JSON.stringify(serializeProjectFile({
      document: snapshot.document,
      inputValues: state.value.inputValues,
    }));
  }

  /** 用当前内容对照上次落盘内容刷新脏标记；在每条会改动文档或输入的命令之后调用。 */
  function refreshDirtyMarker(): void {
    const current = serializeCurrentProjectFile();
    isDirty.value = savedFileSnapshot !== null && current !== savedFileSnapshot;
  }

  /** 读取本地偏好存储；浏览器禁用持久化时返回 null，记录最近项目安静降级。 */
  function preferenceStorage(): KeyValueStorage | null {
    try {
      return typeof window === "undefined" ? null : window.localStorage ?? null;
    } catch {
      return null;
    }
  }

  /** 保存成功后把该路径记录进最近项目；记录失败不影响已完成的保存。 */
  function recordRecentProject(path: string): void {
    const storage = preferenceStorage();
    rememberRecentProject(storage, readRecentProjects(storage), path);
  }

  async function reflect(operation: () => Promise<WorkspaceSnapshot>): Promise<void> {
    const pending = operation();
    state.value = workspace.snapshot();
    state.value = await pending;
    if (state.value.engineState === "unavailable" || state.value.engineState === "error") {
      beginRecovery();
    }
  }

  // EditorSession 的结构 settle 用于验证 Circuit；工作区仍需重新提交当前输入并读取可展示信号。
  // 这只是一次读数刷新，不推进电路，因此不增加步数、也不追加波形记录。
  async function refreshSimulationAfterBindingsChange(): Promise<void> {
    if (!simulationRefreshRequested) {
      state.value = workspace.snapshot();
      return;
    }
    simulationRefreshRequested = false;
    await reflect(() => workspace.refreshReadings());
  }

  /** 恢复循环里两次健康检查之间的一次等待。 */
  function waitRecoveryRetry(): Promise<void> {
    return new Promise((resolve) => {
      recoveryScheduler.schedule(RECOVERY_RETRY_MS, resolve);
    });
  }

  /** 当前编辑器文档里是否还有值得重建的电路：恢复只服务于「有文档要重建」的场景。 */
  function hasRebuildableDocument(): boolean {
    return (editor?.snapshot().document.components.length ?? 0) > 0;
  }

  /**
   * 把编辑器文档投影成工作区推送所需的结构子集。
   * 端点元件已被删除的悬空连接无法在全新引擎上重建（引擎会拒绝解析不到的端点），
   * 不参与推送；它们的引擎绑定随整体替换一起作废，撤销重建元件时会重新建立。
   */
  function currentCircuitDocument(): CircuitDocument {
    const snapshot = editor?.snapshot();
    const components = snapshot?.document.components ?? [];
    const present = new Set(components.map((component) => component.id));
    return {
      components: components.map((component) => ({
        id: component.id,
        kind: component.kind,
        ...(component.ports ? { ports: component.ports } : {}),
      })),
      connections: (snapshot?.document.connections ?? [])
        .filter((connection) =>
          present.has(connection.source.componentId) && present.has(connection.target.componentId))
        .map((connection) => ({
          id: connection.id,
          source: { componentId: connection.source.componentId, port: connection.source.port },
          target: { componentId: connection.target.componentId, port: connection.target.port },
        })),
    };
  }

  /**
   * 引擎不可用后的恢复入口：反复做健康检查直到引擎能服务为止。
   *
   * 健康检查成功且进程代号变了（或无法判断），说明引擎进程已被更换、旧电路随之消失，
   * 此时用整份文档推送路径按当前文档自动重建，并把新绑定整体喂回既有编辑器会话——
   * 不重开会话，撤销历史因此保留。若代号没变（例如一次请求超时误伤了结构事务），
   * 电路还在引擎里，只解除冻结、不重建。重建没有成功（例如引擎又退出）时回到检查循环。
   * 期间编辑器结构事务保持冻结（ADR 0010 的不可用语义），恢复完成后解除。
   */
  function beginRecovery(): void {
    if (recovering || editor === null) return;
    recovering = true;
    editor.setEngineAvailability(false);
    void recoverEngine();
  }

  async function recoverEngine(): Promise<void> {
    // 重建失败过一次之后不再相信「同号进程」的短路：必须重新重建成功才能解除冻结。
    let rebuildFailed = false;
    try {
      for (;;) {
        // 恢复期间的检查走原始 adapter：包装层会顺手刷新「最近确认在线的进程代号」，
        // 而这里的比较恰恰要拿「恢复开始之前」记录的代号来判断进程有没有换过。
        let health: EngineHealth;
        try {
          health = await adapter.checkEngine();
        } catch {
          // 健康检查自身抛出（桥接故障等一层异常）视作这次检查失败，等下一次重试。
          await waitRecoveryRetry();
          continue;
        }
        if (health.status !== "ok") {
          await waitRecoveryRetry();
          continue;
        }
        const sameProcess = !rebuildFailed && !rebuildLatched &&
          typeof health.processEpoch === "number" &&
          lastKnownEngineEpoch === health.processEpoch;
        // 把 ready 状态与文案写进工作区快照；这次检查同时会刷新已记录的进程代号。
        await reflect(() => workspace.checkEngine());
        if (sameProcess) {
          editor?.setEngineAvailability(true);
          return;
        }
        if (!hasRebuildableDocument()) {
          // 没有电路可重建（例如画布本来就是空的）：引擎恢复即完成。
          rebuildLatched = false;
          editor?.setEngineAvailability(true);
          return;
        }
        const loaded = await workspace.rebuildCircuit(currentCircuitDocument());
        if (loaded.bindings === null) {
          rebuildFailed = true;
          await waitRecoveryRetry();
          continue;
        }
        rebuildLatched = false;
        editor?.adoptBindings(toEditorBindings(loaded.bindings));
        editor?.setEngineAvailability(true);
        return;
      }
    } finally {
      recovering = false;
    }
  }

  function attachEditor(document: EditorDocument, bindings: SimulationBindings): void {
    unsubscribeEditor?.();
    // 新会话的绑定建立在当前进程上；此前的「进程已更换待重建」闩锁随之作废。
    rebuildLatched = false;
    editor = createEditorSession(
      { document, bindings: toEditorBindings(bindings) },
      createProtocolEnginePort(monitoredAdapter, queue),
      {
        // EditorSession 只询问一个布尔可用性 seam；引擎状态仍留在 Workspace 快照中。
        isEngineAvailable: () => workspace.snapshot().engineState === "ready",
        onBindingsChanged(nextBindings) {
          state.value = workspace.rebindSimulation(nextBindings);
          simulationRefreshRequested = true;
        },
      },
    );
    editorState.value = editor.snapshot();
    unsubscribeEditor = editor.subscribe((snapshot) => {
      editorState.value = snapshot;
    });
    // 新会话的初始文档就是脏标记的基线：加载（示例或项目）之后是干净的，改动才置脏。
    savedFileSnapshot = serializeCurrentProjectFile();
    isDirty.value = false;
  }

  /** 把启动示例当作普通文档推送到引擎；示例不占用任何专用代码路径。 */
  async function loadExampleWhenReady(): Promise<void> {
    if (state.value.engineState !== "ready" || state.value.hasCircuit) return;
    const document = createAndDemoDocument();
    const pending = workspace.loadCircuit(document);
    state.value = workspace.snapshot();
    const loaded = await pending;
    state.value = loaded.snapshot;
    if (loaded.bindings) attachEditor(document, loaded.bindings);
  }

  async function checkEngine(): Promise<void> {
    await reflect(() => workspace.checkEngine());
    // 恢复循环进行中时不打扰它：可用性由恢复流程自己解除，示例加载也可能与重建互相踩踏。
    if (recovering) return;
    editor?.setEngineAvailability(state.value.engineState === "ready");
    await loadExampleWhenReady();
  }

  async function start(): Promise<void> {
    await reflect(() => workspace.start());
  }

  async function pause(): Promise<void> {
    await reflect(() => workspace.pause());
  }

  async function resume(): Promise<void> {
    await reflect(() => workspace.resume());
  }

  async function step(): Promise<void> {
    await reflect(() => workspace.step());
  }

  async function reset(): Promise<void> {
    await reflect(() => workspace.reset());
  }

  async function setInputBit(key: InputKey, index: number, bit: InputBit): Promise<void> {
    await reflect(() => workspace.setInputBit(key, index, bit));
    // 拨输入也是文档改动（输入值进文件）；被引擎拒绝的提交不会改 inputValues，因此不会置脏。
    refreshDirtyMarker();
  }

  /**
   * 分发一条编辑器命令并按响应刷新编辑器与仿真快照。
   * 结构事务因引擎不可用（传输层故障）而失败时，随即发起恢复流程：编辑器自己已经冻结，
   * 由这里把不可用转成健康检查 → 自动重建的链条。
   * @returns 命令结果；没有编辑器会话时为 null。
   */
  async function runEditorCommand(command: EditorCommand): Promise<CommandResult | null> {
    if (!editor) return null;
    const pending = editor.dispatch(command);
    editorState.value = editor.snapshot();
    const result = await pending;
    editorState.value = result.snapshot;
    await refreshSimulationAfterBindingsChange();
    await refreshSimulationAfterBindingsChange();
    // 命令可能改变文档或输入值：脏标记在这里统一刷新，包装函数不必各自记挂。
    refreshDirtyMarker();
    if (!result.ok && ENGINE_TRANSPORT_ERROR_CODES.includes(result.error.code)) {
      beginRecovery();
    }
    return result;
  }

  async function dispatch(command: Parameters<EditorSession["dispatch"]>[0]): Promise<void> {
    await runEditorCommand(command);
  }

  /** 改宽走与其它结构提交同一条路径：先发命令，再按响应刷新编辑器与仿真。 */
  async function setPortWidthCommand(componentId: EditorComponentId, ports: readonly PortSpec[]): Promise<void> {
    await dispatch({ type: "set-port-width", componentId, ports });
  }

  /** 右键菜单直接复用 EditorSession 的 add-component 命令；成功才返回 true。 */
  async function addComponent(kind: ComponentKindName, center: Point, altKey = false, continuous = false): Promise<boolean> {
    const result = await runEditorCommand({ type: "add-component", kind, position: center, altKey, continuous });
    return result?.ok ?? false;
  }

  /** 复制当前选中元件或显式指定的元件，并复用 EditorSession 的结构事务。 */
  async function duplicateComponent(componentId?: EditorComponentId): Promise<boolean> {
    const selection = editor?.snapshot().selection ?? null;
    const selectedId = componentId ?? (selection?.kind === "component" ? selection.id : undefined);
    if (!selectedId) return false;
    const result = await runEditorCommand({ type: "duplicate-component", componentId: selectedId });
    return result?.ok ?? false;
  }

  /** 提交元件库产生的待放置意图；成功才返回 true，供最近使用偏好记录使用。 */
  async function placeComponent(center: Point, altKey = false): Promise<boolean> {
    const result = await runEditorCommand({ type: "place-component", center, altKey });
    return result?.ok ?? false;
  }

  /** 将失败的待放置 ghost 重新提交给同一 canonical add-component 流程。 */
  async function retryPlacement(): Promise<boolean> {
    const result = await runEditorCommand({ type: "retry-placement" });
    return result?.ok ?? false;
  }

  /**
   * 把文档写入指定路径并落定保存结果：成功则文档身份切换为该路径、脏标记清除并记录最近项目；
   * 失败只记录可展示原因，编辑器内容原样保留。
   * 序列化与校验都在这一刻完成，写入期间用户的继续编辑会反映在保存结束后的脏标记上。
   */
  async function commitSave(path: string): Promise<boolean> {
    const content = serializeCurrentProjectFile();
    if (content === null) return false;
    // 落盘前用同一份校验实现做往返自检：保存出一个自己都打不开的文件是不可接受的。
    const validation = parseProjectFile(JSON.parse(content));
    if (!validation.ok) {
      saveError.value = `项目文件校验失败，已停止保存：${validation.errors[0]?.message ?? "未知原因"}`;
      return false;
    }
    const result = await adapter.writeProjectFile(path, content);
    if (!result.ok) {
      saveError.value = result.reason;
      return false;
    }
    projectPath.value = path;
    saveError.value = null;
    // 基线取序列化时刻的内容：写文件期间用户又做了编辑的话，保存结束后仍然是脏的。
    savedFileSnapshot = content;
    refreshDirtyMarker();
    recordRecentProject(path);
    return true;
  }

  async function saveAs(): Promise<boolean> {
    if (!editor) return false;
    const dialog = await adapter.pickSavePath({
      defaultPath: projectPath.value ?? UNTITLED_PROJECT_NAME,
    });
    if (!dialog.ok) {
      // 取消不是失败：不打断用户，也不清掉上一次的错误提示。
      if (dialog.reason !== "canceled") saveError.value = dialog.reason;
      return false;
    }
    return commitSave(dialog.path);
  }

  async function save(): Promise<boolean> {
    if (!editor) return false;
    if (projectPath.value === null) return saveAs();
    return commitSave(projectPath.value);
  }

  /** 创建或安全重接连接；失败只返回错误，草稿由画布交互层继续保留。 */
  async function createConnection(left: Parameters<WorkspaceBinding["createConnection"]>[0], right: Parameters<WorkspaceBinding["createConnection"]>[1], route?: readonly Point[], connectionId?: string, color?: WireColorId): Promise<{ ok: boolean; error?: string }> {
    const command = connectionId
      ? { type: "reconnect-connection" as const, connectionId, left, right, route }
      : { type: "create-connection" as const, left, right, route, color };
    const result = await runEditorCommand(command);
    if (result === null) return { ok: false, error: "编辑器尚未准备好。" };
    return result.ok ? { ok: true } : { ok: false, error: result.error.message };
  }

  async function reconnectConnection(connectionId: string, left: Parameters<WorkspaceBinding["createConnection"]>[0], right: Parameters<WorkspaceBinding["createConnection"]>[1], route?: readonly Point[]): Promise<{ ok: boolean; error?: string }> {
    return createConnection(left, right, route, connectionId);
  }

  return {
    state: readonly(state),
    editorState: readonly(editorState),
    bootstrap: checkEngine,
    checkEngine,
    start,
    pause,
    resume,
    step,
    reset,
    setInputBit,
    select: (selection) => dispatch({ type: "select", selection }),
    moveComponent: (componentId, position) => dispatch({ type: "move-component", componentId, position }),
    editRoute: (connectionId, route) => dispatch({ type: "edit-route", connectionId, route }),
    createConnection,
    reconnectConnection,
    resetRoute: (connectionId) => dispatch({ type: "reset-route", connectionId }),
    setWireColor: (connectionId, color) => dispatch({ type: "set-wire-color", connectionId, color }),
    deleteWaypoint: (connectionId, pointIndex) => dispatch({ type: "delete-waypoint", connectionId, pointIndex }),
    deleteSelection: () => dispatch({ type: "delete-selected" }),
    deleteComponent: (componentId) => dispatch({ type: "delete-component", componentId }),
    setPortWidthCommand,
    deleteConnection: (connectionId) => dispatch({ type: "delete-connection", connectionId }),
    requestClear: () => dispatch({ type: "request-clear" }),
    confirmClear: () => dispatch({ type: "confirm-clear" }),
    cancelCurrentOperation: () => dispatch({ type: "cancel-current-operation" }),
    undo: () => dispatch({ type: "undo" }),
    redo: () => dispatch({ type: "redo" }),
    beginPlacement: (kind, continuous = false) => dispatch({ type: "begin-placement", kind, continuous }),
    updatePlacement: (center, altKey = false) => dispatch({ type: "update-placement", center, altKey }),
    placeComponent,
    retryPlacement,
    addComponent,
    duplicateComponent,
    projectPath: readonly(projectPath),
    isDirty: readonly(isDirty),
    saveError: readonly(saveError),
    canSave,
    projectName,
    saveState,
    save,
    saveAs,
  };
}
