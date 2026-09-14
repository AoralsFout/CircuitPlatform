import { readonly, shallowRef, type DeepReadonly, type Ref } from "vue";
import {
  createAndDemoDocument,
  createEditorSession,
  type EditorBindings,
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
import type { Point } from "../editor";

interface WorkspaceBinding {
  state: DeepReadonly<Ref<WorkspaceSnapshot>>;
  editorState: DeepReadonly<Ref<EditorSnapshot | null>>;
  bootstrap(): Promise<void>;
  checkEngine(): Promise<void>;
  runSimulation(): Promise<void>;
  toggleInput(key: InputKey): Promise<void>;
  select(selection: EditorSelection): Promise<void>;
  deleteSelection(): Promise<void>;
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
  placeComponent(center: Point, altKey?: boolean): Promise<void>;
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

  return {
    state: readonly(state),
    editorState: readonly(editorState),
    bootstrap: checkEngine,
    checkEngine,
    runSimulation,
    toggleInput,
    select: (selection) => dispatch({ type: "select", selection }),
    deleteSelection: () => dispatch({ type: "delete-selected" }),
    requestClear: () => dispatch({ type: "request-clear" }),
    confirmClear: () => dispatch({ type: "confirm-clear" }),
    cancelCurrentOperation: () => dispatch({ type: "cancel-current-operation" }),
    undo: () => dispatch({ type: "undo" }),
    redo: () => dispatch({ type: "redo" }),
    beginPlacement: (kind, continuous = false) => dispatch({ type: "begin-placement", kind, continuous }),
    updatePlacement: (center, altKey = false) => dispatch({ type: "update-placement", center, altKey }),
    placeComponent: (center, altKey = false) => dispatch({ type: "place-component", center, altKey }),
  };
}
