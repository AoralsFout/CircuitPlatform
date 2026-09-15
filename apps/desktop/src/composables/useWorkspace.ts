import { readonly, shallowRef, type DeepReadonly, type Ref } from "vue";
import {
  createAndDemoDocument,
  createEditorSession,
  type EditorBindings,
  type EditorComponentId,
  type Point,
  type EditorSelection,
  type EditorSession,
  type EditorSnapshot,
} from "../editor";
import { createProtocolEnginePort } from "../editor/protocolEnginePort";
import {
  createWorkspace,
  type DemoRuntimeBindings,
  type InputKey,
  type LabIds,
  type WorkspaceSnapshot,
} from "../workspace";
import type { ComponentKindName } from "@circuit-platform/protocol";

interface WorkspaceBinding {
  state: DeepReadonly<Ref<WorkspaceSnapshot>>;
  editorState: DeepReadonly<Ref<EditorSnapshot | null>>;
  bootstrap(): Promise<void>;
  checkEngine(): Promise<void>;
  runSimulation(): Promise<void>;
  toggleInput(key: InputKey): Promise<void>;
  select(selection: EditorSelection): Promise<void>;
  moveComponent(componentId: EditorComponentId, position: Point): Promise<void>;
  editRoute(connectionId: string, route: readonly Point[]): Promise<void>;
  createConnection(left: {
    componentId: string;
    port: string;
    direction: "input" | "output";
    point: Point;
  }, right: {
    componentId: string;
    port: string;
    direction: "input" | "output";
    point: Point;
  }, route?: readonly Point[], connectionId?: string): Promise<{ ok: boolean; error?: string }>;
  /** 使用稳定 Editor Connection ID 修复悬空端点或替换已占用输入。 */
  reconnectConnection(connectionId: string, left: Parameters<WorkspaceBinding["createConnection"]>[0], right: Parameters<WorkspaceBinding["createConnection"]>[1], route?: readonly Point[]): Promise<{ ok: boolean; error?: string }>;
  resetRoute(connectionId: string): Promise<void>;
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
  /** 使用与画布待放置流程相同的添加命令，在指定 WorldPoint 添加一个元件。 */
  addComponent(kind: ComponentKindName, center: Point, altKey?: boolean, continuous?: boolean): Promise<boolean>;
  /** 复制指定稳定编辑器元件；副本不继承连接、路线、选择或信号。 */
  duplicateComponent(componentId?: EditorComponentId): Promise<boolean>;
}

function toEditorBindings(bindings: DemoRuntimeBindings): EditorBindings {
  return {
    components: {
      "input-a": bindings.components.inputA,
      "input-b": bindings.components.inputB,
      "and-gate": bindings.components.andGate,
      output: bindings.components.output,
    },
    connections: {
      "wire-a": bindings.connections.wireA,
      "wire-b": bindings.connections.wireB,
      "wire-output": bindings.connections.wireOutput,
    },
  };
}

function toSimulationBindings(bindings: EditorBindings): LabIds | null {
  const inputA = bindings.components["input-a"];
  const inputB = bindings.components["input-b"];
  const andGate = bindings.components["and-gate"];
  const output = bindings.components.output;
  const hasCompleteWiring = ["wire-a", "wire-b", "wire-output"]
    .every((id) => bindings.connections[id] !== undefined);
  return inputA === undefined || inputB === undefined || andGate === undefined || output === undefined || !hasCompleteWiring
    ? null
    : { inputA, inputB, andGate, output };
}

/**
 * 将工作区领域模块与 EditorSession 接入 Vue，并统一管理真实运行时身份。
 * @returns 只读仿真/编辑器快照，以及基于稳定 editor ID 的界面操作。
 */
export function useWorkspace(): WorkspaceBinding {
  const adapter = window.circuitPlatform;
  const workspace = createWorkspace(adapter);
  const state = shallowRef(workspace.snapshot());
  const editorState = shallowRef<EditorSnapshot | null>(null);
  let editor: EditorSession | null = null;
  let unsubscribeEditor: (() => void) | null = null;

  async function reflect(operation: () => Promise<WorkspaceSnapshot>): Promise<void> {
    const pending = operation();
    state.value = workspace.snapshot();
    state.value = await pending;
  }

  function attachEditor(bindings: DemoRuntimeBindings): void {
    unsubscribeEditor?.();
    editor = createEditorSession(
      { document: createAndDemoDocument(), bindings: toEditorBindings(bindings) },
      createProtocolEnginePort(adapter),
      {
        // EditorSession 只询问一个布尔可用性 seam；引擎状态仍留在 Workspace 快照中。
        isEngineAvailable: () => workspace.snapshot().engineState === "ready",
        onBindingsChanged(nextBindings) {
          state.value = workspace.rebindSimulation(toSimulationBindings(nextBindings));
        },
      },
    );
    editorState.value = editor.snapshot();
    unsubscribeEditor = editor.subscribe((snapshot) => {
      editorState.value = snapshot;
    });
  }

  async function loadDemoWhenReady(): Promise<void> {
    if (state.value.engineState !== "ready" || state.value.hasLab) return;
    const pending = workspace.loadDemoCircuit();
    state.value = workspace.snapshot();
    const loaded = await pending;
    state.value = loaded.snapshot;
    if (loaded.bindings) attachEditor(loaded.bindings);
  }

  async function checkEngine(): Promise<void> {
    await reflect(() => workspace.checkEngine());
    editor?.setEngineAvailability(state.value.engineState === "ready");
    await loadDemoWhenReady();
  }

  async function runSimulation(): Promise<void> {
    await reflect(() => workspace.runSimulation());
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
    state.value = workspace.snapshot();
  }

  /** 右键菜单直接复用 EditorSession 的 add-component 命令；成功才返回 true。 */
  async function addComponent(kind: ComponentKindName, center: Point, altKey = false, continuous = false): Promise<boolean> {
    if (!editor) return false;
    const pending = editor.dispatch({ type: "add-component", kind, position: center, altKey, continuous });
    editorState.value = editor.snapshot();
    const result = await pending;
    editorState.value = result.snapshot;
    state.value = workspace.snapshot();
    return result.ok;
  }

  /** 复制当前选中元件或显式指定的元件，并复用 EditorSession 的结构事务。 */
  async function duplicateComponent(componentId?: EditorComponentId): Promise<boolean> {
    if (!editor) return false;
    const command = componentId
      ? { type: "duplicate-component" as const, componentId }
      : { type: "duplicate-selected" as const };
    const pending = editor.dispatch(command);
    editorState.value = editor.snapshot();
    const result = await pending;
    editorState.value = result.snapshot;
    state.value = workspace.snapshot();
    return result.ok;
  }

  /** 提交元件库产生的待放置意图；成功才返回 true，供最近使用偏好记录使用。 */
  async function placeComponent(center: Point, altKey = false): Promise<boolean> {
    if (!editor) return false;
    const pending = editor.dispatch({ type: "place-component", center, altKey });
    editorState.value = editor.snapshot();
    const result = await pending;
    editorState.value = result.snapshot;
    state.value = workspace.snapshot();
    return result.ok;
  }

  /** 提交一次完成的连接意图；失败只返回错误，草稿由画布交互层继续保留。 */
  /** 创建或安全重接连接；调用者只传稳定编辑器 ID，不接触引擎身份。 */
  async function createConnection(left: Parameters<WorkspaceBinding["createConnection"]>[0], right: Parameters<WorkspaceBinding["createConnection"]>[1], route?: readonly Point[], connectionId?: string): Promise<{ ok: boolean; error?: string }> {
    if (!editor) return { ok: false, error: "编辑器尚未准备好。" };
    const pending = editor.dispatch(connectionId
      ? { type: "reconnect-connection", connectionId, left, right, route }
      : { type: "create-connection", left, right, route });
    editorState.value = editor.snapshot();
    const result = await pending;
    editorState.value = result.snapshot;
    state.value = workspace.snapshot();
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
    toggleInput,
    select: (selection) => dispatch({ type: "select", selection }),
    moveComponent: (componentId, position) => dispatch({ type: "move-component", componentId, position }),
    editRoute: (connectionId, route) => dispatch({ type: "edit-route", connectionId, route }),
    createConnection,
    reconnectConnection,
    resetRoute: (connectionId) => dispatch({ type: "reset-route", connectionId }),
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
    addComponent,
    duplicateComponent,
  };
}
