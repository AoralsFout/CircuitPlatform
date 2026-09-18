import { computed, ref, watch, type DeepReadonly, type Ref } from "vue";
import type { BitRange, ComponentKindName, PortSpec, Signal } from "@circuit-platform/protocol";
import {
  readDefaultWireColor,
  writeDefaultWireColor,
  type EditorComponentId,
  type EditorConnectionId,
  type EditorSelection,
  type EditorSnapshot,
  type Point,
  type WireColorId,
} from "../editor/index.ts";
import { coerceInputValue, inputBitsOf, type InputBit, type InputKey, type InputValue, type WorkspaceSnapshot } from "../workspace/index.ts";
import {
  componentGeometryFor,
  createComponentDefinitionRegistry,
  createCanvasSceneProjector,
  createFrameCoalescer,
  createNodeDragController,
  createRouteEditController,
  createViewportState,
  emptyCanvasScene,
  fitViewportToBounds,
  resizeViewport,
  setViewportZoomAt,
  type InteractionState,
  type ViewportState,
} from "../canvas/index.ts";
import { createInspectorModel, type InspectorModel } from "../editor/inspector.ts";
import { defaultPortsFor, portsWithBitRanges } from "../editor/bus-ports.ts";
import {
  readRecentComponentKinds,
  writeRecentComponentKind,
} from "../editor/component-menu.ts";
import { positionFromPlacementCenter } from "../editor/placement.ts";
import {
  connectionDraftRoute,
  createConnectionDraft,
  reduceConnectionDraft,
  type ConnectionDraftPort,
  type ConnectionDraftState,
} from "../editor/connection-draft.ts";
import { createSimulationSnapshot } from "../editor/simulation.ts";

export type RailPage = "components" | "inputs" | "layers" | "settings";
export type BottomTab = "inspector" | "outputs" | "waveform";
export type WaveformKey = "a" | "b" | "output";

export interface WaveformRow {
  label: string;
  key: WaveformKey;
}

/** 位按钮组里的一位：它属于哪个 Input、在取值文本里的位置，以及当前取值。 */
export interface InputBitControl {
  /** 该位在取值文本里的下标：0 是最左、也是最高位；组内按它排序与导航。 */
  index: number;
  /** 该位的位号（`[N-1:0]` 记法）；用于无障碍标签，用户据此知道自己在拨哪一位。 */
  place: number;
  value: InputBit;
}

/** 输入设置里的一个 Input 元件：元件标签、完整多位读数，以及它按位展开的方形按钮。 */
export interface InputControl {
  key: InputKey;
  index: number;
  label: string;
  /** 该 Input 当前的完整多位取值，长度等于 `width`；按钮组与读数共用同一个值。 */
  value: InputValue;
  /** 端口声明的位宽；1 位与多位共用同一套视觉，只有按钮个数不同。 */
  width: number;
  /** 按位展开的按钮，从最高位到最低位排列，渲染时每行八列。 */
  bits: readonly InputBitControl[];
  componentId: string | null;
}

const waveformRows: readonly WaveformRow[] = [
  { label: "输入 A", key: "a" },
  { label: "输入 B", key: "b" },
  { label: "输出", key: "output" },
];

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
  createConnection: (left: ConnectionDraftPort, right: ConnectionDraftPort, route?: readonly Point[], connectionId?: string, color?: WireColorId) => Promise<{ ok: boolean; error?: string }> = async () => ({ ok: false }),
  setPortWidthCommand: (componentId: EditorComponentId, ports: readonly PortSpec[]) => Promise<void> = async () => undefined,
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
  const sceneProjector = createCanvasSceneProjector(registry);
  let recentStorage: Storage | null = null;
  try {
    recentStorage = typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // 浏览器禁用持久化时，最近使用仍保存在当前内存会话中。
  }
  const recentComponentKinds = ref(readRecentComponentKinds(recentStorage, registry.list()));
  const defaultWireColor = ref<WireColorId>(readDefaultWireColor(recentStorage));
  const draggingComponentId = ref<EditorComponentId | null>(null);
  const dragPreview = ref<{ componentId: EditorComponentId; position: Point } | null>(null);
  const dragController = createNodeDragController({
    onPreview(preview) {
      dragPreview.value = { componentId: preview.nodeId, position: { ...preview.position } };
    },
    onCommit(preview) {
      void moveComponent(preview.nodeId, preview.position).finally(() => {
        draggingComponentId.value = null;
        dragPreview.value = null;
      });
    },
    onCancel() {
      draggingComponentId.value = null;
      dragPreview.value = null;
    },
  });
  const routeEditPreview = ref<{ connectionId: string; route: readonly Point[] } | null>(null);
  const connectionDraft = ref<ConnectionDraftState>(createConnectionDraft());
  const connectionMoveCoalescer = createFrameCoalescer<{ point: Point; altKey: boolean }>(({ point, altKey }) => {
    connectionDraft.value = reduceConnectionDraft(connectionDraft.value, { type: "move", point, altKey });
  });
  // 键盘焦点是临时的 DOM 导航状态，不能从 EditorSnapshot 的选择状态推导。
  const focusedId = ref<string | null>(null);
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
    return preview ? { [preview.componentId]: { ...preview.position } } : {};
  });
  const previewRoutes = computed<Readonly<Record<string, readonly Point[]>> | undefined>(() => {
    const preview = routeEditPreview.value;
    return preview ? { [preview.connectionId]: preview.route } : undefined;
  });

  const canvasScene = computed(() => {
    const snapshot = editorState.value;
    if (!snapshot) return emptyCanvasScene();
    const simulation = createSimulationSnapshot(snapshot, {
      inputA: workspaceState.value.inputA,
      inputB: workspaceState.value.inputB,
      inputValues: workspaceState.value.inputValues,
      signals: workspaceState.value.signals,
    });
    return sceneProjector.project(snapshot, simulation, previewPositions.value, previewRoutes.value);
  });
  const inspector = computed<InspectorModel>(() => createInspectorModel(
    canvasScene.value,
    editorState.value?.selection ?? null,
    registry,
  ));
  const viewport = computed<ViewportState>(() => viewportState.value);
  const interaction = computed<InteractionState>(() => {
    if (workspaceState.value.engineState !== "ready") {
      return { focusedId: focusedId.value, draggingComponentId: null, dragPreview: null, connectionDraft: null, routeEditPreview: null, emptyState: { title: "等待仿真引擎", message: workspaceState.value.message } };
    }
    if (!workspaceState.value.hasCircuit) {
      return { focusedId: focusedId.value, draggingComponentId: null, dragPreview: null, connectionDraft: null, routeEditPreview: null, emptyState: { title: "正在准备示例电路", message: workspaceState.value.message } };
    }
    if (!editorState.value) {
      return { focusedId: focusedId.value, draggingComponentId: null, dragPreview: null, connectionDraft: null, routeEditPreview: null, emptyState: { title: "还没有电路", message: "从左侧选择一个元件，或加载一份示例电路开始。" } };
    }
    if (editorState.value.document.components.length === 0 && !editorState.value.pendingPlacement) {
      return { focusedId: focusedId.value, draggingComponentId: null, dragPreview: null, connectionDraft: null, emptyState: { title: "还没有电路", message: "从左侧选择一个元件，或加载一份示例电路开始。" } };
    }
    const pending = editorState.value.pendingPlacement;
    const definition = pending ? registry.get(pending.kind) : undefined;
    // 放置预览的盒子与放下去之后的节点必须是同一份尺寸：端口数量由数据决定的元件高度按端口数
    // 增长，用展示定义里那个固定尺寸画出来的预览会比真节点矮一大截，点下去就像跳了一下。
    const pendingPorts = pending ? defaultPortsFor(pending.kind) ?? [] : [];
    const pendingSize = definition ? componentGeometryFor(definition, pendingPorts).size : undefined;
    return {
      focusedId: focusedId.value,
      draggingComponentId: draggingComponentId.value,
      dragPreview: dragPreview.value,
      connectionDraft: connectionDraft.value.origin ? connectionDraftRoute(connectionDraft.value) : null,
      connectionDraftError: connectionDraft.value.error?.message ?? null,
      routeEditPreview: routeEditPreview.value,
      pendingPlacement: pending && pending.center && pendingSize
        ? { kind: pending.kind, position: positionFromPlacementCenter(pending.center, pendingSize, pending.altKey), size: pendingSize, error: editorState.value.error?.message ?? null }
        : null,
    };
  });

  /** 从任意方向的端口开始临时连接；提交前不会改动 EditorDocument。 */
  function startConnection(port: ConnectionDraftPort): void {
    if (editorState.value?.pendingPlacement || editorState.value?.operation !== "idle") return;
    connectionMoveCoalescer.cancel();
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
    connectionMoveCoalescer.schedule({ point: { ...point }, altKey });
  }

  /** 点击或拖拽释放到空白处时保留一个首个 Waypoint，继续点击式布线。 */
  function placeConnectionWaypoint(point: Point, altKey = false): void {
    connectionMoveCoalescer.flush();
    connectionDraft.value = reduceConnectionDraft(connectionDraft.value, { type: "place-waypoint", point, altKey });
  }

  /** 释放到端口时提交一个结构事务；失败保留草稿和用户 Route。 */
  async function finishConnection(port: ConnectionDraftPort): Promise<void> {
    connectionMoveCoalescer.flush();
    const draft = connectionDraft.value;
    if (!draft.origin) return;
    const route = connectionDraftRoute(draft, port);
    // 输出端拖到已占用输入时也自动进入重接模式；输入端起笔时 connectionId 已在 startConnection 标记。
    const targetConnectionId = editorState.value?.document.connections.find((connection) =>
      connection.lifecycle === "visible" && connection.target.componentId === (draft.origin?.direction === "input" ? draft.origin.componentId : port.componentId) &&
      connection.target.port === (draft.origin?.direction === "input" ? draft.origin.port : port.port),
    )?.id;
    const replacingConnectionId = draft.connectionId ?? targetConnectionId;
    const result = await createConnection(
      draft.origin,
      port,
      route,
      replacingConnectionId,
      replacingConnectionId ? undefined : defaultWireColor.value,
    );
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
    connectionMoveCoalescer.flush();
    connectionDraft.value = reduceConnectionDraft(connectionDraft.value, { type: "toggle-axis" });
  }

  /** 键盘 Backspace 退回最近一个临时折点；不触碰历史记录或持久文档。 */
  function removeConnectionWaypoint(): void {
    connectionMoveCoalescer.flush();
    connectionDraft.value = reduceConnectionDraft(connectionDraft.value, { type: "remove-waypoint" });
  }

  /** 右键优先删除最近一个临时折点；没有折点时直接取消当前布线。 */
  function removeConnectionWaypointOrCancel(): void {
    connectionMoveCoalescer.flush();
    connectionDraft.value = reduceConnectionDraft(connectionDraft.value, { type: "remove-waypoint-or-cancel" });
  }

  function cancelConnection(): void {
    connectionMoveCoalescer.cancel();
    connectionDraft.value = reduceConnectionDraft(connectionDraft.value, { type: "cancel" });
  }

  /** 记录画布当前键盘焦点；焦点与单对象选择保持独立。 */
  function focusCanvasObject(id: string | null): void {
    focusedId.value = id;
  }

  const sidebarComponents = computed(() => editorState.value?.document.components.map((component) => ({
    id: component.id,
    kind: component.kind,
    displayName: component.displayName,
    selected: editorState.value?.selection?.kind === "component" && editorState.value.selection.id === component.id,
  })) ?? []);
  const selectedComponentId = computed<EditorComponentId | null>(() => {
    const selection = editorState.value?.selection;
    return selection?.kind === "component" ? selection.id : null;
  });
  const selectedConnection = computed<EditorConnectionId | null>(() => {
    const selection = editorState.value?.selection;
    return selection?.kind === "connection" ? selection.id : null;
  });
  /**
   * 输入设置的展示模型：每个 Input 元件一个条目，取值按端口位宽展开成逐位按钮。
   *
   * 位宽来自画布节点的端口清单（也就是引擎回传的那一份），不来自任何前端内置定义。取值先按
   * 该位宽对齐再展开，因此改宽之后、下一次求值之前，这里也不会出现长度对不上的读数或按钮数。
   */
  const inputControls = computed<readonly InputControl[]>(() => canvasScene.value.nodes.filter((node) => node.kind === "input").map((node, index) => {
    const width = node.ports.find((port) => port.direction === "output")?.width ?? 1;
    const value = coerceInputValue(
      workspaceState.value.inputValues[node.id] ?? (index === 0 ? workspaceState.value.inputA : index === 1 ? workspaceState.value.inputB : undefined),
      width,
    );
    return {
      key: node.id as InputKey,
      index: index + 1,
      label: node.displayName,
      value,
      width,
      bits: inputBitsOf(value).map((bit, bitIndex) => ({ index: bitIndex, place: width - 1 - bitIndex, value: bit })),
      componentId: node.id,
    };
  }));
  // 输出面板读取文档中全部 Output 元件，每个元件显示自己求值后的信号。
  const outputs = computed(() => canvasScene.value.nodes.filter((node) => node.kind === "output").map((node) => ({
    key: node.id,
    label: node.displayName,
    value: node.ports.find((port) => port.direction === "input")?.signal ?? "X",
    description: node.description,
  })));
  const engineStateLabel = computed(() => {
    if (workspaceState.value.engineState === "ready") return "引擎在线";
    if (workspaceState.value.engineState === "unavailable") return "引擎不可用";
    if (workspaceState.value.engineState === "error") return "连接失败";
    return "连接中";
  });
  /**
   * 提交一次位宽编辑。
   *
   * 载荷是**整份端口清单**：协议里的改宽是整体替换，因此这里从当前场景取回该元件的端口清单，
   * 只换掉目标端口的位宽再提交。编辑器因此不必在提交前重算匹配规则，引擎也不必接受一种
   * 「按单端口下发」的形状。
   * @param componentId 要改的元件。
   * @param portName 要改位宽的端口。
   * @param width 新的位宽。
   */
  function setPortWidth(componentId: EditorComponentId, portName: string, width: number): void {
    const node = canvasScene.value.nodes.find((candidate) => candidate.id === componentId);
    if (!node) return;
    const ports = node.ports.map((port) => ({
      name: port.id,
      direction: port.direction,
      width: port.id === portName ? width : port.width,
      ...(port.bitRange ? { bitRange: { ...port.bitRange } } : {}),
    }));
    void setPortWidthCommand(componentId, ports);
  }

  /**
   * 提交一次位区间列表编辑。
   *
   * 与改位宽走同一条结构提交：载荷是整份端口清单，分支数量、名字与位宽都按新列表重算，宿主
   * 总线端口原样保留。覆盖规则由引擎判定，这里不做第二份——越界、重叠、漏位各自带着可展示的
   * 原因回来，而模型在提交成功之前不会变，因此失败时用户看到的仍是提交前的列表。
   * @param componentId 要改的元件。
   * @param ranges 新的位区间列表，从最高位段到最低位段。
   */
  function setBitRanges(componentId: EditorComponentId, ranges: readonly BitRange[]): void {
    const node = canvasScene.value.nodes.find((candidate) => candidate.id === componentId);
    if (!node) return;
    const ports = node.ports.map((port) => ({
      name: port.id,
      direction: port.direction,
      width: port.width,
      ...(port.bitRange ? { bitRange: { ...port.bitRange } } : {}),
    }));
    void setPortWidthCommand(componentId, portsWithBitRanges(node.kind, ports, ranges));
  }

  const selectedComponent = computed(() => canvasScene.value.nodes.find((node) => node.id === selectedComponentId.value));
  const selectedComponentName = computed(() => selectedConnection.value ? `Wire ${selectedConnection.value}` : selectedComponent.value?.displayName ?? "未选择");
  const selectedComponentValue = computed<Signal>(() => selectedConnection.value ? canvasScene.value.wires.find((wire) => wire.id === selectedConnection.value)?.signal ?? "X" : selectedComponent.value?.ports.find((port) => port.direction === "output")?.signal ?? selectedComponent.value?.ports[0]?.signal ?? "X");
  const selectedComponentDescription = computed(() => selectedConnection.value ? "选择的视觉连线；按 Delete 或 Backspace 可单独删除。" : selectedComponent.value?.description ?? "在画布或侧栏中选择一个 Component。");
  const selectedObjectId = computed(() => selectedConnection.value ?? selectedComponentId.value);
  const zoomLabel = computed(() => `${zoom.value}%`);

  function selectComponent(componentId: EditorComponentId): void {
    if (!editorState.value?.document.components.some((component) => component.id === componentId)) return;
    void selectEditor({ kind: "component", id: componentId });
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

  /** 修改并持久化新建 Wire 的默认外观；既有 Wire 保持自己的颜色。 */
  function setDefaultWireColor(color: WireColorId): void {
    defaultWireColor.value = writeDefaultWireColor(recentStorage, color);
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

  /** 开始 Component 临时拖动；只更新 InteractionState，不创建编辑器快照。 */
  function startNodeDrag(nodeId: EditorComponentId, pointerWorld: Point): void {
    const node = canvasScene.value.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    draggingComponentId.value = nodeId;
    dragPreview.value = { componentId: nodeId, position: { ...node.position } };
    dragController.start(nodeId, node.position, pointerWorld);
  }

  /** 合并 pointer move 到下一帧，并按世界坐标网格预览 Component 与 Wire。 */
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
    selectedConnection,
    sidebarComponents,
    selectedComponentId,
    showDetails,
    showSidebar,
    activeRailPage,
    bottomTab,
    zoom,
    waveformRows,
    inputControls,
    outputs,
    engineStateLabel,
    selectedComponentName,
    selectedComponentValue,
    selectedComponentDescription,
    selectedObjectId,
    zoomLabel,
    canvasScene,
    inspector,
    viewport,
    interaction,
    componentDefinitions: registry.list(),
    recentComponentKinds,
    defaultWireColor,
    setDefaultWireColor,
    rememberComponentKind,
    selectComponent,
    selectConnection,
    setPortWidth,
    setBitRanges,
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
    removeConnectionWaypoint,
    removeConnectionWaypointOrCancel,
    cancelConnection,
    focusCanvasObject,
  };
}
