import { readonly, shallowRef, computed, type ComputedRef, type DeepReadonly, type Ref } from "vue";
import {
  createAndDemoDocument,
  createEditorSession,
  ENGINE_TRANSPORT_ERROR_CODES,
  type CommandResult,
  type EditorBindings,
  type EditorCommand,
  type EditorComponent,
  type EditorComponentKind,
  type EditorComponentId,
  type InternalComponentDescriptor,
  type EditorDocument,
  type EditorProjectionInput,
  type Point,
  type EditorSelection,
  type EditorSession,
  type EditorSnapshot,
  type WireColorId,
} from "../editor/index.ts";
import { createProtocolEnginePort } from "../editor/protocolEnginePort.ts";
import { normalizeConnectionEndpoints, type ConnectionDraftPort } from "../editor/connection-draft.ts";
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
  type InternalSignalRead,
} from "../workspace/index.ts";
import { createEngineCallQueue } from "../workspace/engineQueue.ts";
import {
  parseProjectFile,
  projectPathIdentity,
  serializeProjectFile,
  type ParsedProjectFile,
  type ProjectFileData,
  type ProjectFileCircuit,
} from "../project-file/index.ts";
import {
  flattenProjectHierarchy,
  type FlattenProjectResult,
} from "../project-file/hierarchy.ts";
import { affectedOccurrencePaths, exportDefinitionProject, importProjectSnapshot, planDeleteDefinition, portsForDefinition, reimportProjectSnapshot, type DefinitionUse, type DeleteDefinitionPlan, type ReimportPortImpact } from "../project-file/definitions.ts";
import { buildLibraryTree, definitionDisplayNames, labelDefinitionUses, type LibraryNode } from "../project-file/library.ts";
import {
  forgetRecentProject,
  projectDisplayName,
  readRecentProjects,
  rememberRecentProject,
  type KeyValueStorage,
  type RecentProject,
} from "../project-file/recent-projects.ts";
import {
  defaultComponentDefinitionRegistry,
  rebuildLoadedDocumentGeometry,
} from "../canvas/index.ts";
import type { ComponentKindName, PortSpec } from "@circuit-platform/protocol";

/**
 * 项目文件保存的主进程桥接；与引擎 adapter 一样来自 `window.circuitPlatform`。
 * 序列化与校验留在渲染层，桥接只负责对话框与文件读写。
 */
interface ProjectFileBridge {
  /** 保存对话框；用户取消时返回 `reason: "canceled"`，调用方按静默放弃处理。 */
  pickSavePath(options?: { defaultPath?: string }): Promise<{ ok: true; path: string } | { ok: false; reason: string }>;
  /** 原子写入项目文件；文件系统失败以 `reason` 带回可展示原因。 */
  writeProjectFile(filePath: string, content: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** 打开对话框；用户取消时返回 `reason: "canceled"`，调用方按静默放弃处理。 */
  pickOpenPath(): Promise<{ ok: true; path: string } | { ok: false; reason: string }>;
  /**
   * 读取项目文件文本；文件不存在或读取失败以 `reason` 带回可展示原因。目标文件不存在时
   * 另带 `code: "PROJECT_FILE_NOT_FOUND"`（约定见 electron/project-file-io.cjs），
   * 调用方按机器可读类别分支，不解析展示文案。
   */
  readProjectFile(filePath: string): Promise<{ ok: true; content: string } | { ok: false; reason: string; code?: string }>;
}

interface DocumentEngineBridge extends EngineAdapter {
  closeDocument?: () => Promise<{ ok: true }>;
}

interface PlatformBridge extends DocumentEngineBridge, ProjectFileBridge {
  forDocument?: (documentKey: string) => DocumentEngineBridge;
}

/** 顶栏保存状态的三个可见语义：已保存、有未保存改动、最近一次保存失败。 */
export type ProjectSaveState = "saved" | "dirty" | "error";

/** 导出结果只作用于当前标签的界面提示，不进入 Project、历史或仿真状态。 */
export interface SubcircuitExportFeedback {
  definitionId: string;
  kind: "success" | "canceled" | "error";
  message: string;
}

/** 只读内嵌定义的可展示快照；不包含实例信号或仿真状态。 */
export interface EmbeddedDefinitionSnapshot {
  definitionId: string;
  displayName: string;
  circuit: ProjectFileCircuit;
}

/** 删除仍有使用处的定义时，供界面展示的待确认影响。 */
export interface PendingDefinitionDeletion {
  definitionId: string;
  displayName: string;
  uses: readonly DefinitionUse[];
  removedDefinitionIds: readonly string[];
}

/** 未保存文档在另存为对话框里的默认文件名；与顶栏占位名一致。 */
const UNTITLED_PROJECT_NAME = "未命名电路.circuit.json";

/** `readProjectFile` 失败结果里「目标文件不存在」的机器可读类别；抛出侧约定见 electron/project-file-io.cjs。 */
const PROJECT_FILE_NOT_FOUND_CODE = "PROJECT_FILE_NOT_FOUND";

/** 置脏确认挂起的文件操作种类；`open` 可能携带最近项目入口挂起的路径。 */
type PendingFileActionKind = "open" | "new" | "load-example";

/** 顶层悬空连线的确认视图；Port 与 Connection 均使用父工程稳定身份。 */
export interface PendingReimportPreview {
  definitionId: string;
  displayName: string;
  impacts: readonly ReimportPortImpact[];
}

export interface WorkspaceBinding {
  /** 释放此文档的恢复调度、编辑器订阅和按文档引擎进程。 */
  dispose(): Promise<void>;
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
  /** 设置只读内部信号表的可见性；隐藏时不会发起内部 Port 读取。 */
  setInternalSignalTableVisible(visible: boolean): void;
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
  /** 选择一份已保存 Project 并把它作为 Subcircuit 加入当前父 Project。 */
  addSubcircuitFromDialog(center?: Point): Promise<boolean>;
  /** 只导入定义快照，不在画布放置元件；与普通导入一样可撤销和保存。 */
  importSubcircuitOnlyFromDialog(): Promise<boolean>;
  /** 复用已有定义，在顶层电路新增一个独立使用处。 */
  placeImportedSubcircuit(definitionId: string, center?: Point): Promise<boolean>;
  /** 修改单个定义的名称，并同步所有使用处的非画布显示名称。 */
  renameImportedSubcircuit(definitionId: string, name: string): Promise<boolean>;
  /** 重新选择已保存的 v2 文件替换定义闭包；顶层断线先预告，失败不建立历史帧。 */
  reimportEmbeddedDefinition(definitionId: string): Promise<boolean>;
  /** 把已存于父 Project 的定义闭包写成独立 v2 Project；不提交编辑事务。 */
  exportImportedSubcircuit(definitionId: string): Promise<boolean>;
  /** 最近一次导出的明确结果，仅供当前标签的子电路页展示。 */
  exportFeedback: DeepReadonly<Ref<SubcircuitExportFeedback | null>>;
  /** 请求删除定义；有使用处时只展示影响，需再次确认。 */
  requestDeleteImportedSubcircuit(definitionId: string): Promise<boolean>;
  /** 确认当前受影响的使用处并以单帧历史删除；状态已变化时要求重新请求。 */
  confirmDeleteImportedSubcircuit(): Promise<boolean>;
  /** 取消待确认的定义删除。 */
  cancelDeleteImportedSubcircuit(): void;
  pendingDefinitionDeletion: DeepReadonly<Ref<PendingDefinitionDeletion | null>>;
  /** 顶层将断线时的待确认预告；确认前定义图、引擎和历史均不变。 */
  pendingReimport: DeepReadonly<Ref<PendingReimportPreview | null>>;
  /** 确认当前断线预告并以一帧结构历史提交；期间文档若变化则要求重选文件。 */
  confirmReimport(): Promise<boolean>;
  /** 放弃当前预告，不修改父工程。 */
  cancelReimport(): void;
  /** 直接导入的定义及递归依赖；每次状态更新均从父工程快照推导。 */
  libraryTree: ComputedRef<readonly LibraryNode[]>;
  /** 按父文档内的稳定 ID 读取定义副本；缺失时返回 null，不访问源文件或引擎。 */
  getEmbeddedDefinition(definitionId: string): EmbeddedDefinitionSnapshot | null;
  /** 当前文档已保存到的路径原始写法；从未保存过时为 null。 */
  projectPath: DeepReadonly<Ref<string | null>>;
  /** 文档内容（结构与 Input 当前值）自上次保存以来是否有改动。 */
  isDirty: DeepReadonly<Ref<boolean>>;
  /** 最近一次保存失败的展示原因；没有失败时为 null，成功的保存会清除它。 */
  saveError: DeepReadonly<Ref<string | null>>;
  /** 设置由协调器产生的可展示保存错误，不改动文档内容或路径身份。 */
  setSaveError(message: string | null): void;
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
  /**
   * 把当前活动文档写入调用方已经确认的路径；不弹对话框，供多文档协调器在冲突确认后提交。
   * @param path 目标文件路径；成功后切换文档路径身份，失败不改变任何文档状态。
   */
  saveToPath(path: string): Promise<boolean>;
  /** 最近一次打开或新建失败的可展示原因；没有失败时为 null，成功的打开/新建会清除它。 */
  openError: DeepReadonly<Ref<string | null>>;
  /**
   * 待确认的文件操作（`"open"` / `"new"` / `"load-example"`）：文档置脏时先确认再执行。
   * 确认对话框由界面层渲染；Esc 与取消按钮都走 `cancelPendingFileAction`。
   */
  pendingFileAction: DeepReadonly<Ref<"open" | "new" | "load-example" | null>>;
  /**
   * 请求打开项目文件：文档置脏时先挂起待确认动作，否则直接进入打开流程。
   * 打开流程本身见 `openProjectFromPath`。
   */
  requestOpen(): Promise<void>;
  /**
   * 请求新建空文档：文档置脏时先挂起待确认动作，否则直接新建。
   */
  requestNew(): Promise<void>;
  /** 确认当前待确认的文件动作（放弃未保存改动）并执行它。 */
  confirmPendingFileAction(): Promise<void>;
  /** 取消当前待确认的文件动作；文档保持原样。 */
  cancelPendingFileAction(): void;
  /**
   * 从指定路径打开项目文件：读文件 → 渲染层校验 → 整体替换推送到引擎。
   * 任何一步失败都给出可展示原因，当前编辑器状态原样保留；成功后切换文档身份、
   * 重置脏标记基线并记录最近项目。目标文件已不存在时同时把该条目移出最近项目。
   * @param path 项目文件的路径；存在性由主进程读取时检查。
   * @returns 打开成功返回 true；任何一步失败返回 false。
   */
  openProjectFromPath(path: string): Promise<boolean>;
  /** 最近项目列表，最近使用在前：按规范化身份去重、上限 10 条，成功打开或另存为后自动更新。 */
  recentProjects: DeepReadonly<Ref<RecentProject[]>>;
  /**
   * 从最近项目入口打开指定项目：文档置脏时先经过与对话框打开相同的未保存确认，
   * 确认或文档干净时走 `openProjectFromPath` 的同一条加载路径。
   * @param path 最近项目条目记录的路径。
   */
  requestOpenRecent(path: string): Promise<void>;
  /**
   * 请求加载 AND 示例：文档置脏时先经过与打开/新建相同的未保存确认，确认或文档干净时
   * 把示例当作普通文档走与打开项目相同的整体替换推送路径。示例加载后是一份未保存文档——
   * 不切换文件身份、不写入最近项目，脏基线是示例文档本身（`attachEditor` 的既有行为）。
   */
  requestLoadExample(): Promise<void>;
}

function toEditorBindings(bindings: SimulationBindings): EditorBindings {
  // 端口清单一并转交：编辑器文档里的元件靠它拿到自己的端口几何，运行时要读哪些端口也由它推导。
  return {
    components: bindings.components,
    connections: bindings.connections ?? {},
    ...(bindings.flatComponents ? { flatComponents: bindings.flatComponents } : {}),
    ...(bindings.flatConnections ? { flatConnections: bindings.flatConnections } : {}),
    ...(bindings.componentFlatIds ? { componentFlatIds: bindings.componentFlatIds } : {}),
    ...(bindings.connectionFlatIds ? { connectionFlatIds: bindings.connectionFlatIds } : {}),
    ...(bindings.componentKinds ? { componentKinds: bindings.componentKinds } : {}),
    ...(bindings.ports ? { ports: bindings.ports } : {}),
    ...(bindings.portSources ? { portSources: bindings.portSources } : {}),
  };
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
  /** 连续推进的调度器；生产环境省略时使用工作区默认定时器。 */
  scheduler?: TickScheduler;
  /**
   * 引擎不可用期间健康检查重试的调度器；省略时使用 `setTimeout`。
   * 测试注入手动点火的假实现即可无头驱动恢复循环。
   */
  recoveryScheduler?: TickScheduler;
  /** 文档引擎键；省略时保留单文档兼容桥接。 */
  documentKey?: string;
  /** 未保存文档的标签名称；省略时保持单文档兼容行为（项目名为 null）。 */
  temporaryName?: string;
}

/**
 * 将工作区领域模块与 EditorSession 接入 Vue，并统一管理真实运行时身份。
 * @returns 只读仿真/编辑器快照，以及基于稳定 editor ID 的界面操作。
 */
export function useWorkspace(options: UseWorkspaceOptions = {}): WorkspaceBinding {
  const platform = (window as unknown as { circuitPlatform: PlatformBridge }).circuitPlatform;
  const engine = options.documentKey !== undefined && typeof platform.forDocument === "function"
    ? platform.forDocument(options.documentKey)
    : platform;
  const adapter: DocumentEngineBridge & ProjectFileBridge = {
    checkEngine: () => engine.checkEngine(),
    addComponent: (kind, ports) => engine.addComponent(kind, ports),
    setPortWidth: (componentId, ports) => engine.setPortWidth(componentId, ports),
    addConnection: (source, target) => engine.addConnection(source, target),
    removeComponent: (componentId) => engine.removeComponent(componentId),
    removeConnection: (connectionId) => engine.removeConnection(connectionId),
    setInput: (componentId, value) => engine.setInput(componentId, value),
    settle: () => engine.settle(),
    tick: () => engine.tick(),
    reset: () => engine.reset(),
    getSignal: (componentId, port) => engine.getSignal(componentId, port),
    ...(engine.closeDocument ? { closeDocument: () => engine.closeDocument!() } : {}),
    pickSavePath: (options) => platform.pickSavePath(options),
    writeProjectFile: (filePath, content) => platform.writeProjectFile(filePath, content),
    pickOpenPath: () => platform.pickOpenPath(),
    readProjectFile: (filePath) => platform.readProjectFile(filePath),
  };
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
  const workspace = createWorkspace(monitoredAdapter, { queue, scheduler: options.scheduler });
  const recoveryScheduler = options.recoveryScheduler ?? defaultRecoveryScheduler;
  const state = shallowRef(workspace.snapshot());
  let disposed = false;
  // 连续运行的每一拍由工作区自行排定，因此界面靠订阅拿到那部分快照变化。
  const unsubscribeWorkspace = workspace.subscribe((snapshot) => {
    if (disposed) return;
    state.value = snapshot;
    // 连续运行的 tick 不经过 reflect；因此引擎在后台推进期间死亡时，必须从订阅
    // 路径启动本运行时自己的恢复循环。恢复状态和编辑器冻结都留在此文档闭包内，
    // 不会暂停或重建其他标签。
    if (snapshot.engineState === "unavailable" || snapshot.engineState === "error") beginRecovery();
  });
  const editorState = shallowRef<EditorSnapshot | null>(null);
  let editor: EditorSession | null = null;
  let unsubscribeEditor: (() => void) | null = null;
  /** 当前文档已经显式采用的层次投影；引擎重建只复用它，绝不重新读取磁盘。 */
  let adoptedHierarchy: FlattenProjectResult | null = null;
  /** 层次投影事务成功发布前，供绑定回调使用的新稳定描述。 */
  let pendingHierarchyForBindings: FlattenProjectResult | null = null;
  /** 与 `adoptedHierarchy` 对应、可直接重建到空引擎的扁平 Circuit。 */
  let adoptedCircuit: CircuitDocument | null = null;
  /** 当前显式采用的 Project 图快照；普通编辑与引擎重建只读这份内存图。 */
  let adoptedProjectFiles: Map<string, ProjectFileData> | null = null;
  /** 当前文档拥有的内嵌定义；未保存文档也从此处序列化。 */
  let embeddedDefinitions: ProjectFileData["definitions"] = {};
  let embeddedLibraryRoots: ProjectFileData["libraryRoots"] = [];
  const pendingDefinitionDeletion = shallowRef<(PendingDefinitionDeletion & { baseToken: string }) | null>(null);
  const libraryTree = computed<readonly LibraryNode[]>(() => {
    const snapshot = editorState.value;
    if (snapshot === null) return [];
    return buildLibraryTree(serializeProjectFile({
      document: snapshot.document,
      inputValues: state.value.inputValues,
      definitions: embeddedDefinitions,
      libraryRoots: embeddedLibraryRoots,
    }));
  });
  function getEmbeddedDefinition(definitionId: string): EmbeddedDefinitionSnapshot | null {
    const definition = embeddedDefinitions[definitionId];
    return definition === undefined ? null : {
      definitionId,
      displayName: definitionDisplayNames(embeddedDefinitions)[definitionId] ?? definition.displayName,
      circuit: structuredClone(definition.circuit),
    };
  }
  /** 投影历史只保存不含引擎 ID 的内嵌定义快照。 */
  const adoptedProjectionRevisions = new Map<string, {
    hierarchy: FlattenProjectResult;
    projectFiles: Map<string, ProjectFileData>;
  }>();
  let nextProjectionRevision = 1;
  let simulationRefreshRequested = false;
  let internalSignalTableVisible = false;
  let internalReadRevision = 0;
  let internalReadInFlight: Promise<void> | null = null;
  let internalReadQueued = false;
  /** 恢复循环是否在跑：防止同一次不可用触发多条并行的恢复路径。 */
  let recovering = false;
  let recoveryWaitCancel: (() => void) | null = null;

  /** 只为当前活动、已解析的 Subcircuit 组装按需读取计划。 */
  function visibleInternalReads(): InternalSignalRead[] {
    if (!internalSignalTableVisible || editor === null || state.value.engineState !== "ready") return [];
    const selection = editor.snapshot().selection;
    if (selection?.kind !== "component") return [];
    const selected = editor.snapshot().document.components.find((component) => component.id === selection.id);
    if (selected?.kind !== "subcircuit" || selected.data?.subcircuit?.status !== "resolved") return [];
    return (state.value.internalComponents ?? [])
      .filter((descriptor) => descriptor.ownerId === selected.id)
      .flatMap((descriptor) => descriptor.ports.map((port) => ({
        key: `${descriptor.flatId}:${port.name}`,
        flatId: descriptor.flatId,
        port: port.name,
      })));
  }

  /**
   * 可见性驱动的读取调度。一次读取结束前的重复请求只留下最后目标，
   * 结果携带的 revision 失配时不发布到当前文档/选择。
   */
  function refreshVisibleInternalSignals(): void {
    const revision = ++internalReadRevision;
    const reads = visibleInternalReads();
    if (reads.length === 0) return;
    if (internalReadInFlight !== null) {
      internalReadQueued = true;
      return;
    }
    internalReadInFlight = (async () => {
      const result = await workspace.readInternalSignals(reads);
      if (disposed || revision !== internalReadRevision || !internalSignalTableVisible) return;
      state.value = result.snapshot;
    })().finally(() => {
      internalReadInFlight = null;
      if (internalReadQueued) {
        internalReadQueued = false;
        refreshVisibleInternalSignals();
      }
    });
  }

  function setInternalSignalTableVisible(visible: boolean): void {
    internalSignalTableVisible = visible;
    internalReadRevision += 1;
    if (visible) refreshVisibleInternalSignals();
  }

  const projectPath = shallowRef<string | null>(null);
  const isDirty = shallowRef(false);
  const saveError = shallowRef<string | null>(null);
  const openError = shallowRef<string | null>(null);
  const exportFeedback = shallowRef<SubcircuitExportFeedback | null>(null);
  // 最近项目在本会话内的内存副本：构造时从存储恢复，此后由记录与清理函数同步维护，
  // 顶栏下拉与首启空状态（#40）直接消费这份响应式列表。
  const recentProjects = shallowRef<RecentProject[]>(readRecentProjects(preferenceStorage()));
  /** 待确认的文件动作；置脏文档的打开/新建/加载示例必须先经过确认。 */
  const pendingFileAction = shallowRef<PendingFileActionKind | null>(null);
  const pendingReimport = shallowRef<PendingReimportPreview | null>(null);
  let pendingReimportCommit: {
    base: string;
    hierarchy: FlattenProjectResult;
    cache: Map<string, ProjectFileData>;
    forceReplaceFlatIds: readonly string[];
  } | null = null;
  // 待确认「打开」的来源路径：来自最近项目入口时非空（确认后不再弹文件对话框，
  // 直接打开该路径）；来自对话框打开时为 null。与 pendingFileAction 同生共死。
  let pendingOpenPath: string | null = null;
  // 上一次落盘内容（序列化后的项目文件文本）；置脏就是拿当前内容与它比较。
  let savedFileSnapshot: string | null = null;
  const canSave = computed(() => editorState.value !== null);
  const projectName = computed(() => projectPath.value === null ? (options.temporaryName ?? null) : projectDisplayName(projectPath.value));
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
      definitions: embeddedDefinitions,
      libraryRoots: embeddedLibraryRoots,
    }));
  }

  /** 用当前内容对照上次落盘内容刷新脏标记；在每条会改动文档或输入的命令之后调用。 */
  function refreshDirtyMarker(): void {
    // 基线为 null 有两种含义：没有文档（序列化同为 null，视为干净），或文档从未落盘——
    // 加载示例就是后者（规格语义：未保存文档），只要存在可序列化的文档就保持置脏。
    const current = serializeCurrentProjectFile();
    isDirty.value = savedFileSnapshot === null ? current !== null : current !== savedFileSnapshot;
  }

  /** 读取本地偏好存储；浏览器禁用持久化时返回 null，记录最近项目安静降级。 */
  function preferenceStorage(): KeyValueStorage | null {
    try {
      return typeof window === "undefined" ? null : window.localStorage ?? null;
    } catch {
      return null;
    }
  }

  /** 保存成功后把该路径记录进最近项目并刷新界面列表；记录失败不影响已完成的保存。 */
  function recordRecentProject(path: string): void {
    const storage = preferenceStorage();
    // 多标签各自拥有一个 binding，但最近项目是工作区级持久化；每次写入前读取最新存储，
    // 避免第二份 binding 用旧内存副本覆盖第一份标签刚记录的路径。
    recentProjects.value = rememberRecentProject(storage, readRecentProjects(storage), path);
  }

  /** 把一条最近项目从列表与存储中移除；存储不可用时安静降级。 */
  function removeRecentProject(path: string): void {
    const storage = preferenceStorage();
    recentProjects.value = forgetRecentProject(storage, recentProjects.value, path);
  }

  async function reflect(operation: () => Promise<WorkspaceSnapshot>): Promise<void> {
    if (disposed) return;
    const pending = operation();
    state.value = workspace.snapshot();
    const next = await pending;
    if (disposed) return;
    state.value = next;
    refreshVisibleInternalSignals();
    if (state.value.engineState === "unavailable" || state.value.engineState === "error") {
      beginRecovery();
    }
  }

  // EditorSession 的结构 settle 用于验证 Circuit；工作区仍需重新提交当前输入并读取可展示信号。
  // 这只是一次读数刷新，不推进电路，因此不增加步数、也不追加波形记录。
  async function refreshSimulationAfterBindingsChange(): Promise<void> {
    if (disposed) return;
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
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        recoveryWaitCancel = null;
        resolve();
      };
      const cancel = recoveryScheduler.schedule(RECOVERY_RETRY_MS, finish);
      recoveryWaitCancel = () => {
        cancel();
        finish();
      };
    });
  }

  /** 当前编辑器文档里是否还有值得重建的电路：恢复只服务于「有文档要重建」的场景。 */
  function hasRebuildableDocument(): boolean {
    if (adoptedCircuit !== null) return adoptedCircuit.components.length > 0;
    return (editor?.snapshot().document.components.length ?? 0) > 0;
  }

  /** 把一组引擎身份压回普通标量兼容形态；零个和多个身份保留数组语义。 */
  function groupedIdentity(ids: readonly number[]): number | readonly number[] {
    return ids.length === 1 ? ids[0]! : [...ids];
  }

  /**
   * 将工作区按扁平 ID 返回的绑定投影回顶层 Editor ID。
   * 层次来源映射只含稳定字符串 ID；数字引擎身份仍由工作区独占并可在重建后整体替换。
   */
  function hierarchyBindings(
    flatBindings: SimulationBindings,
    hierarchy: FlattenProjectResult,
  ): SimulationBindings {
    const flatComponents = Object.fromEntries(
      Object.entries(flatBindings.components).flatMap(([flatId, binding]) => {
        if (binding === undefined) return [];
        const ids = Array.isArray(binding) ? binding : [binding];
        return ids.length > 0 ? [[flatId, ids[0]!] as const] : [];
      }),
    );
    const flatConnections = Object.fromEntries(
      Object.entries(flatBindings.connections ?? {}).flatMap(([flatId, binding]) => {
        if (binding === undefined) return [];
        const ids = Array.isArray(binding) ? binding : [binding];
        return ids.length > 0 ? [[flatId, ids[0]!] as const] : [];
      }),
    );
    const components: Record<string, number | readonly number[]> = {};
    const connections: Record<string, number | readonly number[]> = {};
    const componentKinds: Record<string, EditorComponentKind> = {};
    // 隐藏的扁平元件不会出现在顶层 Editor 文档里，但实例信号表仍要使用引擎回传的
    // 权威端口清单。把这些 flat ID 一并保留在绑定中，后续 EditorSession 发布绑定时
    // 才不会只剩顶层 Subcircuit 端口、把内部行投影成空表。
    const ports: Record<string, readonly PortSpec[]> = Object.fromEntries(
      Object.entries(flatBindings.ports ?? {}).flatMap(([flatId, portList]) =>
        portList === undefined ? [] : [[flatId, portList] as const]),
    );
    const componentFlatIds: Record<string, readonly string[]> = {};
    const connectionFlatIds: Record<string, readonly string[]> = {};
    const internalComponents = internalComponentsFromHierarchy(hierarchy, flatBindings);

    for (const component of hierarchy.document.components) {
      const flatIds = hierarchy.sources.components[component.id] ?? [];
      const ids = flatIds.flatMap((flatId) => flatComponents[flatId] === undefined ? [] : [flatComponents[flatId]!]);
      components[component.id] = groupedIdentity(ids);
      componentFlatIds[component.id] = [...flatIds];
      componentKinds[component.id] = component.kind;
      const authoritative = component.kind === "subcircuit"
        ? component.ports
        : flatBindings.ports?.[flatIds[0] ?? component.id] ?? component.ports;
      if (authoritative !== undefined) ports[component.id] = authoritative;
    }
    for (const connection of hierarchy.document.connections) {
      const flatIds = hierarchy.sources.connections[connection.id] ?? [];
      const ids = flatIds.flatMap((flatId) => flatConnections[flatId] === undefined ? [] : [flatConnections[flatId]!]);
      connections[connection.id] = groupedIdentity(ids);
      connectionFlatIds[connection.id] = [...flatIds];
    }

    const portSources = Object.fromEntries(
      Object.entries(hierarchy.sources.ports).map(([componentId, byPort]) => [
        componentId,
        Object.fromEntries(Object.entries(byPort).map(([portName, source]) => {
          const inputTargets = source.inputTargets?.map((endpoint) => ({ flatId: endpoint.componentId, port: endpoint.port }));
          const outputRefs = source.outputSources?.map((endpoint) => ({ flatId: endpoint.componentId, port: endpoint.port }));
          return [portName, {
            ...(inputTargets && inputTargets.length > 0 ? { inputTargets, readableRefs: inputTargets } : {}),
            ...(outputRefs && outputRefs.length > 0 ? { outputSource: outputRefs[0], readableRefs: outputRefs } : {}),
          }];
        })),
      ]),
    );

    return {
      components,
      connections,
      componentKinds,
      ports,
      flatComponents,
      flatConnections,
      componentFlatIds,
      connectionFlatIds,
      portSources,
      internalComponents,
    };
  }

  /** 在编辑器局部事务重新发布绑定时，继续携带当前采用层次的内部描述。 */
  function internalComponentsFromHierarchy(
    hierarchy: FlattenProjectResult,
    flatBindings: SimulationBindings,
  ): InternalComponentDescriptor[] {
    return Object.values(hierarchy.sources.internalComponents)
      .flatMap((descriptors) => descriptors.map((descriptor) => ({
        ...descriptor,
        path: [...descriptor.path],
        ports: flatBindings.ports?.[descriptor.flatId] ?? descriptor.ports,
      })));
  }

  /** 把层次解析器的稳定来源映射转换成编辑器事务所需的扁平投影。 */
  function editorProjectionFromHierarchy(
    hierarchy: FlattenProjectResult,
    forceReplaceOwner?: EditorComponentId,
    revision?: string,
    forceReplaceFlatIds?: readonly string[],
  ): EditorProjectionInput {
    const portSources = Object.fromEntries(
      Object.entries(hierarchy.sources.ports).map(([componentId, ports]) => [
        componentId,
        Object.fromEntries(Object.entries(ports).map(([portName, source]) => {
          const inputTargets = source.inputTargets?.map((endpoint) => ({
            flatId: endpoint.componentId,
            port: endpoint.port,
          }));
          const readableRefs = source.outputSources?.map((endpoint) => ({
            flatId: endpoint.componentId,
            port: endpoint.port,
          }));
          return [portName, {
            ...(inputTargets?.length ? { inputTargets } : {}),
            ...(readableRefs?.length ? { outputSource: readableRefs[0], readableRefs } : {}),
          }];
        })),
      ]),
    );
    return {
      document: hierarchy.document,
      flatCircuit: hierarchy.circuit,
      componentFlatIds: hierarchy.sources.components,
      connectionFlatIds: hierarchy.sources.connections,
      portSources,
      ...(forceReplaceOwner !== undefined ? { forceReplaceOwner } : {}),
      ...(revision !== undefined ? { revision } : {}),
      ...(forceReplaceFlatIds !== undefined ? { forceReplaceFlatIds } : {}),
    };
  }

  /**
   * 用当前可见文档更新内存中的根 Project，再从内嵌定义重新计算扁平投影。
   * 普通编辑与引擎重建只消费当前 Project，不读取旧源文件。
   */
  async function flattenVisibleDocument(
    document: EditorDocument,
    projectFiles: Map<string, ProjectFileData>,
  ): Promise<FlattenProjectResult | null> {
    const rootPath = projectPath.value ?? "untitled.circuit.json";
    const proposed = projectFiles.get(projectPathIdentity(rootPath));
    const rootFile = serializeProjectFile({
      document,
      inputValues: state.value.inputValues,
      definitions: proposed?.definitions ?? embeddedDefinitions,
      libraryRoots: proposed?.libraryRoots ?? embeddedLibraryRoots,
    });
    projectFiles.set(projectPathIdentity(rootPath), rootFile);
    const flattened = await flattenProjectHierarchy({
      rootIdentity: rootPath,
      root: rootFile,
    });
    const previous = new Map(document.components.map((component) => [component.id, component]));
    const rebuilt = rebuildLoadedDocumentGeometry({
      components: flattened.document.components.map((component) => ({
        ...component,
        ...(component.ports === undefined && previous.get(component.id)?.ports !== undefined
          ? { ports: previous.get(component.id)!.ports }
          : {}),
      })),
      connections: flattened.document.connections,
    }, defaultComponentDefinitionRegistry);
    return { ...flattened, document: rebuilt };
  }

  /** 成功的普通编辑同步到已采用层次快照；这里只重算内存投影，不触发任何引擎调用。 */
  async function syncAdoptedHierarchyFromEditor(): Promise<void> {
    if (adoptedHierarchy === null || adoptedProjectFiles === null || editor === null) return;
    const cache = new Map(adoptedProjectFiles);
    const flattened = await flattenVisibleDocument(editor.snapshot().document, cache);
    if (flattened === null) return;
    adoptedHierarchy = { ...flattened, document: editor.snapshot().document };
    adoptedCircuit = circuitFromHierarchy(flattened);
    adoptedProjectFiles = cache;
    const revision = editor.projection()?.revision;
    editor.adoptProjection(editorProjectionFromHierarchy(adoptedHierarchy, undefined, revision));
    if (revision !== undefined) {
      adoptedProjectionRevisions.set(revision, {
        hierarchy: adoptedHierarchy,
        projectFiles: new Map(cache),
      });
    }
  }

  /**
   * 原子采用一份新的层次投影。EditorSession 负责局部引擎 diff、反向补偿和单历史帧；
   * 组合层只在成功后切换内存 Project 图与恢复快照。
   */
  async function replaceHierarchyProjection(
    hierarchy: FlattenProjectResult,
    projectFiles: Map<string, ProjectFileData>,
    forceReplaceOwner?: EditorComponentId,
    forceReplaceFlatIds?: readonly string[],
  ): Promise<boolean> {
    if (editor === null) return false;
    const revision = `hierarchy-${nextProjectionRevision++}`;
    pendingHierarchyForBindings = hierarchy;
    let result: CommandResult;
    try {
      result = await editor.replaceProjection(editorProjectionFromHierarchy(hierarchy, forceReplaceOwner, revision, forceReplaceFlatIds));
    } finally {
      pendingHierarchyForBindings = null;
    }
    editorState.value = result.snapshot;
    await refreshSimulationAfterBindingsChange();
    if (!result.ok) {
      if (ENGINE_TRANSPORT_ERROR_CODES.includes(result.error.code)) beginRecovery();
      return false;
    }
    adoptedHierarchy = hierarchy;
    adoptedCircuit = circuitFromHierarchy(hierarchy);
    adoptedProjectFiles = projectFiles;
    const rootFile = projectFiles.get(projectPathIdentity(projectPath.value ?? "untitled.circuit.json"));
    if (rootFile !== undefined) {
      embeddedDefinitions = rootFile.definitions;
      embeddedLibraryRoots = rootFile.libraryRoots;
    }
    adoptedProjectionRevisions.set(revision, {
      hierarchy,
      projectFiles: new Map(projectFiles),
    });
    // 定义表不是 Vue ref；再次发布编辑器快照，让子电路树与详情重新取定义名称。
    editorState.value = { ...editor.snapshot() };
    refreshDirtyMarker();
    return true;
  }

  /** 撤销/重做投影替换后，按会话携带的 revision 恢复相同的隐藏 Project 快照。 */
  function restoreAdoptedProjectionRevision(): void {
    if (editor === null) return;
    const revision = editor.projection()?.revision;
    if (revision === undefined) {
      // 从未保存文档撤销第一次导入会回到普通编辑器历史帧；它没有定义图修订号。
      adoptedHierarchy = null;
      adoptedCircuit = null;
      adoptedProjectFiles = null;
      embeddedDefinitions = {};
      embeddedLibraryRoots = [];
      editorState.value = { ...editor.snapshot() };
      return;
    }
    const adopted = adoptedProjectionRevisions.get(revision);
    if (adopted === undefined) return;
    adoptedHierarchy = { ...adopted.hierarchy, document: editor.snapshot().document };
    adoptedCircuit = circuitFromHierarchy(adopted.hierarchy);
    adoptedProjectFiles = new Map(adopted.projectFiles);
    const rootFile = adoptedProjectFiles.get(projectPathIdentity(projectPath.value ?? "untitled.circuit.json"));
    embeddedDefinitions = rootFile?.definitions ?? {};
    embeddedLibraryRoots = rootFile?.libraryRoots ?? [];
    editorState.value = { ...editor.snapshot() };
  }

  /** 层次解析结果的扁平 Circuit 适配；协议类型在这个 seam 之后保持闭合。 */
  function circuitFromHierarchy(hierarchy: FlattenProjectResult): CircuitDocument {
    return {
      components: hierarchy.circuit.components.map((component) => ({
        id: component.id,
        kind: component.kind,
        ...(component.ports ? { ports: component.ports } : {}),
      })),
      connections: hierarchy.circuit.connections.map((connection) => ({
        id: connection.id,
        source: { ...connection.source },
        target: { ...connection.target },
      })),
      ...(Object.values(hierarchy.sources.internalComponents).flat().length > 0
        ? { internalComponents: Object.values(hierarchy.sources.internalComponents).flat().map((descriptor) => ({
          ...descriptor,
          path: [...descriptor.path],
          ports: descriptor.ports.map((port) => ({ ...port, ...(port.bitRange ? { bitRange: { ...port.bitRange } } : {}) })),
        })) }
        : {}),
    };
  }

  /** 只改 Subcircuit 引用元数据，保持可见对象身份、几何与运行状态不变。 */
  function documentWithReferences(
    document: EditorDocument,
    references: Readonly<Record<string, string>>,
  ): EditorDocument {
    return {
      components: document.components.map((component) => {
        const reference = references[component.id];
        const subcircuit = component.data?.subcircuit;
        return reference === undefined || subcircuit === undefined
          ? component
          : { ...component, data: { subcircuit: { ...subcircuit, reference } } };
      }),
      connections: document.connections,
    };
  }

  /**
   * 把编辑器文档投影成工作区推送所需的结构子集。
   * 端点元件已被删除的悬空连接无法在全新引擎上重建（引擎会拒绝解析不到的端点），
   * 不参与推送；它们的引擎绑定随整体替换一起作废，撤销重建元件时会重新建立。
   */
  function currentCircuitDocument(): CircuitDocument {
    if (adoptedCircuit !== null) return adoptedCircuit;
    const snapshot = editor?.snapshot();
    const components = (snapshot?.document.components ?? []).filter((component) => component.kind !== "subcircuit");
    const present = new Set(components.map((component) => component.id));
    return circuitDocumentFrom({
      components,
      connections: (snapshot?.document.connections ?? []).filter((connection) =>
        present.has(connection.source.componentId) && present.has(connection.target.componentId)),
    });
  }

  /**
   * 把一份编辑器文档投影成工作区推送所需的结构子集。
   * @param document 只含活动元件与可见连接的编辑器文档投影。
   * @returns 可直接交给 `Workspace.loadCircuit` / `openCircuit` 的电路文档。
   */
  function circuitDocumentFrom(document: EditorDocument): CircuitDocument {
    const ordinary = document.components.filter(
      (component): component is EditorComponent & { kind: ComponentKindName } => component.kind !== "subcircuit",
    );
    const ordinaryIds = new Set(ordinary.map((component) => component.id));
    return {
      components: ordinary.map((component) => ({
        id: component.id,
        kind: component.kind,
        ...(component.ports ? { ports: component.ports } : {}),
      })),
      connections: document.connections
        .filter((connection) => ordinaryIds.has(connection.source.componentId) && ordinaryIds.has(connection.target.componentId))
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
    if (disposed || recovering || editor === null) return;
    recovering = true;
    editor.setEngineAvailability(false);
    void recoverEngine();
  }

  async function recoverEngine(): Promise<void> {
    // 重建失败过一次之后不再相信「同号进程」的短路：必须重新重建成功才能解除冻结。
    let rebuildFailed = false;
    try {
      for (;;) {
        if (disposed) return;
        // 恢复期间的检查走原始 adapter：包装层会顺手刷新「最近确认在线的进程代号」，
        // 而这里的比较恰恰要拿「恢复开始之前」记录的代号来判断进程有没有换过。
        let health: EngineHealth;
        try {
          health = await adapter.checkEngine();
        } catch {
          // 健康检查自身抛出（桥接故障等一层异常）视作这次检查失败，等下一次重试。
          await waitRecoveryRetry();
          if (disposed) return;
          continue;
        }
        if (health.status !== "ok") {
          await waitRecoveryRetry();
          if (disposed) return;
          continue;
        }
        const sameProcess = !rebuildFailed && !rebuildLatched &&
          typeof health.processEpoch === "number" &&
          lastKnownEngineEpoch === health.processEpoch;
        // 把 ready 状态与文案写进工作区快照；这次检查同时会刷新已记录的进程代号。
        await reflect(() => workspace.checkEngine());
        if (disposed) return;
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
          if (disposed) return;
          continue;
        }
        rebuildLatched = false;
        const nextBindings = adoptedHierarchy === null
          ? loaded.bindings
          : hierarchyBindings(loaded.bindings, adoptedHierarchy);
        // 重建产生的新快照要显式发布：rebuildCircuit 只改工作区内部状态，不通知订阅者，
        // 不发布的话界面会停在恢复前的旧读数上（engineState 已是 ready，步数与信号却是旧的）。
        workspace.rebindSimulation(nextBindings);
        const rebuiltSnapshot = await workspace.refreshReadings();
        if (disposed) return;
        editor?.adoptBindings(toEditorBindings(nextBindings));
        editor?.setEngineAvailability(true);
        // 最后才发布「第 0 步 + 新读数」完成标志：观察者看到完成时，编辑器绑定与可用性
        // 已同步切换，不能在两条赋值之间抢先提交一次仍被冻结的 undo。
        state.value = rebuiltSnapshot;
        return;
      }
    } finally {
      recovering = false;
    }
  }

  /**
   * 文档成功落地的公共收尾：发布工作区快照、建立编辑器会话、切换文档身份并清空两类文件错误。
   * 脏基线由 attachEditor 重置为刚加载的文档本身；「未保存文档」语义（如加载示例）由调用方覆盖。
   */
  function finishDocumentLoad(
    loaded: { snapshot: WorkspaceSnapshot },
    document: EditorDocument,
    bindings: SimulationBindings,
    path: string | null,
    hierarchy: FlattenProjectResult | null = null,
    circuit: CircuitDocument | null = null,
    projectFiles: Map<string, ProjectFileData> | null = null,
  ): void {
    const adopted = hierarchy === null ? null : { ...hierarchy, document };
    adoptedHierarchy = adopted;
    adoptedCircuit = circuit;
    adoptedProjectFiles = projectFiles;
    const rootFile = path === null ? undefined : projectFiles?.get(projectPathIdentity(path));
    embeddedDefinitions = rootFile?.definitions ?? {};
    embeddedLibraryRoots = rootFile?.libraryRoots ?? [];
    projectPath.value = path;
    state.value = loaded.snapshot;
    if (adopted !== null && projectFiles !== null) {
      const revision = `hierarchy-${nextProjectionRevision++}`;
      adoptedProjectionRevisions.set(revision, {
        hierarchy: adopted,
        projectFiles: new Map(projectFiles),
      });
      attachEditor(document, bindings, editorProjectionFromHierarchy(adopted, undefined, revision));
    } else {
      attachEditor(document, bindings);
    }
    refreshVisibleInternalSignals();
    saveError.value = null;
    openError.value = null;
  }

  function attachEditor(
    document: EditorDocument,
    bindings: SimulationBindings,
    projection?: EditorProjectionInput,
  ): void {
    unsubscribeEditor?.();
    // 新会话的绑定建立在当前进程上；此前的「进程已更换待重建」闩锁随之作废。
    rebuildLatched = false;
    editor = createEditorSession(
      { document, bindings: toEditorBindings(bindings), ...(projection ? { projection } : {}) },
      createProtocolEnginePort(monitoredAdapter, queue),
      {
        // EditorSession 只询问一个布尔可用性 seam；引擎状态仍留在 Workspace 快照中。
        isEngineAvailable: () => workspace.snapshot().engineState === "ready",
        onBindingsChanged(nextBindings) {
          // 撤销/重做先由 EditorSession 切换投影，再回调绑定；按目标 revision 取对应
          // 内部元件描述，避免新定义的描述混入恢复后的旧引擎状态。
          const revision = editor?.projection()?.revision;
          const hierarchyForBindings = pendingHierarchyForBindings ??
            (revision === undefined ? undefined : adoptedProjectionRevisions.get(revision)?.hierarchy) ?? adoptedHierarchy;
          const projected = hierarchyForBindings === null
            ? nextBindings
            : {
                ...nextBindings,
                // EditorSession keeps componentKinds as a non-enumerable compatibility
                // property on its callback projection. Re-state it explicitly when
                // adding hierarchy-only internal descriptors so runtime derivation
                // still recognizes Input/Output components.
                ...(nextBindings.componentKinds !== undefined ? { componentKinds: nextBindings.componentKinds } : {}),
                internalComponents: internalComponentsFromHierarchy(hierarchyForBindings, nextBindings),
              };
          state.value = workspace.rebindSimulation(projected);
          simulationRefreshRequested = true;
        },
      },
    );
    editorState.value = editor.snapshot();
    unsubscribeEditor = editor.subscribe((snapshot) => {
      editorState.value = snapshot;
      // Selection/projection changes invalidate any in-flight instance read. A
      // visible inspector is refreshed only for the latest resolved owner.
      refreshVisibleInternalSignals();
    });
    // 新会话的初始文档就是脏标记的基线：加载（示例或项目）之后是干净的，改动才置脏。
    savedFileSnapshot = serializeCurrentProjectFile();
    isDirty.value = false;
  }

  /**
   * 把 AND 示例当作普通文档推送到引擎：与打开项目共用整体替换推送路径，没有专用路径。
   * 示例加载后是一份未保存文档——不切换文件身份（`projectPath` 清空）、不写入最近项目；
   * 脏基线由 `attachEditor` 置为示例文档本身，之后的改动才置脏。
   * 首启没有编辑器会话也一样可用：会话由这次成功加载建立。
   */
  async function performLoadExample(): Promise<void> {
    openError.value = null;
    // 引擎不在线时推送必然是空操作：先给出可展示的原因，而不是等推送悄悄返回。
    if (state.value.engineState !== "ready") {
      openError.value = "仿真引擎不可用，无法加载示例。";
      return;
    }
    const document = createAndDemoDocument();
    // 初值省略：沿推送路径的既有规则沿用工作区当前输入值（与引擎重建同规则），示例不另立语义。
    const loaded = await workspace.openCircuit(circuitDocumentFrom(document));
    if (disposed) return;
    if (loaded.bindings === null) {
      openError.value = loaded.snapshot.operationError ?? "加载示例失败。";
      return;
    }
    finishDocumentLoad(loaded, document, loaded.bindings, null);
    // 规格要求示例加载后是一份「未保存文档，由用户决定是否保存」：脏基线不能落在示例本身，
    // 否则顶栏显示「已保存」，用户无从知道它还没有落盘。
    savedFileSnapshot = null;
    isDirty.value = true;
  }

  async function checkEngine(): Promise<void> {
    await reflect(() => workspace.checkEngine());
    if (disposed) return;
    // 恢复循环进行中时不打扰它：可用性由恢复流程自己解除。
    if (recovering) return;
    editor?.setEngineAvailability(state.value.engineState === "ready");
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
    if (disposed) return null;
    editorState.value = result.snapshot;
    await refreshSimulationAfterBindingsChange();
    if (disposed) return null;
    if (result.ok && (command.type === "undo" || command.type === "redo")) {
      restoreAdoptedProjectionRevision();
    }
    if (result.ok) await syncAdoptedHierarchyFromEditor();
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

  /** 把一份新的顶层可见文档经当前内存 Project 图展平并原子采用。 */
  async function replaceVisibleHierarchyDocument(
    document: EditorDocument,
    forceReplaceOwner?: EditorComponentId,
  ): Promise<boolean> {
    if (adoptedProjectFiles === null) return false;
    const cache = new Map(adoptedProjectFiles);
    const hierarchy = await flattenVisibleDocument(document, cache);
    return hierarchy !== null && replaceHierarchyProjection(hierarchy, cache, forceReplaceOwner);
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
    const source = editor?.snapshot().document.components.find((component) => component.id === selectedId);
    if (source?.kind === "subcircuit") {
      return duplicateSubcircuit(source);
    }
    const result = await runEditorCommand({ type: "duplicate-component", componentId: selectedId });
    return result?.ok ?? false;
  }

  /** 产生一个不与当前文档冲突、并与普通元件序列兼容的稳定 Editor ID。 */
  function nextComponentId(document: EditorDocument): EditorComponentId {
    const occupied = new Set(document.components.map((component) => component.id));
    let sequence = 1;
    while (occupied.has(`component-${sequence}`)) sequence += 1;
    return `component-${sequence}`;
  }

  /** 复制 Subcircuit 的定义身份与缓存接口；内部结构由父 Project 的内嵌定义重新展平。 */
  async function duplicateSubcircuit(source: EditorComponent): Promise<boolean> {
    if (adoptedProjectFiles === null || editor === null) return false;
    const snapshot = editor.snapshot();
    const duplicate: EditorComponent = {
      ...source,
      id: nextComponentId(snapshot.document),
      displayName: source.displayName,
      position: { x: source.position.x + 32, y: source.position.y + 32 },
      ports: source.ports?.map((port) => ({ ...port, ...(port.bitRange ? { bitRange: { ...port.bitRange } } : {}) })),
      data: source.data?.subcircuit ? {
        subcircuit: {
          ...source.data.subcircuit,
          cachedPorts: source.data.subcircuit.cachedPorts.map((port) => ({ ...port, ...(port.bitRange ? { bitRange: { ...port.bitRange } } : {}) })),
          ...(source.data.subcircuit.portOrder ? { portOrder: [...source.data.subcircuit.portOrder] } : {}),
        },
    } : source.data,
    };
    const document = { ...snapshot.document, components: [...snapshot.document.components, duplicate] };
    const cache = new Map(adoptedProjectFiles);
    const hierarchy = await flattenVisibleDocument(document, cache);
    return hierarchy !== null && replaceHierarchyProjection(hierarchy, cache);
  }

  /** 根据定义身份同步文档中每个使用处的完整名称，包括同名编号。 */
  function withDefinitionLabels(document: EditorDocument, file: ProjectFileData): EditorDocument {
    const labels = definitionDisplayNames(file.definitions);
    return { ...document, components: document.components.map((component) => {
      const id = component.data?.subcircuit?.definitionId;
      const label = id === undefined ? undefined : labels[id];
      return label === undefined ? component : { ...component, displayName: label };
    }) };
  }

  /** 从已保存的 v2 文件导入独立定义；仅导入和导入并放置共用读取与校验。 */
  async function importSubcircuitFromDialog(place: boolean, center: Point): Promise<boolean> {
    if (editor === null) return false;
    const picked = await adapter.pickOpenPath();
    if (!picked.ok) {
      if (picked.reason !== "canceled") openError.value = picked.reason;
      return false;
    }
    const read = await adapter.readProjectFile(picked.path);
    if (!read.ok) {
      openError.value = read.reason;
      return false;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(read.content);
    } catch (error) {
      openError.value = `项目文件不是合法的 JSON：${error instanceof Error ? error.message : "解析失败"}`;
      return false;
    }
    const parsed = parseProjectFile(raw);
    if (!parsed.ok) {
      openError.value = parsed.errors[0]?.message ?? "项目文件校验失败。";
      return false;
    }
    const snapshot = editor.snapshot();
    const parent = serializeProjectFile({
      document: snapshot.document,
      inputValues: state.value.inputValues,
      definitions: embeddedDefinitions,
      libraryRoots: embeddedLibraryRoots,
    });
    const imported = importProjectSnapshot(parent, parsed.value.file, projectDisplayName(picked.path), (used) => {
      let index = 1;
      while (used.has(`definition-${index}`)) index += 1;
      return `definition-${index}`;
    });
    if (!imported.ok) {
      openError.value = imported.errors[0]?.message ?? "不能导入这个 Project。";
      return false;
    }
    const file = labelDefinitionUses(imported.file);
    const id = nextComponentId(snapshot.document);
    const candidate: EditorComponent = {
      id, kind: "subcircuit", displayName: definitionDisplayNames(file.definitions)[imported.definitionId]!,
      position: { ...center }, lifecycle: "active", ports: imported.ports,
      data: { subcircuit: { definitionId: imported.definitionId, reference: "", cachedPorts: imported.ports } },
    };
    const document = withDefinitionLabels({ ...snapshot.document, components: place ? [...snapshot.document.components, candidate] : snapshot.document.components }, file);
    const cache = new Map(adoptedProjectFiles ?? []);
    cache.set(projectPathIdentity(projectPath.value ?? "untitled.circuit.json"), file);
    const hierarchy = await flattenVisibleDocument(document, cache);
    const added = place ? hierarchy?.document.components.find((component) => component.id === id) : undefined;
    if (hierarchy === null || (place && added?.data?.subcircuit?.status !== "resolved")) {
      const diagnostic = hierarchy?.diagnostics.find((item) => item.componentId === id);
      openError.value = diagnostic?.message ?? "所选 Project 不能作为 Subcircuit 使用。";
      return false;
    }
    const committed = await replaceHierarchyProjection(hierarchy, cache);
    openError.value = committed
      ? (hierarchy.diagnostics.length > 0
        ? `导入成功，部分连接或定义需要检查：${hierarchy.diagnostics.map((item) => item.message).join("；")}`
        : null)
      : (editor.snapshot().error?.message ?? "子电路导入失败，父工程保持原状。");
    return committed;
  }

  /** 导入源文件并立即放置一个新定义的使用处。 */
  async function addSubcircuitFromDialog(center: Point = { x: 240, y: 180 }): Promise<boolean> {
    return importSubcircuitFromDialog(true, center);
  }

  /** 只保存源文件的定义快照，不创建画布元件。 */
  async function importSubcircuitOnlyFromDialog(): Promise<boolean> {
    return importSubcircuitFromDialog(false, { x: 240, y: 180 });
  }

  /** 从现有定义创建一个新的顶层使用处，不读取源文件。 */
  async function placeImportedSubcircuit(definitionId: string, center: Point = { x: 240, y: 180 }): Promise<boolean> {
    if (editor === null) return false;
    const definition = embeddedDefinitions[definitionId];
    if (!definition) { openError.value = "所选子电路定义已不存在。"; return false; }
    const snapshot = editor.snapshot();
    const ports = portsForDefinition(definition.circuit);
    const candidate: EditorComponent = {
      id: nextComponentId(snapshot.document), kind: "subcircuit",
      displayName: definitionDisplayNames(embeddedDefinitions)[definitionId]!,
      position: { ...center }, lifecycle: "active", ports,
      data: { subcircuit: { definitionId, reference: "", cachedPorts: ports } },
    };
    const document = { ...snapshot.document, components: [...snapshot.document.components, candidate] };
    const cache = new Map(adoptedProjectFiles ?? []);
    const hierarchy = await flattenVisibleDocument(document, cache);
    if (hierarchy === null || hierarchy.document.components.find((component) => component.id === candidate.id)?.data?.subcircuit?.status !== "resolved") {
      openError.value = hierarchy?.diagnostics.find((item) => item.componentId === candidate.id)?.message ?? "无法放置这个子电路。";
      return false;
    }
    const committed = await replaceHierarchyProjection(hierarchy, cache);
    openError.value = committed ? null : (editor.snapshot().error?.message ?? "放置子电路失败。");
    return committed;
  }

  /** 在一次投影历史事务中修改单个定义的显示名称。 */
  async function renameImportedSubcircuit(definitionId: string, name: string): Promise<boolean> {
    if (editor === null || !embeddedDefinitions[definitionId]) return false;
    const trimmed = name.trim();
    if (trimmed.length === 0) { openError.value = "子电路名称不能为空。"; return false; }
    if (embeddedDefinitions[definitionId]!.displayName === trimmed) return true;
    const snapshot = editor.snapshot();
    const file = labelDefinitionUses(serializeProjectFile({
      document: snapshot.document, inputValues: state.value.inputValues,
      definitions: { ...embeddedDefinitions, [definitionId]: { ...embeddedDefinitions[definitionId]!, displayName: trimmed } },
      libraryRoots: embeddedLibraryRoots,
    }));
    const document = withDefinitionLabels(snapshot.document, file);
    const cache = new Map(adoptedProjectFiles ?? []);
    cache.set(projectPathIdentity(projectPath.value ?? "untitled.circuit.json"), file);
    const hierarchy = await flattenVisibleDocument(document, cache);
    if (hierarchy === null) return false;
    const committed = await replaceHierarchyProjection(hierarchy, cache);
    openError.value = committed ? null : (editor.snapshot().error?.message ?? "子电路改名失败。");
    return committed;
  }

  /** 从文件重新导入选中定义；只在完整候选展平和引擎事务成功后采用定义图。 */
  async function reimportEmbeddedDefinition(definitionId: string): Promise<boolean> {
    cancelReimport();
    if (editor === null || !embeddedDefinitions[definitionId]) {
      openError.value = "所选子电路定义已不存在。";
      return false;
    }
    const picked = await adapter.pickOpenPath();
    if (!picked.ok) {
      if (picked.reason !== "canceled") openError.value = picked.reason;
      return false;
    }
    const read = await adapter.readProjectFile(picked.path);
    if (!read.ok) { openError.value = read.reason; return false; }
    let raw: unknown;
    try { raw = JSON.parse(read.content); }
    catch (error) {
      openError.value = `项目文件不是合法的 JSON：${error instanceof Error ? error.message : "解析失败"}`;
      return false;
    }
    const parsed = parseProjectFile(raw);
    if (!parsed.ok) { openError.value = parsed.errors[0]?.message ?? "项目文件校验失败。"; return false; }
    const snapshot = editor.snapshot();
    const parent = serializeProjectFile({
      document: snapshot.document, inputValues: state.value.inputValues,
      definitions: embeddedDefinitions, libraryRoots: embeddedLibraryRoots,
    });
    const paths = affectedOccurrencePaths(parent, definitionId);
    const candidate = reimportProjectSnapshot(parent, parsed.value.file, definitionId, (used) => {
      let index = 1;
      while (used.has(`definition-${index}`)) index += 1;
      return `definition-${index}`;
    });
    if (!candidate.ok) { openError.value = candidate.errors[0]?.message ?? "重新导入失败。"; return false; }
    const file = labelDefinitionUses(candidate.file);
    const cache = new Map(adoptedProjectFiles ?? []);
    cache.set(projectPathIdentity(projectPath.value ?? "untitled.circuit.json"), file);
    const hierarchy = await flattenVisibleDocument(withDefinitionLabels(snapshot.document, file), cache);
    if (hierarchy === null) { openError.value = "无法展开新子电路定义。"; return false; }
    const previousFlat = adoptedHierarchy?.circuit.components.map((component) => component.id) ?? [];
    const nextFlat = hierarchy.circuit.components.map((component) => component.id);
    const forceReplaceFlatIds = [...new Set([...previousFlat, ...nextFlat].filter((id) => paths.some((path) => id.startsWith(`${path}/`))))];
    const prepared = { base: serializeCurrentProjectFile()!, hierarchy, cache, forceReplaceFlatIds };
    if (candidate.topLevelImpacts.length > 0) {
      pendingReimportCommit = prepared;
      pendingReimport.value = {
        definitionId,
        displayName: embeddedDefinitions[definitionId]!.displayName,
        impacts: candidate.topLevelImpacts,
      };
      openError.value = null;
      return false;
    }
    return commitReimport(prepared);
  }

  /** 预告确认与无断线更新共用同一提交路径，失败时只展示原因。 */
  async function commitReimport(prepared: NonNullable<typeof pendingReimportCommit>): Promise<boolean> {
    if (serializeCurrentProjectFile() !== prepared.base) {
      openError.value = "父工程在确认期间已变化，请重新选择文件导入。";
      return false;
    }
    const committed = await replaceHierarchyProjection(prepared.hierarchy, prepared.cache, undefined, prepared.forceReplaceFlatIds);
    openError.value = committed
      ? (prepared.hierarchy.diagnostics.length > 0
        ? `重新导入成功，部分连接或定义需要检查：${prepared.hierarchy.diagnostics.map((item) => item.message).join("；")}`
        : null)
      : (editor?.snapshot().error?.message ?? "重新导入失败，父工程保持原状。");
    return committed;
  }

  /** 导出只通过文件桥接写出快照，不调用编辑器命令或引擎。 */
  async function exportImportedSubcircuit(definitionId: string): Promise<boolean> {
    exportFeedback.value = null;
    if (editor === null) {
      exportFeedback.value = { definitionId, kind: "error", message: "没有可导出的项目。" };
      return false;
    }
    const parent = serializeProjectFile({
      document: editor.snapshot().document, inputValues: state.value.inputValues,
      definitions: embeddedDefinitions, libraryRoots: embeddedLibraryRoots,
    });
    const exported = exportDefinitionProject(parent, definitionId);
    if (!exported.ok) {
      exportFeedback.value = { definitionId, kind: "error", message: exported.errors[0]?.message ?? "子电路导出失败。" };
      return false;
    }
    const displayName = embeddedDefinitions[definitionId]!.displayName;
    const defaultPath = displayName.endsWith(".circuit.json") ? displayName : `${displayName}.circuit.json`;
    try {
      const picked = await adapter.pickSavePath({ defaultPath });
      if (!picked.ok) {
        exportFeedback.value = picked.reason === "canceled"
          ? { definitionId, kind: "canceled", message: "已取消导出。" }
          : { definitionId, kind: "error", message: `无法选择导出位置：${picked.reason}` };
        return false;
      }
      if (projectPath.value !== null && projectPathIdentity(picked.path) === projectPathIdentity(projectPath.value)) {
        exportFeedback.value = { definitionId, kind: "error", message: "导出位置不能覆盖当前父 Project。" };
        return false;
      }
      const written = await adapter.writeProjectFile(picked.path, JSON.stringify(exported.file));
      exportFeedback.value = written.ok
        ? { definitionId, kind: "success", message: `已导出到 ${picked.path}。修改导出文件后，需显式重新导入才会更新父 Project。` }
        : { definitionId, kind: "error", message: `子电路导出失败：${written.reason}` };
      return written.ok;
    } catch (error) {
      exportFeedback.value = { definitionId, kind: "error", message: `子电路导出失败：${error instanceof Error ? error.message : String(error)}` };
      return false;
    }
  }
  function deletionBaseToken(): string | null {
    const snapshot = editor?.snapshot();
    return snapshot ? JSON.stringify({ document: snapshot.document, definitions: embeddedDefinitions, libraryRoots: embeddedLibraryRoots }) : null;
  }

  async function commitDefinitionDeletion(plan: Extract<DeleteDefinitionPlan, { ok: true }>): Promise<boolean> {
    if (editor === null) return false;
    const document = editor.snapshot().document;
    const cache = new Map(adoptedProjectFiles ?? []);
    cache.set(projectPathIdentity(projectPath.value ?? "untitled.circuit.json"), plan.file);
    const hierarchy = await flattenVisibleDocument(document, cache);
    if (hierarchy === null) return false;
    const committed = await replaceHierarchyProjection(hierarchy, cache);
    openError.value = committed ? null : (editor.snapshot().error?.message ?? "删除子电路定义失败，父工程保持原状。");
    return committed;
  }

  async function requestDeleteImportedSubcircuit(definitionId: string): Promise<boolean> {
    if (editor === null) return false;
    const snapshot = editor.snapshot();
    const file = serializeProjectFile({
      document: snapshot.document, inputValues: state.value.inputValues,
      definitions: embeddedDefinitions, libraryRoots: embeddedLibraryRoots,
    });
    const plan = planDeleteDefinition(file, definitionId);
    if (!plan.ok) { openError.value = plan.errors[0]?.message ?? "删除定义失败。"; return false; }
    if (plan.uses.length === 0) return commitDefinitionDeletion(plan);
    pendingDefinitionDeletion.value = {
      definitionId, displayName: definitionDisplayNames(embeddedDefinitions)[definitionId] ?? definitionId,
      uses: plan.uses, removedDefinitionIds: plan.removedDefinitionIds,
      baseToken: deletionBaseToken()!,
    };
    return true;
  }

  async function confirmDeleteImportedSubcircuit(): Promise<boolean> {
    const pending = pendingDefinitionDeletion.value;
    if (pending === null) return false;
    pendingDefinitionDeletion.value = null;
    if (deletionBaseToken() !== pending.baseToken || editor === null) {
      openError.value = "电路内容已变化，请重新查看删除影响。";
      return false;
    }
    const file = serializeProjectFile({
      document: editor.snapshot().document, inputValues: state.value.inputValues,
      definitions: embeddedDefinitions, libraryRoots: embeddedLibraryRoots,
    });
    const plan = planDeleteDefinition(file, pending.definitionId);
    if (!plan.ok) { openError.value = plan.errors[0]?.message ?? "删除定义失败。"; return false; }
    return commitDefinitionDeletion(plan);
  }

  function cancelDeleteImportedSubcircuit(): void {
    pendingDefinitionDeletion.value = null;
  }

  /** 仅清除待确认候选，不改变已采用快照或编辑器历史。 */
  function cancelReimport(): void {
    pendingReimport.value = null;
    pendingReimportCommit = null;
  }

  /** 确认预告并提交；重复确认不会重复建帧。 */
  async function confirmReimport(): Promise<boolean> {
    const prepared = pendingReimportCommit;
    cancelReimport();
    return prepared === null ? false : commitReimport(prepared);
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

  /** Subcircuit 删除必须移除完整扁平子树；普通元件继续走既有单对象事务。 */
  async function deleteComponentCommand(componentId: EditorComponentId): Promise<void> {
    const snapshot = editor?.snapshot();
    const component = snapshot?.document.components.find((candidate) => candidate.id === componentId);
    if (snapshot && component?.kind === "subcircuit") {
      await replaceVisibleHierarchyDocument({
        components: snapshot.document.components.filter((candidate) => candidate.id !== componentId),
        connections: snapshot.document.connections,
      });
      return;
    }
    await dispatch({ type: "delete-component", componentId });
  }

  async function deleteSelectionCommand(): Promise<void> {
    const selection = editor?.snapshot().selection;
    if (selection?.kind === "component") {
      const component = editor?.snapshot().document.components.find((candidate) => candidate.id === selection.id);
      if (component?.kind === "subcircuit") {
        await deleteComponentCommand(selection.id);
        return;
      }
    }
    await dispatch({ type: "delete-selected" });
  }

  async function deleteConnectionCommand(connectionId: string): Promise<void> {
    const snapshot = editor?.snapshot();
    const connection = snapshot?.document.connections.find((candidate) => candidate.id === connectionId);
    const touchesSubcircuit = connection !== undefined && snapshot?.document.components.some((component) =>
      component.kind === "subcircuit" &&
      (component.id === connection.source.componentId || component.id === connection.target.componentId));
    if (snapshot && connection && touchesSubcircuit) {
      await replaceVisibleHierarchyDocument({
        components: snapshot.document.components,
        connections: snapshot.document.connections.filter((candidate) => candidate.id !== connectionId),
      });
      return;
    }
    await dispatch({ type: "delete-connection", connectionId });
  }

  async function confirmClearCommand(): Promise<void> {
    const snapshot = editor?.snapshot();
    if (snapshot && adoptedHierarchy !== null) {
      await dispatch({ type: "cancel-current-operation" });
      await replaceVisibleHierarchyDocument({ components: [], connections: [] });
      return;
    }
    await dispatch({ type: "confirm-clear" });
  }

  /**
   * 把文档写入指定路径并落定保存结果：成功则文档身份切换为该路径、脏标记清除并记录最近项目；
   * 失败只记录可展示原因，编辑器内容原样保留。
   * 序列化与校验都在这一刻完成，写入期间用户的继续编辑会反映在保存结束后的脏标记上。
   */
  async function commitSave(path: string, fileOverride?: ProjectFileData): Promise<boolean> {
    const content = fileOverride === undefined
      ? serializeCurrentProjectFile()
      : JSON.stringify(fileOverride);
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
    const previousPath = projectPath.value;
    const previousKey = projectPathIdentity(previousPath ?? "untitled.circuit.json");
    const nextKey = projectPathIdentity(path);
    if (previousKey !== nextKey) {
      for (const adopted of adoptedProjectionRevisions.values()) {
        const historicalFile = adopted.projectFiles.get(previousKey);
        if (historicalFile === undefined) continue;
        adopted.projectFiles.delete(previousKey);
        adopted.projectFiles.set(nextKey, historicalFile);
      }
    }
    projectPath.value = path;
    if (adoptedProjectFiles !== null) {
      const cache = new Map(adoptedProjectFiles);
      cache.delete(previousKey);
      const currentFile = fileOverride ?? serializeProjectFile({
        document: editor!.snapshot().document,
        inputValues: state.value.inputValues,
        definitions: embeddedDefinitions,
        libraryRoots: embeddedLibraryRoots,
      });
      cache.set(projectPathIdentity(path), currentFile);
      adoptedProjectFiles = cache;
    }
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
    const current = editor.snapshot();
    const file = serializeProjectFile({ document: current.document, inputValues: state.value.inputValues, definitions: embeddedDefinitions, libraryRoots: embeddedLibraryRoots });
    return saveToPath(dialog.path, file);
  }

  /**
   * 将当前文档保存到指定路径；内嵌定义不含源路径，移动文件无需重定位。
   * @param path 目标路径。
   * @param preparedFile 可选的已序列化文件，内部另存为流程用于避免重复取快照。
   * @returns 写入成功返回 true；任何计算或 IO 失败均保留原身份和脏状态。
   */
  async function saveToPath(path: string, preparedFile?: ProjectFileData): Promise<boolean> {
    if (!editor) return false;
    const current = preparedFile ?? serializeProjectFile({ document: editor.snapshot().document, inputValues: state.value.inputValues, definitions: embeddedDefinitions, libraryRoots: embeddedLibraryRoots });
    return commitSave(path, current);
  }

  async function save(): Promise<boolean> {
    if (!editor) return false;
    if (projectPath.value === null) return saveAs();
    return commitSave(projectPath.value);
  }

  /**
   * 从解析成功的项目文件数据完成打开：整体替换推送到引擎，成功后重建端点几何并接入
   * 编辑器会话。任何一步失败都给出可展示原因，当前编辑器状态原样保留。
   * @param path 项目文件的路径；打开成功后成为文档身份并记入最近项目。
   * @param parsed 校验通过的项目文件数据。
   * @returns 打开成功返回 true。
   */
  async function pushParsedProject(
    path: string,
    parsed: ParsedProjectFile,
  ): Promise<boolean> {
    // 引擎不在线时推送必然是空操作：先给出可展示的原因，而不是等推送悄悄返回。
    if (state.value.engineState !== "ready") {
      openError.value = "仿真引擎不可用，无法打开项目。";
      return false;
    }
    // 已保存的 v2 文件也可能含同名定义；打开时同步画布使用处的编号。
    const file = labelDefinitionUses(parsed.file);
    const projectFiles = new Map<string, ProjectFileData>([
      [projectPathIdentity(path), file],
    ]);
    const hierarchy = await flattenProjectHierarchy({
      rootIdentity: path,
      root: file,
    });
    if (disposed) return false;
    const circuit = circuitFromHierarchy(hierarchy);
    const loaded = await workspace.openCircuit(circuit, {
      inputValues: parsed.inputValues,
    });
    if (disposed) return false;
    if (loaded.bindings === null) {
      openError.value = loaded.snapshot.operationError ?? "打开项目失败。";
      return false;
    }
    const projectedBindings = hierarchyBindings(loaded.bindings, hierarchy);
    state.value = workspace.rebindSimulation(projectedBindings);
    const refreshed = await workspace.refreshReadings();
    if (disposed) return false;
    state.value = refreshed;
    // 解析出的端点 point 是占位零点（#35 契约）：端口清单此刻已由引擎回传，先用元件位置
    // 与端口几何重建端点与 Route，再把文档交给会话；占位值不能带进后续编辑。
    const document = rebuildLoadedDocumentGeometry(
      {
        components: hierarchy.document.components.map((component) => ({
          ...component,
          ...(projectedBindings.ports?.[component.id] !== undefined ? { ports: projectedBindings.ports[component.id] } : {}),
        })),
        connections: hierarchy.document.connections,
      },
      defaultComponentDefinitionRegistry,
    );
    finishDocumentLoad({ snapshot: state.value }, document, projectedBindings, path, hierarchy, circuit, projectFiles);
    if (hierarchy.diagnostics.length > 0) {
      openError.value = `项目已打开，部分连接或定义需要检查：${hierarchy.diagnostics.map((item) => item.message).join("；")}`;
    }
    recordRecentProject(path);
    return true;
  }

  async function openProjectFromPath(path: string): Promise<boolean> {
    // 首启空状态（#40）没有编辑器会话也必须能打开：会话由这次成功加载的 attachEditor 建立。
    const file = await adapter.readProjectFile(path);
    if (disposed) return false;
    if (!file.ok) {
      openError.value = file.reason;
      // 目标文件已不存在的最近项目条目立刻移出列表：留着它只会让用户反复撞上同一个错误。
      if (file.code === PROJECT_FILE_NOT_FOUND_CODE) removeRecentProject(path);
      return false;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(file.content);
    } catch (error) {
      openError.value = `项目文件不是合法的 JSON：${error instanceof Error ? error.message : "解析失败"}`;
      return false;
    }
    const parsed = parseProjectFile(raw);
    if (!parsed.ok) {
      // 校验失败整体拒绝：只展示第一条原因，完整清单属于调试信息而非界面文案。
      openError.value = `项目文件校验失败：${parsed.errors[0]?.message ?? "未知原因"}`;
      return false;
    }
    return pushParsedProject(path, parsed.value);
  }

  async function performOpen(): Promise<void> {
    // 首启空状态没有会话也可以打开：置脏确认以「有文档」为前提，无会话时文档不存在、无需确认。
    openError.value = null;
    const dialog = await adapter.pickOpenPath();
    if (!dialog.ok) {
      // 取消不是失败：不打断用户，也不清掉上一次的错误提示。
      if (dialog.reason !== "canceled") openError.value = dialog.reason;
      return;
    }
    await openProjectFromPath(dialog.path);
  }

  /**
   * 新建空文档：空文档走与打开同一条整体替换推送路径——成功后旧电路从引擎移除、
   * 工作区回到无电路状态、时间线归零；脏基线由 attachEditor 重置为空文档本身。
   */
  async function performNew(): Promise<void> {
    // 首启空状态没有会话也可以新建：成功后空文档会话由 attachEditor 建立。
    openError.value = null;
    if (state.value.engineState !== "ready") {
      openError.value = "仿真引擎不可用，无法新建文档。";
      return;
    }
    const loaded = await workspace.openCircuit({ components: [], connections: [] });
    if (disposed) return;
    if (loaded.bindings === null) {
      openError.value = loaded.snapshot.operationError ?? "新建文档失败。";
      return;
    }
    finishDocumentLoad(loaded, { components: [], connections: [] }, loaded.bindings, null);
  }

  /**
   * 文件操作的公共前言：已有确认挂起时不叠加强求；文档置脏时先挂起等待确认。
   * @returns 是否可以直接执行该操作（false 表示已挂起或已有挂起，调用方直接返回）。
   */
  function beginFileAction(action: PendingFileActionKind, openPath?: string): boolean {
    if (pendingFileAction.value !== null) return false;
    if (isDirty.value) {
      pendingOpenPath = openPath ?? null;
      pendingFileAction.value = action;
      return false;
    }
    return true;
  }

  /** 文件操作的入口：文档置脏时先确认，否则直接执行。 */
  async function requestOpen(): Promise<void> {
    if (!beginFileAction("open")) return;
    await performOpen();
  }

  /**
   * 从最近项目入口打开指定项目：文档置脏时先经过与对话框打开相同的未保存确认，
   * 确认或文档干净时走 `openProjectFromPath` 的同一条加载路径。
   * 目标文件已不存在时给出可展示原因并把该条目移出最近项目（见 `openProjectFromPath`）。
   * @param path 最近项目条目记录的路径。
   */
  async function requestOpenRecent(path: string): Promise<void> {
    if (!beginFileAction("open", path)) return;
    openError.value = null;
    await openProjectFromPath(path);
  }

  async function requestNew(): Promise<void> {
    if (!beginFileAction("new")) return;
    await performNew();
  }

  async function requestLoadExample(): Promise<void> {
    if (!beginFileAction("load-example")) return;
    await performLoadExample();
  }

  async function confirmPendingFileAction(): Promise<void> {
    const action = pendingFileAction.value;
    const openPath = pendingOpenPath;
    pendingFileAction.value = null;
    pendingOpenPath = null;
    if (action === "open") {
      // 最近项目入口挂起的打开直接打开原路径；对话框打开照常询问位置。
      if (openPath !== null) {
        openError.value = null;
        await openProjectFromPath(openPath);
      } else {
        await performOpen();
      }
    } else if (action === "new") await performNew();
    else if (action === "load-example") await performLoadExample();
  }

  function cancelPendingFileAction(): void {
    pendingFileAction.value = null;
    pendingOpenPath = null;
  }

  /** 创建或安全重接连接；失败只返回错误，草稿由画布交互层继续保留。 */
  async function createConnection(left: Parameters<WorkspaceBinding["createConnection"]>[0], right: Parameters<WorkspaceBinding["createConnection"]>[1], route?: readonly Point[], connectionId?: string, color?: WireColorId): Promise<{ ok: boolean; error?: string }> {
    const snapshot = editor?.snapshot();
    const subcircuitIds = new Set(snapshot?.document.components
      .filter((component) => component.kind === "subcircuit")
      .map((component) => component.id) ?? []);
    const existing = connectionId === undefined
      ? undefined
      : snapshot?.document.connections.find((connection) => connection.id === connectionId);
    const touchesSubcircuit = subcircuitIds.has(left.componentId) || subcircuitIds.has(right.componentId) ||
      (existing !== undefined && (subcircuitIds.has(existing.source.componentId) || subcircuitIds.has(existing.target.componentId)));
    if (snapshot && adoptedHierarchy !== null && touchesSubcircuit) {
      const { source, target } = normalizeConnectionEndpoints(left, right);
      const id = connectionId ?? nextConnectionId(snapshot.document);
      const nextConnection = {
        id,
        source: { componentId: source.componentId, port: source.port, point: { ...source.point } },
        target: { componentId: target.componentId, port: target.port, point: { ...target.point } },
        lifecycle: "visible" as const,
        danglingEndpoints: [] as const,
        ...(route ? { route: route.map((point) => ({ ...point })), waypoints: route.length > 2 ? route.slice(1, -1).map((point) => ({ ...point })) : [] } : {}),
        ...(color !== undefined ? { color } : existing?.color !== undefined ? { color: existing.color } : {}),
      };
      const connections = connectionId === undefined
        ? [...snapshot.document.connections, nextConnection]
        : snapshot.document.connections.map((connection) => connection.id === connectionId ? nextConnection : connection);
      const succeeded = await replaceVisibleHierarchyDocument({ components: snapshot.document.components, connections });
      return succeeded
        ? { ok: true }
        : { ok: false, error: editor?.snapshot().error?.message ?? "层次 Connection 提交失败。" };
    }
    const command = connectionId
      ? { type: "reconnect-connection" as const, connectionId, left, right, route }
      : { type: "create-connection" as const, left, right, route, color };
    const result = await runEditorCommand(command);
    if (result === null) return { ok: false, error: "编辑器尚未准备好。" };
    return result.ok ? { ok: true } : { ok: false, error: result.error.message };
  }

  function nextConnectionId(document: EditorDocument): string {
    const occupied = new Set(document.connections.map((connection) => connection.id));
    let sequence = 1;
    while (occupied.has(`connection-${sequence}`)) sequence += 1;
    return `connection-${sequence}`;
  }

  async function reconnectConnection(connectionId: string, left: Parameters<WorkspaceBinding["createConnection"]>[0], right: Parameters<WorkspaceBinding["createConnection"]>[1], route?: readonly Point[]): Promise<{ ok: boolean; error?: string }> {
    return createConnection(left, right, route, connectionId);
  }

  let disposePromise: Promise<void> | null = null;
  return {
    async dispose(): Promise<void> {
      if (disposePromise !== null) return disposePromise;
      disposed = true;
      recoveryWaitCancel?.();
      recoveryWaitCancel = null;
      unsubscribeWorkspace();
      unsubscribeEditor?.();
      unsubscribeEditor = null;
      disposePromise = (async () => {
        // Stop the scheduler before closing the keyed engine. Awaiting pause also
        // makes closeTab's completion a reliable lifecycle boundary for callers.
        await workspace.pause();
        await adapter.closeDocument?.();
      })();
      return disposePromise;
    },
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
    setInternalSignalTableVisible,
    select: (selection) => dispatch({ type: "select", selection }),
    moveComponent: (componentId, position) => dispatch({ type: "move-component", componentId, position }),
    editRoute: (connectionId, route) => dispatch({ type: "edit-route", connectionId, route }),
    createConnection,
    reconnectConnection,
    resetRoute: (connectionId) => dispatch({ type: "reset-route", connectionId }),
    setWireColor: (connectionId, color) => dispatch({ type: "set-wire-color", connectionId, color }),
    deleteWaypoint: (connectionId, pointIndex) => dispatch({ type: "delete-waypoint", connectionId, pointIndex }),
    deleteSelection: deleteSelectionCommand,
    deleteComponent: deleteComponentCommand,
    setPortWidthCommand,
    deleteConnection: deleteConnectionCommand,
    requestClear: () => dispatch({ type: "request-clear" }),
    confirmClear: confirmClearCommand,
    cancelCurrentOperation: () => dispatch({ type: "cancel-current-operation" }),
    undo: () => dispatch({ type: "undo" }),
    redo: () => dispatch({ type: "redo" }),
    beginPlacement: (kind, continuous = false) => dispatch({ type: "begin-placement", kind, continuous }),
    updatePlacement: (center, altKey = false) => dispatch({ type: "update-placement", center, altKey }),
    placeComponent,
    retryPlacement,
    addComponent,
    duplicateComponent,
    addSubcircuitFromDialog,
    importSubcircuitOnlyFromDialog,
    placeImportedSubcircuit,
    renameImportedSubcircuit,
    reimportEmbeddedDefinition,
    exportImportedSubcircuit,
    exportFeedback: readonly(exportFeedback),
    requestDeleteImportedSubcircuit,
    confirmDeleteImportedSubcircuit,
    cancelDeleteImportedSubcircuit,
    pendingDefinitionDeletion: readonly(pendingDefinitionDeletion),
    pendingReimport: readonly(pendingReimport),
    confirmReimport,
    cancelReimport,
    libraryTree,
    getEmbeddedDefinition,
    projectPath: readonly(projectPath),
    isDirty: readonly(isDirty),
    saveError: readonly(saveError),
    setSaveError(message) { saveError.value = message; },
    canSave,
    projectName,
    saveState,
    save,
    saveAs,
    saveToPath,
    openError: readonly(openError),
    pendingFileAction: readonly(pendingFileAction),
    requestOpen,
    requestNew,
    confirmPendingFileAction,
    cancelPendingFileAction,
    openProjectFromPath,
    recentProjects: readonly(recentProjects),
    requestOpenRecent,
    requestLoadExample,
  };
}
