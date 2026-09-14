import { computed, ref, watch, type DeepReadonly, type Ref } from "vue";
import type { ComponentKindName, Signal } from "@circuit-platform/protocol";
import type { EditorComponentId, EditorConnectionId, EditorSelection, EditorSnapshot, Point } from "../editor";
import type { InputKey, WorkspaceSnapshot } from "../workspace";
import {
  createComponentDefinitionRegistry,
  createNodeDragController,
  createRouteEditController,
  createViewportState,
  emptyCanvasScene,
  fitViewportToBounds,
  projectCanvasScene,
  resizeViewport,
  setViewportZoomAt,
  type InteractionState,
  type ViewportState,
} from "../canvas";
import {
  readRecentComponentKinds,
  writeRecentComponentKind,
} from "../editor/component-menu";
import { positionFromPlacementCenter } from "../editor/placement.ts";
import {
  connectionDraftRoute,
  createConnectionDraft,
  reduceConnectionDraft,
  type ConnectionDraftPort,
  type ConnectionDraftState,
} from "../editor/connection-draft.ts";

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
  moveComponent: (componentId: EditorComponentId, position: Point) => Promise<void> = async () => undefined,
  updatePlacement?: (center: Point, altKey?: boolean) => Promise<void>,
  editRoute: (connectionId: EditorConnectionId, route: readonly Point[]) => Promise<void> = async () => undefined,
  createConnection: (left: ConnectionDraftPort, right: ConnectionDraftPort, route?: readonly Point[], connectionId?: string) => Promise<{ ok: boolean; error?: string }> = async () => ({ ok: false }),
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
  let recentStorage: Storage | null = null;
  try {
    recentStorage = typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // 浏览器禁用持久化时，最近使用仍保存在当前内存会话中。
  }
  const recentComponentKinds = ref(readRecentComponentKinds(recentStorage, registry.list()));
  const draggingNodeId = ref<EditorComponentId | null>(null);
  const dragPreview = ref<{ nodeId: EditorComponentId; position: Point } | null>(null);
  const dragController = createNodeDragController({
    onPreview(preview) {
      dragPreview.value = { nodeId: preview.nodeId, position: { ...preview.position } };
    },
    onCommit(preview) {
      void moveComponent(preview.nodeId, preview.position).finally(() => {
        draggingNodeId.value = null;
        dragPreview.value = null;
      });
    },
    onCancel() {
      draggingNodeId.value = null;
      dragPreview.value = null;
    },
  });
  const routeEditPreview = ref<{ connectionId: string; route: readonly Point[] } | null>(null);
  const connectionDraft = ref<ConnectionDraftState>(createConnectionDraft());
  const routeEditController = createRouteEditController({
    onPreview(preview) {
      routeEditPreview.value = preview;
    },
    onCommit(preview) {
      void editRoute(preview.connectionId, preview.route).finally(() => {
        routeEditPreview.value = null;
      });
    },
    onCancel() {
      routeEditPreview.value = null;
    },
  });
  const previewPositions = computed<Readonly<Record<string, Point>>>(() => {
    const preview = dragPreview.value;
    return preview ? { [preview.nodeId]: { ...preview.position } } : {};
  });

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
    return projectCanvasScene(snapshot, { signals }, registry, previewPositions.value, routeEditPreview.value ? { [routeEditPreview.value.connectionId]: routeEditPreview.value.route } : undefined);
  });
  const viewport = computed<ViewportState>(() => viewportState.value);
  const interaction = computed<InteractionState>(() => {
    if (workspaceState.value.engineState !== "ready") {
      return { focusedId: null, draggingNodeId: null, dragPreview: null, connectionDraft: null, routeEditPreview: null, emptyState: { title: "等待仿真引擎", message: workspaceState.value.message } };
    }
    if (!workspaceState.value.hasLab) {
      return { focusedId: null, draggingNodeId: null, dragPreview: null, connectionDraft: null, routeEditPreview: null, emptyState: { title: "正在准备示例电路", message: workspaceState.value.message } };
    }
    if (!editorState.value) {
      return { focusedId: null, draggingNodeId: null, dragPreview: null, connectionDraft: null, routeEditPreview: null, emptyState: { title: "还没有电路", message: "从左侧选择一个元件，或加载一份示例电路开始。" } };
    }
    if (editorState.value.document.components.length === 0 && !editorState.value.pendingPlacement) {
      return { focusedId: null, draggingNodeId: null, dragPreview: null, connectionDraft: null, emptyState: { title: "还没有电路", message: "从左侧选择一个元件，或加载一份示例电路开始。" } };
    }
    const pending = editorState.value.pendingPlacement;
    const definition = pending ? registry.get(pending.kind) : undefined;
    return {
      focusedId: editorState.value.selection?.id ?? null,
      draggingNodeId: draggingNodeId.value,
      dragPreview: dragPreview.value,
      connectionDraft: connectionDraft.value.origin ? connectionDraftRoute(connectionDraft.value) : null,
      connectionDraftError: connectionDraft.value.error?.message ?? null,
      routeEditPreview: routeEditPreview.value,
      pendingPlacement: pending && pending.center && definition
        ? { kind: pending.kind, position: positionFromPlacementCenter(pending.center, definition.size, pending.altKey), size: definition.size }
        : null,
    };
  });

  /** 从任意方向的端口开始临时连接；提交前不会改动 EditorDocument。 */
  function startConnection(port: ConnectionDraftPort): void {
    if (editorState.value?.pendingPlacement || editorState.value?.operation !== "idle") return;
    const connectionId = editorState.value.document.connections.find((connection) => {
      const endpointMatches = (endpoint: { componentId: string; port: string }): boolean => endpoint.componentId === port.componentId && endpoint.port === port.port;
      return connection.lifecycle === "visible" && (
        (port.direction === "input" && endpointMatches(connection.target)) ||
        connection.danglingEndpoints.some((side) => endpointMatches(side === "source" ? connection.source : connection.target))
      );
    })?.id;
    connectionDraft.value = reduceConnectionDraft(connectionDraft.value, { type: "start", port, connectionId });
  }

  /** 更新草稿指针预览；不创建快照或历史记录。 */
  function moveConnection(point: Point, altKey = false): void {
    connectionDraft.value = reduceConnectionDraft(connectionDraft.value, { type: "move", point, altKey });
  }

  /** 点击或拖拽释放到空白处时保留一个首个 Waypoint，继续点击式布线。 */
  function placeConnectionWaypoint(point: Point, altKey = false): void {
    connectionDraft.value = reduceConnectionDraft(connectionDraft.value, { type: "place-waypoint", point, altKey });
  }

  /** 释放到端口时提交一个结构事务；失败保留草稿和用户 Route。 */
  async function finishConnection(port: ConnectionDraftPort): Promise<void> {
    const draft = connectionDraft.value;
    if (!draft.origin) return;
    const route = connectionDraftRoute(draft, port);
    // 输出端拖到已占用输入时也自动进入重接模式；输入端起笔时 connectionId 已在 startConnection 标记。
    const targetConnectionId = editorState.value?.document.connections.find((connection) =>
      connection.lifecycle === "visible" && connection.target.componentId === (draft.origin?.direction === "input" ? draft.origin.componentId : port.componentId) &&
      connection.target.port === (draft.origin?.direction === "input" ? draft.origin.port : port.port),
    )?.id;
    const result = await createConnection(draft.origin, port, route, draft.connectionId ?? targetConnectionId);
    if (result.ok) {
      connectionDraft.value = createConnectionDraft();
    } else {
      connectionDraft.value = reduceConnectionDraft(connectionDraft.value, {
        type: "fail",
        error: { code: "engine-failed", message: result.error ?? "连接提交失败。" },
      });
    }
  }

  /** Space 在布线期间只切换当前段轴向；Esc 由工作区命令清除草稿。 */
  function toggleConnectionAxis(): void {
    connectionDraft.value = reduceConnectionDraft(connectionDraft.value, { type: "toggle-axis" });
  }

  function cancelConnection(): void {
    connectionDraft.value = reduceConnectionDraft(connectionDraft.value, { type: "cancel" });
  }

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

  /** 记录已成功添加的类型；失败的引擎命令不会经过此入口。 */
  function rememberComponentKind(kind: ComponentKindName): void {
    recentComponentKinds.value = writeRecentComponentKind(recentStorage, recentComponentKinds.value, kind);
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

  /** 开始节点临时拖动；只更新 InteractionState，不创建编辑器快照。 */
  function startNodeDrag(nodeId: EditorComponentId, pointerWorld: Point): void {
    const node = canvasScene.value.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    draggingNodeId.value = nodeId;
    dragPreview.value = { nodeId, position: { ...node.position } };
    dragController.start(nodeId, node.position, pointerWorld);
  }

  /** 合并 pointer move 到下一帧，并按世界坐标网格预览节点与 Wire。 */
  function moveNodeDrag(pointerWorld: Point, altKey = false): void {
    dragController.move(pointerWorld, altKey);
  }

  /** 结束节点拖动；实际位移只提交一个布局历史命令。 */
  function endNodeDrag(): void {
    dragController.end();
  }

  /** 取消节点拖动；不提交历史。 */
  function cancelNodeDrag(): void {
    dragController.cancel();
  }

  /** 开始一个 Wire 折点/线段的临时拖动。 */
  function startRouteEdit(connectionId: string, route: readonly Point[], target: Parameters<typeof routeEditController.start>[2], pointerWorld: Point): void {
    routeEditController.start(connectionId, route, target, pointerWorld);
  }

  /** 合并 Wire pointer move，并在释放时提交一次 Route 历史命令。 */
  function moveRouteEdit(pointerWorld: Point, altKey = false): void {
    routeEditController.move(pointerWorld, altKey);
  }

  function endRouteEdit(): void {
    routeEditController.end();
  }

  function cancelRouteEdit(): void {
    routeEditController.cancel();
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
    recentComponentKinds,
    rememberComponentKind,
    selectNode,
    selectConnection,
    selectRailPage,
    adjustZoom,
    fitViewport,
    resizeCanvas,
    setViewport,
    startNodeDrag,
    moveNodeDrag,
    endNodeDrag,
    cancelNodeDrag,
    startRouteEdit,
    moveRouteEdit,
    endRouteEdit,
    cancelRouteEdit,
    placementMoved,
    connectionDraft,
    startConnection,
    moveConnection,
    placeConnectionWaypoint,
    finishConnection,
    toggleConnectionAxis,
    cancelConnection,
  };
}
