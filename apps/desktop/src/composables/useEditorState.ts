import { computed, ref, type DeepReadonly, type Ref } from "vue";
import type { Signal } from "@circuit-platform/protocol";
import type { EditorComponentId, EditorConnectionId, EditorSelection, EditorSnapshot } from "../editor";
import type { InputKey, WorkspaceSnapshot } from "../workspace";

export type NodeKey = "inputA" | "inputB" | "andGate" | "output";
export type RailPage = "components" | "inputs" | "layers" | "settings";
export type BottomTab = "inspector" | "outputs" | "waveform";
export type WaveformKey = "a" | "b" | "output";
export type WireKey = "wireA" | "wireB" | "wireOutput";

export interface WireDanglingState {
  source: boolean;
  target: boolean;
}

export interface WaveformRow {
  label: string;
  key: WaveformKey;
}

const waveformRows: readonly WaveformRow[] = [
  { label: "输入 A", key: "a" },
  { label: "输入 B", key: "b" },
  { label: "输出", key: "output" },
];

const editorIdByNode: Record<NodeKey, EditorComponentId> = {
  inputA: "input-a",
  inputB: "input-b",
  andGate: "and-gate",
  output: "output",
};

const nodeByEditorId: Record<EditorComponentId, NodeKey | undefined> = {
  "input-a": "inputA",
  "input-b": "inputB",
  "and-gate": "andGate",
  output: "output",
};

/**
 * 管理只属于编辑器界面的选择、布局与缩放状态，并从工作区快照派生展示数据。
 * @param workspaceState 只读的工作区行为快照。
 * @param editorState 不包含 engine ID 的稳定编辑器投影。
 * @param selectEditor 由工作区组合层执行的选择命令。
 * @returns 编辑器状态、派生展示数据和局部交互操作。
 */
export function useEditorState(
  workspaceState: DeepReadonly<Ref<WorkspaceSnapshot>>,
  editorState: DeepReadonly<Ref<EditorSnapshot | null>>,
  selectEditor: (selection: EditorSelection) => Promise<void>,
) {
  const showDetails = ref(false);
  const showSidebar = ref(true);
  const activeRailPage = ref<RailPage>("components");
  const bottomTab = ref<BottomTab>("outputs");
  const zoom = ref(100);

  const componentVisibility = computed<Record<NodeKey, boolean>>(() => ({
    inputA: editorState.value?.document.components.some((component) => component.id === "input-a") ?? false,
    inputB: editorState.value?.document.components.some((component) => component.id === "input-b") ?? false,
    andGate: editorState.value?.document.components.some((component) => component.id === "and-gate") ?? false,
    output: editorState.value?.document.components.some((component) => component.id === "output") ?? false,
  }));
  const wireVisibility = computed<Record<WireKey, boolean>>(() => ({
    wireA: editorState.value?.document.connections.some((connection) => connection.id === "wire-a") ?? false,
    wireB: editorState.value?.document.connections.some((connection) => connection.id === "wire-b") ?? false,
    wireOutput: editorState.value?.document.connections.some((connection) => connection.id === "wire-output") ?? false,
  }));
  const wireDangling = computed<Record<WireKey, WireDanglingState>>(() => {
    const connectionState = (id: string): WireDanglingState => {
      const connection = editorState.value?.document.connections.find((item) => item.id === id);
      return {
        source: connection?.danglingEndpoints.includes("source") ?? false,
        target: connection?.danglingEndpoints.includes("target") ?? false,
      };
    };
    return {
      wireA: connectionState("wire-a"),
      wireB: connectionState("wire-b"),
      wireOutput: connectionState("wire-output"),
    };
  });
  const selectedNode = computed<NodeKey | null>(() => {
    const selection = editorState.value?.selection;
    return selection?.kind === "component" ? nodeByEditorId[selection.id] ?? null : null;
  });
  const selectedConnection = computed<EditorConnectionId | null>(() => {
    const selection = editorState.value?.selection;
    return selection?.kind === "connection" ? selection.id : null;
  });
  const inputControls = computed(() => [
    {
      key: "a" as InputKey,
      label: "输入 A",
      value: workspaceState.value.inputA,
      node: "inputA" as NodeKey,
    },
    {
      key: "b" as InputKey,
      label: "输入 B",
      value: workspaceState.value.inputB,
      node: "inputB" as NodeKey,
    },
  ].filter((input) => componentVisibility.value[input.node]));
  const outputs = computed(() => [
    {
      key: "output",
      label: "输出",
      value: workspaceState.value.outputValue,
      description: workspaceState.value.outputDescription,
    },
  ].filter(() => componentVisibility.value.output));
  const engineStateLabel = computed(() => {
    if (workspaceState.value.engineState === "ready") return "引擎在线";
    if (workspaceState.value.engineState === "unavailable") return "引擎不可用";
    if (workspaceState.value.engineState === "error") return "连接失败";
    return "连接中";
  });
  const selectedNodeName = computed(() => {
    if (selectedConnection.value === "wire-a") return "输入 A → AND";
    if (selectedConnection.value === "wire-b") return "输入 B → AND";
    if (selectedConnection.value === "wire-output") return "AND → 输出";
    if (selectedNode.value === null) return "未选择";
    if (selectedNode.value === "inputA") return "输入 A";
    if (selectedNode.value === "inputB") return "输入 B";
    if (selectedNode.value === "andGate") return "AND 门";
    return "输出";
  });
  const selectedNodeValue = computed<Signal>(() => {
    if (selectedConnection.value === "wire-a") return workspaceState.value.inputA;
    if (selectedConnection.value === "wire-b") return workspaceState.value.inputB;
    if (selectedConnection.value === "wire-output") return workspaceState.value.outputValue;
    if (selectedNode.value === null) return "X";
    if (selectedNode.value === "inputA") return workspaceState.value.inputA;
    if (selectedNode.value === "inputB") return workspaceState.value.inputB;
    return workspaceState.value.outputValue;
  });
  const selectedNodeDescription = computed(() => {
    if (selectedConnection.value) return "选择的视觉连线；按 Delete 或 Backspace 可单独删除。";
    if (selectedNode.value === null) return "在画布或层级面板中选择一个元件。";
    if (selectedNode.value === "inputA" || selectedNode.value === "inputB") {
      return "点击开关或画布节点，改变这个输入值。";
    }
    if (selectedNode.value === "andGate") return "两个输入都为 1 时，输出才为 1。";
    return workspaceState.value.outputDescription;
  });
  const selectedNodeId = computed(() => selectedConnection.value ?? (selectedNode.value ? editorIdByNode[selectedNode.value] : null));
  const zoomLabel = computed(() => `${zoom.value}%`);

  function selectNode(node: NodeKey): void {
    if (!componentVisibility.value[node]) return;
    void selectEditor({ kind: "component", id: editorIdByNode[node] });
  }

  function selectConnection(connectionId: EditorConnectionId): void {
    void selectEditor({ kind: "connection", id: connectionId });
  }

  function selectRailPage(page: RailPage): void {
    activeRailPage.value = page;
    if (page !== "settings") showSidebar.value = true;
  }

  function adjustZoom(delta: number): void {
    zoom.value = Math.min(140, Math.max(60, zoom.value + delta));
  }

  return {
    selectedNode,
    selectedConnection,
    componentVisibility,
    wireVisibility,
    wireDangling,
    showDetails,
    showSidebar,
    activeRailPage,
    bottomTab,
    zoom,
    waveformRows,
    inputControls,
    outputs,
    engineStateLabel,
    selectedNodeName,
    selectedNodeValue,
    selectedNodeDescription,
    selectedNodeId,
    zoomLabel,
    selectNode,
    selectConnection,
    selectRailPage,
    adjustZoom,
  };
}
