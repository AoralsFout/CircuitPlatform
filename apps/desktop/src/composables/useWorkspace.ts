import { readonly, shallowRef, type DeepReadonly, type Ref } from "vue";
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
  type InputKey,
  type SimulationBindings,
  type WorkspaceSnapshot,
} from "../workspace/index.ts";
import type { ComponentKindName } from "@circuit-platform/protocol";

interface WorkspaceBinding {
  state: DeepReadonly<Ref<WorkspaceSnapshot>>;
  editorState: DeepReadonly<Ref<EditorSnapshot | null>>;
  bootstrap(): Promise<void>;
  checkEngine(): Promise<void>;
  runSimulation(): Promise<void>;
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
  toggleInput(key: InputKey): Promise<void>;
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
}

function toEditorBindings(bindings: SimulationBindings): EditorBindings {
  return { components: bindings.components, connections: bindings.connections ?? {}, componentKinds: bindings.componentKinds };
}

/**
 * 将工作区领域模块与 EditorSession 接入 Vue，并统一管理真实运行时身份。
 * @returns 只读仿真/编辑器快照，以及基于稳定 editor ID 的界面操作。
 */
export function useWorkspace(): WorkspaceBinding {
  const adapter = (window as unknown as { circuitPlatform: EngineAdapter }).circuitPlatform;
  const workspace = createWorkspace(adapter);
  const state = shallowRef(workspace.snapshot());
  // 连续运行的每一拍由工作区自行排定，因此界面靠订阅拿到那部分快照变化。
  workspace.subscribe((snapshot) => {
    state.value = snapshot;
  });
  const editorState = shallowRef<EditorSnapshot | null>(null);
  let editor: EditorSession | null = null;
  let unsubscribeEditor: (() => void) | null = null;
  let simulationRefreshRequested = false;

  async function reflect(operation: () => Promise<WorkspaceSnapshot>): Promise<void> {
    const pending = operation();
    state.value = workspace.snapshot();
    state.value = await pending;
  }

  // EditorSession 的结构 settle 用于验证 Circuit；工作区仍需重新提交当前输入并读取可展示信号。
  async function refreshSimulationAfterBindingsChange(): Promise<void> {
    if (!simulationRefreshRequested) {
      state.value = workspace.snapshot();
      return;
    }
    simulationRefreshRequested = false;
    await reflect(() => workspace.runSimulation());
  }

  function attachEditor(document: EditorDocument, bindings: SimulationBindings): void {
    unsubscribeEditor?.();
    editor = createEditorSession(
      { document, bindings: toEditorBindings(bindings) },
      createProtocolEnginePort(adapter),
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

  async function runSimulation(): Promise<void> {
    await reflect(() => workspace.runSimulation());
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

  async function toggleInput(key: InputKey): Promise<void> {
    await reflect(() => workspace.toggleInput(key));
  }

  async function dispatch(command: Parameters<EditorSession["dispatch"]>[0]): Promise<void> {
    if (!editor) return;
    const pending = editor.dispatch(command);
    editorState.value = editor.snapshot();
    const result = await pending;
    editorState.value = result.snapshot;
    await refreshSimulationAfterBindingsChange();
  }

  /** 右键菜单直接复用 EditorSession 的 add-component 命令；成功才返回 true。 */
  async function addComponent(kind: ComponentKindName, center: Point, altKey = false, continuous = false): Promise<boolean> {
    if (!editor) return false;
    const pending = editor.dispatch({ type: "add-component", kind, position: center, altKey, continuous });
    editorState.value = editor.snapshot();
    const result = await pending;
    editorState.value = result.snapshot;
    await refreshSimulationAfterBindingsChange();
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
    return result.ok;
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
    runSimulation,
    start,
    pause,
    resume,
    step,
    reset,
    toggleInput,
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
  };
}
