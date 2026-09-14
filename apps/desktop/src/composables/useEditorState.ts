import { computed, ref, watch, type DeepReadonly, type Ref } from "vue";
import type { Signal } from "@circuit-platform/protocol";
import type { EditorComponentId, EditorConnectionId, EditorSelection, EditorSnapshot } from "../editor";
import type { InputKey, WorkspaceSnapshot } from "../workspace";
import {
  createComponentDefinitionRegistry,
  createViewportState,
  emptyCanvasScene,
  fitViewportToBounds,
  projectCanvasScene,
  resizeViewport,
  setViewportZoomAt,
  type InteractionState,
  type ViewportState,
} from "../canvas";
import { positionFromPlacementCenter } from "../editor/placement.ts";
import type { Point } from "../editor";

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
  updatePlacement?: (center: Point, altKey?: boolean) => Promise<void>,
) {
  const showDetails = ref(false);
  const showSidebar = ref(true);
  const activeRailPage = ref<RailPage>("components");
  const bottomTab = ref<BottomTab>("outputs");
  // 视口是临时交互状态，独立于 EditorDocument，因此不会进入撤销或项目持久化。
  const viewportState = ref(createViewportState());
  const hasFittedInitialScene = ref(false);
  const zoom = computed({
    get: () => Math.round(viewportState.value.zoom * 100),
    set: (value: number) => {
      const center = {
        x: viewportState.value.visibleRect.width / 2,
        y: viewportState.value.visibleRect.height / 2,
      };
      viewportState.value = setViewportZoomAt(viewportState.value, value / 100, center);
    },
  });
  const registry = createComponentDefinitionRegistry();

  const canvasScene = computed(() => {
    const snapshot = editorState.value;
    if (!snapshot) return emptyCanvasScene();
    const inputComponents = snapshot.document.components.filter((component) => component.kind === "input");
    const signals: Record<string, Signal> = {};
    inputComponents.forEach((component) => {
      // 示例输入由工作区控制；通过元件库新建的 Input 从 0 开始，不继承示例状态。
      signals[`${component.id}:out`] = component.id === "input-a"
        ? workspaceState.value.inputA
        : component.id === "input-b"
          ? workspaceState.value.inputB
          : 0;
    });
    for (const component of snapshot.document.components) {
      const definition = registry.get(component.kind);
      if (!definition) continue;
      for (const port of definition.ports) {
        if (signals[`${component.id}:${port.id}`] !== undefined) continue;
        const isDemoComponent = ["input-a", "input-b", "and-gate", "output"].includes(component.id);
        signals[`${component.id}:${port.id}`] = isDemoComponent && port.direction === "output" && component.kind !== "input"
          ? workspaceState.value.outputValue
          : "X";
      }
    }
    return projectCanvasScene(snapshot, { signals }, registry);
  });
  const viewport = computed<ViewportState>(() => viewportState.value);
  const interaction = computed<InteractionState>(() => {
    if (workspaceState.value.engineState !== "ready") {
      return { focusedId: null, draggingNodeId: null, connectionDraft: null, emptyState: { title: "等待仿真引擎", message: workspaceState.value.message } };
    }
    if (!workspaceState.value.hasLab) {
      return { focusedId: null, draggingNodeId: null, connectionDraft: null, emptyState: { title: "正在准备示例电路", message: workspaceState.value.message } };
    }
    if (!editorState.value || editorState.value.document.components.length === 0) {
      return { focusedId: null, draggingNodeId: null, connectionDraft: null, emptyState: { title: "还没有电路", message: "从左侧选择一个元件，或加载一份示例电路开始。" } };
    }
    const pending = editorState.value.pendingPlacement;
    const definition = pending ? registry.get(pending.kind) : undefined;
    return {
      focusedId: editorState.value.selection?.id ?? null,
      draggingNodeId: null,
      connectionDraft: null,
      pendingPlacement: pending && pending.center && definition
        ? { kind: pending.kind, position: positionFromPlacementCenter(pending.center, definition.size, pending.altKey), size: definition.size }
        : null,
    };
  });

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

  function placementMoved(center: Point, altKey = false): void {
    void updatePlacement?.(center, altKey);
  }

  function selectRailPage(page: RailPage): void {
    activeRailPage.value = page;
    if (page !== "settings") showSidebar.value = true;
  }

  function adjustZoom(delta: number): void {
    zoom.value = zoom.value + delta;
  }

  /** 让整个场景在当前画布中居中显示；只改变视口，不创建编辑器历史记录。 */
  function fitViewport(): void {
    viewportState.value = fitViewportToBounds(viewportState.value, canvasScene.value.bounds);
  }

  /** 在 DOM 尺寸变化时更新视口，保持原视口中心的世界坐标不变。 */
  function resizeCanvas(width: number, height: number): void {
    viewportState.value = resizeViewport(viewportState.value, { width, height });
  }

  /** 应用画布交互层计算出的新视口；不会触碰编辑器文档或历史栈。 */
  function setViewport(next: ViewportState): void {
    viewportState.value = next;
  }

  watch(canvasScene, (scene) => {
    if (hasFittedInitialScene.value || scene.nodes.length === 0) return;
    hasFittedInitialScene.value = true;
    viewportState.value = fitViewportToBounds(viewportState.value, scene.bounds);
  }, { immediate: true });

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
    canvasScene,
    viewport,
    interaction,
    componentDefinitions: registry.list(),
    selectNode,
    selectConnection,
    selectRailPage,
    adjustZoom,
    fitViewport,
    resizeCanvas,
    setViewport,
    placementMoved,
  };
}
