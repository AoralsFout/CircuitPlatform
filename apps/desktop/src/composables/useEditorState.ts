import { computed, ref, type DeepReadonly, type Ref } from "vue";
import type { Signal } from "@circuit-platform/protocol";
import type { InputKey, WorkspaceSnapshot } from "../workspace";

export type NodeKey = "inputA" | "inputB" | "andGate" | "output";
export type RailPage = "components" | "inputs" | "layers" | "settings";
export type BottomTab = "inspector" | "outputs" | "waveform";
export type WaveformKey = "a" | "b" | "output";

export interface WaveformRow {
  label: string;
  key: WaveformKey;
}

const waveformRows: readonly WaveformRow[] = [
  { label: "输入 A", key: "a" },
  { label: "输入 B", key: "b" },
  { label: "输出", key: "output" },
];

/**
 * 管理只属于编辑器界面的选择、布局与缩放状态，并从工作区快照派生展示数据。
 * @param workspaceState 只读的工作区行为快照。
 * @returns 编辑器状态、派生展示数据和局部交互操作。
 */
export function useEditorState(workspaceState: DeepReadonly<Ref<WorkspaceSnapshot>>) {
  const selectedNode = ref<NodeKey>("andGate");
  const showDetails = ref(false);
  const showSidebar = ref(true);
  const activeRailPage = ref<RailPage>("components");
  const bottomTab = ref<BottomTab>("outputs");
  const zoom = ref(100);

  const inputControls = computed(() => [
    {
      key: "a" as InputKey,
      label: "输入 A",
      value: workspaceState.value.inputA,
      componentId: workspaceState.value.labIds?.inputA ?? null,
    },
    {
      key: "b" as InputKey,
      label: "输入 B",
      value: workspaceState.value.inputB,
      componentId: workspaceState.value.labIds?.inputB ?? null,
    },
  ]);
  const outputs = computed(() => [
    {
      key: "output",
      label: "输出",
      value: workspaceState.value.outputValue,
      description: workspaceState.value.outputDescription,
      componentId: workspaceState.value.labIds?.output ?? null,
    },
  ]);
  const engineStateLabel = computed(() => {
    if (workspaceState.value.engineState === "ready") return "引擎在线";
    if (workspaceState.value.engineState === "unavailable") return "引擎不可用";
    if (workspaceState.value.engineState === "error") return "连接失败";
    return "连接中";
  });
  const selectedNodeName = computed(() => {
    if (selectedNode.value === "inputA") return "输入 A";
    if (selectedNode.value === "inputB") return "输入 B";
    if (selectedNode.value === "andGate") return "AND 门";
    return "输出";
  });
  const selectedNodeValue = computed<Signal>(() => {
    if (selectedNode.value === "inputA") return workspaceState.value.inputA;
    if (selectedNode.value === "inputB") return workspaceState.value.inputB;
    return workspaceState.value.outputValue;
  });
  const selectedNodeDescription = computed(() => {
    if (selectedNode.value === "inputA" || selectedNode.value === "inputB") {
      return "点击开关或画布节点，改变这个输入值。";
    }
    if (selectedNode.value === "andGate") return "两个输入都为 1 时，输出才为 1。";
    return workspaceState.value.outputDescription;
  });
  const selectedNodeId = computed(
    () => workspaceState.value.labIds?.[selectedNode.value] ?? null,
  );
  const zoomLabel = computed(() => `${zoom.value}%`);

  function selectNode(node: NodeKey): void {
    selectedNode.value = node;
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
    selectRailPage,
    adjustZoom,
  };
}
