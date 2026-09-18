<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import BottomPanel from "./components/BottomPanel.vue";
import CircuitCanvas from "./components/CircuitCanvas.vue";
import ClearCanvasDialog from "./components/ClearCanvasDialog.vue";
import EditorToolbar from "./components/EditorToolbar.vue";
import SettingsPage from "./components/SettingsPage.vue";
import ToolRail from "./components/ToolRail.vue";
import TopBar from "./components/TopBar.vue";
import WorkspaceSidebar from "./components/WorkspaceSidebar.vue";
import { useEditorState } from "./composables/useEditorState";
import { useThemePreference } from "./composables/useThemePreference";
import { useWorkspace } from "./composables/useWorkspace";
import { isEditableKeyboardTarget, resolveEditorShortcut } from "./editor/keyboard";

const {
  state,
  editorState,
  bootstrap,
  checkEngine,
  start,
  pause,
  resume,
  step,
  toggleInput,
  select,
  moveComponent,
  deleteSelection,
  deleteComponent,
  deleteConnection,
  requestClear,
  confirmClear,
  cancelCurrentOperation,
  undo,
  redo,
  beginPlacement,
  updatePlacement,
  placeComponent: placeComponentCommand,
  retryPlacement,
  addComponent,
  duplicateComponent,
  editRoute,
  resetRoute,
  setWireColor,
  deleteWaypoint,
  createConnection,
} = useWorkspace();
const {
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
  inspector,
  selectedObjectId,
  zoomLabel,
  canvasScene,
  viewport,
  interaction,
  componentDefinitions,
  recentComponentKinds,
  defaultWireColor,
  setDefaultWireColor,
  rememberComponentKind,
  selectComponent,
  selectConnection,
  selectRailPage,
  adjustZoom,
  setViewport,
  fitViewport,
  resizeCanvas,
  startNodeDrag,
  moveNodeDrag,
  endNodeDrag,
  cancelNodeDrag,
  placementMoved,
  startRouteEdit,
  moveRouteEdit,
  endRouteEdit,
  cancelRouteEdit,
  startConnection,
  moveConnection,
  placeConnectionWaypoint,
  finishConnection,
  toggleConnectionAxis,
  removeConnectionWaypoint,
  removeConnectionWaypointOrCancel,
  cancelConnection,
  focusCanvasObject,
} = useEditorState(state, editorState, select, moveComponent, updatePlacement, editRoute, createConnection);
const {
  preference: themePreference,
  label: themeLabel,
  restore: restoreTheme,
  setPreference: setThemePreference,
  cycle: cycleTheme,
} = useThemePreference();

/** 键盘缩放的步进百分比，与工具栏按钮保持一致。 */
const ZOOM_STEP = 10;

const isBottomPanelExpanded = ref(true);

function toggleBottomPanel(): void {
  isBottomPanelExpanded.value = !isBottomPanelExpanded.value;
}

/** 提交画布待放置元件；成功后与右键菜单添加共用最近使用记录。 */
async function placeComponent(center: { x: number; y: number }, altKey: boolean): Promise<void> {
  const kind = editorState.value?.pendingPlacement?.kind;
  const succeeded = await placeComponentCommand(center, altKey);
  if (succeeded && kind) rememberComponentKind(kind);
}

/** 布线草稿存在时冻结元件放置，避免两种结构意图同时进行。 */
async function beginPlacementFromSidebar(kind: Parameters<typeof beginPlacement>[0], continuous = false): Promise<void> {
  if (interaction.value.connectionDraft) return;
  await beginPlacement(kind, continuous);
}

/** 布线草稿期间保持结构意图单一，不允许键盘或工具栏启动复制事务。 */
async function duplicateSelection(): Promise<void> {
  if (interaction.value.connectionDraft) return;
  await duplicateComponent();
}

/** 键盘上的「运行」是一个意图：已停止时开始，已暂停时继续，运行中不做任何事。 */
async function runSimulationFromKeyboard(): Promise<void> {
  if (state.value.simulationState === "stopped") await start();
  else if (state.value.simulationState === "paused") await resume();
}

function onEditorKeydown(event: KeyboardEvent): void {
  const target = event.target;
  const shortcut = resolveEditorShortcut({
    key: event.key,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    editableTarget: isEditableKeyboardTarget(target),
  });
  if (!shortcut) return;
  event.preventDefault();
  if (shortcut === "cancel") {
    // Esc 只取消当前最上层状态：确认框 → 恢复提示 → 草稿 → 拖动预览 → 选择。
    if (editorState.value?.confirmation) void cancelCurrentOperation();
    else if (editorState.value?.operation === "recovery-required") return;
    else if (interaction.value.connectionDraft) cancelConnection();
    else if (interaction.value.routeEditPreview) cancelRouteEdit();
    else if (interaction.value.draggingComponentId) cancelNodeDrag();
    else if (editorState.value?.pendingPlacement) void cancelCurrentOperation();
    else if (editorState.value?.selection) void cancelCurrentOperation();
    return;
  }
  if (editorState.value?.confirmation) return;
  switch (shortcut) {
    case "undo": void undo(); break;
    case "redo": void redo(); break;
    case "duplicate-selection": void duplicateSelection(); break;
    case "zoom-in": adjustZoom(ZOOM_STEP); break;
    case "zoom-out": adjustZoom(-ZOOM_STEP); break;
    case "zoom-fit": fitViewport(); break;
    case "start-or-resume-simulation": void runSimulationFromKeyboard(); break;
    case "pause-simulation": void pause(); break;
    case "step-simulation": void step(); break;
    case "delete-selection": void deleteSelection(); break;
    default: {
      // 新增 EditorShortcut 成员时这里会编译失败，避免静默落到删除分支。
      const unhandled: never = shortcut;
      void unhandled;
    }
  }
}

onMounted(() => {
  restoreTheme();
  window.addEventListener("keydown", onEditorKeydown);
  void bootstrap();
});

onBeforeUnmount(() => window.removeEventListener("keydown", onEditorKeydown));
</script>

<template>
  <main class="app-shell">
    <TopBar
      :engine-state="state.engineState"
      :engine-state-label="engineStateLabel"
      :theme-label="themeLabel"
      :is-busy="state.isBusy || state.engineState === 'checking'"
      @cycle-theme="cycleTheme"
      @check-engine="checkEngine"
    />

    <section class="editor-layout" :class="{ 'editor-layout--sidebar-collapsed': !showSidebar || activeRailPage === 'settings' }">
      <ToolRail :active-rail-page="activeRailPage" @select-page="selectRailPage" />

      <WorkspaceSidebar
        v-if="showSidebar && activeRailPage !== 'settings'"
        :active-rail-page="activeRailPage"
        :input-controls="inputControls"
        :can-toggle-input="state.canToggleInput"
        :selected-component-id="selectedComponentId"
        :components="sidebarComponents"
        :component-count="editorState?.document.components.length ?? 0"
        :component-definitions="componentDefinitions"
        :default-wire-color="defaultWireColor"
        @close="showSidebar = false"
        @select-component="selectComponent"
        @toggle-input="toggleInput"
        @place-component="beginPlacementFromSidebar"
        @default-wire-color-change="setDefaultWireColor"
      />

      <section v-if="activeRailPage !== 'settings'" class="editor-main" :class="{ 'editor-main--bottom-panel-collapsed': !isBottomPanelExpanded }" aria-label="电路编辑器">
        <p v-if="editorState?.operation === 'recovery-required'" class="bottom-error" role="alert">编辑器与仿真引擎的结构状态可能不一致。请关闭并重新打开应用后再继续编辑。</p>
        <EditorToolbar
          :zoom-label="zoomLabel"
          :can-start="state.canStart"
          :can-pause="state.canPause"
          :can-resume="state.canResume"
          :can-step="state.canStep"
          :can-undo="editorState?.operation === 'idle' && !editorState.confirmation && editorState.canUndo"
          :can-redo="editorState?.operation === 'idle' && !editorState.confirmation && editorState.canRedo"
          :can-delete="editorState?.operation === 'idle' && !editorState.confirmation && Boolean(editorState.selection)"
          :can-duplicate="editorState?.operation === 'idle' && !editorState.confirmation && !interaction.connectionDraft && editorState.selection?.kind === 'component'"
          :can-clear="editorState?.operation === 'idle' && !editorState.confirmation && (editorState.document.components.length > 0 || editorState.document.connections.length > 0)"
          :simulation-state="state.simulationState"
          :simulation-step="state.simulationStep"
          @adjust-zoom="adjustZoom"
          @reset-zoom="fitViewport"
          @step-simulation="step"
          @start-simulation="start"
          @pause-simulation="pause"
          @resume-simulation="resume"
          @undo="undo"
          @redo="redo"
          @delete-selection="deleteSelection"
          @duplicate-selection="duplicateSelection"
          @request-clear="requestClear"
        />
        <CircuitCanvas
          :scene="canvasScene"
          :viewport="viewport"
          :interaction="interaction"
          :controller="{ componentDefinitions, recentComponentKinds, addComponent, rememberComponentKind, duplicateComponent, deleteComponent, resetRoute, setWireColor, deleteWaypoint, deleteConnection }"
          @select-component="select({ kind: 'component', id: $event })"
          @select-connection="select({ kind: 'connection', id: $event })"
          @clear-selection="select(null)"
          @node-drag-start="startNodeDrag($event.nodeId, $event.pointerWorld)"
          @node-drag-move="moveNodeDrag($event.pointerWorld, $event.altKey)"
          @node-drag-end="endNodeDrag()"
          @node-drag-cancel="cancelNodeDrag()"
          @route-edit-start="startRouteEdit($event.connectionId, $event.route, $event.target, $event.pointerWorld)"
          @route-edit-move="moveRouteEdit($event.pointerWorld, $event.altKey)"
          @route-edit-end="endRouteEdit()"
          @route-edit-cancel="cancelRouteEdit()"
          @connection-start="startConnection"
          @connection-move="moveConnection($event.point, $event.altKey)"
          @connection-waypoint="placeConnectionWaypoint($event.point, $event.altKey)"
          @connection-end="finishConnection"
          @connection-axis-toggle="toggleConnectionAxis"
          @connection-waypoint-remove="removeConnectionWaypoint"
          @connection-waypoint-remove-or-cancel="removeConnectionWaypointOrCancel"
          @connection-cancel="cancelConnection"
          @focus-change="focusCanvasObject"
          @viewport-change="setViewport"
          @resize="resizeCanvas"
          @placement-move="placementMoved"
        @place-component="placeComponent"
          @retry-placement="retryPlacement"
          @cancel-placement="cancelCurrentOperation"
        />
        <BottomPanel
          :is-expanded="isBottomPanelExpanded"
          :bottom-tab="bottomTab"
          :outputs="outputs"
          :selected-connection="selectedConnection"
          :selected-component-name="selectedComponentName"
          :selected-component-value="selectedComponentValue"
          :selected-component-description="selectedComponentDescription"
          :selected-object-id="selectedObjectId"
          :show-details="showDetails"
          :engine-state="state.engineState"
          :engine-name="state.engineName"
          :operation-error="editorState?.error?.message ?? editorState?.simulationError?.message ?? state.operationError"
          :inspector="inspector"
          :waveform="state.waveform"
          :waveform-rows="waveformRows"
          :simulation-step="state.simulationStep"
          @select-tab="bottomTab = $event"
          @toggle-panel="toggleBottomPanel"
          @select-component="selectComponent"
          @toggle-details="showDetails = !showDetails"
        />
      </section>

      <SettingsPage
        v-else
        :theme-preference="themePreference"
        :engine-message="state.message"
        :engine-state="state.engineState"
        :engine-state-label="engineStateLabel"
        :engine-name="state.engineName"
        :is-busy="state.isBusy || state.engineState === 'checking'"
        :component-count="editorState?.document.components.length ?? 0"
        :simulation-step="state.simulationStep"
        @set-theme-preference="setThemePreference"
        @check-engine="checkEngine"
      />
    </section>

    <ClearCanvasDialog
      v-if="editorState?.confirmation?.type === 'clear-document'"
      :component-count="editorState.confirmation.componentCount"
      :connection-count="editorState.confirmation.connectionCount"
      @confirm="confirmClear"
      @cancel="cancelCurrentOperation"
    />
  </main>
</template>
