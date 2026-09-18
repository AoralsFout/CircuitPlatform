import { readonly, shallowRef, computed, type ComputedRef, type DeepReadonly, type Ref } from "vue";
import {
  createAndDemoDocument,
  createEditorSession,
  type EditorBindings,
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
  type EngineAdapter,
  type InputBit,
  type InputKey,
  type SimulationBindings,
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

/**
 * 将工作区领域模块与 EditorSession 接入 Vue，并统一管理真实运行时身份。
 * @returns 只读仿真/编辑器快照，以及基于稳定 editor ID 的界面操作。
 */
export function useWorkspace(): WorkspaceBinding {
  const adapter = (window as unknown as { circuitPlatform: EngineAdapter & ProjectFileBridge }).circuitPlatform;
  // 一条队列同时交给工作区与编辑器端口：运行中的推进、输入提交与结构提交因此排在同一个队里。
  const queue = createEngineCallQueue();
  const workspace = createWorkspace(adapter, { queue });
  const state = shallowRef(workspace.snapshot());
  // 连续运行的每一拍由工作区自行排定，因此界面靠订阅拿到那部分快照变化。
  workspace.subscribe((snapshot) => {
    state.value = snapshot;
  });
  const editorState = shallowRef<EditorSnapshot | null>(null);
  let editor: EditorSession | null = null;
  let unsubscribeEditor: (() => void) | null = null;
  let simulationRefreshRequested = false;

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

  function attachEditor(document: EditorDocument, bindings: SimulationBindings): void {
    unsubscribeEditor?.();
    editor = createEditorSession(
      { document, bindings: toEditorBindings(bindings) },
      createProtocolEnginePort(adapter, queue),
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

  async function dispatch(command: Parameters<EditorSession["dispatch"]>[0]): Promise<void> {
    if (!editor) return;
    const pending = editor.dispatch(command);
    editorState.value = editor.snapshot();
    const result = await pending;
    editorState.value = result.snapshot;
    await refreshSimulationAfterBindingsChange();
    refreshDirtyMarker();
  }

  /** 改宽走与其它结构提交同一条路径：先发命令，再按响应刷新编辑器与仿真。 */
  async function setPortWidthCommand(componentId: EditorComponentId, ports: readonly PortSpec[]): Promise<void> {
    await dispatch({ type: "set-port-width", componentId, ports });
  }

  /** 右键菜单直接复用 EditorSession 的 add-component 命令；成功才返回 true。 */
  async function addComponent(kind: ComponentKindName, center: Point, altKey = false, continuous = false): Promise<boolean> {
    if (!editor) return false;
    const pending = editor.dispatch({ type: "add-component", kind, position: center, altKey, continuous });
    editorState.value = editor.snapshot();
    const result = await pending;
    editorState.value = result.snapshot;
    await refreshSimulationAfterBindingsChange();
    refreshDirtyMarker();
    return result.ok;
  }

  /** 复制当前选中元件或显式指定的元件，并复用 EditorSession 的结构事务。 */
  async function duplicateComponent(componentId?: EditorComponentId): Promise<boolean> {
    if (!editor) return false;
    const selection = editor?.snapshot().selection;
    const selectedId = componentId ?? (selection?.kind === "component" ? selection.id : undefined);
    if (!selectedId) return false;
    const command = { type: "duplicate-component" as const, componentId: selectedId };
    const pending = editor.dispatch(command);
    editorState.value = editor.snapshot();
    const result = await pending;
    editorState.value = result.snapshot;
    await refreshSimulationAfterBindingsChange();
    refreshDirtyMarker();
    return result.ok;
  }

  /** 提交元件库产生的待放置意图；成功才返回 true，供最近使用偏好记录使用。 */
  async function placeComponent(center: Point, altKey = false): Promise<boolean> {
    if (!editor) return false;
    const pending = editor.dispatch({ type: "place-component", center, altKey });
    editorState.value = editor.snapshot();
    const result = await pending;
    editorState.value = result.snapshot;
    await refreshSimulationAfterBindingsChange();
    refreshDirtyMarker();
    return result.ok;
  }

  /** 将失败的待放置 ghost 重新提交给同一 canonical add-component 流程。 */
  async function retryPlacement(): Promise<boolean> {
    if (!editor) return false;
    const pending = editor.dispatch({ type: "retry-placement" });
    editorState.value = editor.snapshot();
    const result = await pending;
    editorState.value = result.snapshot;
    await refreshSimulationAfterBindingsChange();
    refreshDirtyMarker();
    return result.ok;
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
    if (!editor) return { ok: false, error: "编辑器尚未准备好。" };
    const pending = editor.dispatch(connectionId
      ? { type: "reconnect-connection", connectionId, left, right, route }
      : { type: "create-connection", left, right, route, color });
    editorState.value = editor.snapshot();
    const result = await pending;
    editorState.value = result.snapshot;
    await refreshSimulationAfterBindingsChange();
    refreshDirtyMarker();
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
