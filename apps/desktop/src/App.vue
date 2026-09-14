<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
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
import { resolveEditorShortcut } from "./editor/keyboard";

const {
  state,
  editorState,
  bootstrap,
  checkEngine,
  runSimulation,
  toggleInput,
  select,
  moveComponent,
  deleteSelection,
  requestClear,
  confirmClear,
  cancelCurrentOperation,
  undo,
  redo,
  beginPlacement,
  updatePlacement,
  placeComponent,
} = useWorkspace();
const {
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
  componentDefinitions,
  selectNode,
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
} = useEditorState(state, editorState, select, moveComponent, updatePlacement);
const {
  preference: themePreference,
  label: themeLabel,
  restore: restoreTheme,
  setPreference: setThemePreference,
  cycle: cycleTheme,
} = useThemePreference();

function onEditorKeydown(event: KeyboardEvent): void {
  const target = event.target;
  const shortcut = resolveEditorShortcut({
    key: event.key,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    editableTarget: target instanceof HTMLElement &&
      (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)),
  });
  if (!shortcut) return;
  event.preventDefault();
  if (editorState.value?.confirmation && shortcut !== "cancel") return;
  if (shortcut === "undo") void undo();
  else if (shortcut === "redo") void redo();
  else if (shortcut === "cancel") void cancelCurrentOperation();
  else void deleteSelection();
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
        :can-run="state.canRun"
        :selected-node="selectedNode"
        :component-visibility="componentVisibility"
        :component-count="editorState?.document.components.length ?? 0"
        :component-definitions="componentDefinitions"
        @close="showSidebar = false"
        @select-node="selectNode"
        @toggle-input="toggleInput"
        @place-component="beginPlacement"
      />

      <section v-if="activeRailPage !== 'settings'" class="editor-main" aria-label="电路编辑器">
        <p v-if="editorState?.operation === 'recovery-required'" class="bottom-error" role="alert">编辑器与仿真引擎的结构状态可能不一致。请关闭并重新打开应用后再继续编辑。</p>
        <EditorToolbar
          :zoom-label="zoomLabel"
          :can-run="state.canRun"
          :can-undo="editorState?.operation === 'idle' && !editorState.confirmation && editorState.canUndo"
          :can-redo="editorState?.operation === 'idle' && !editorState.confirmation && editorState.canRedo"
          :can-delete="editorState?.operation === 'idle' && !editorState.confirmation && Boolean(editorState.selection)"
          :can-clear="editorState?.operation === 'idle' && !editorState.confirmation && (editorState.document.components.length > 0 || editorState.document.connections.length > 0)"
          :simulation-state="state.simulationState"
          @adjust-zoom="adjustZoom"
          @reset-zoom="fitViewport"
          @run-simulation="runSimulation"
          @undo="undo"
          @redo="redo"
          @delete-selection="deleteSelection"
          @request-clear="requestClear"
        />
        <CircuitCanvas
          :scene="canvasScene"
          :viewport="viewport"
          :interaction="interaction"
          @select-node="select({ kind: 'component', id: $event })"
          @select-connection="select({ kind: 'connection', id: $event })"
          @node-drag-start="startNodeDrag($event.nodeId, $event.pointerWorld)"
          @node-drag-move="moveNodeDrag($event.pointerWorld, $event.altKey)"
          @node-drag-end="endNodeDrag()"
          @node-drag-cancel="cancelNodeDrag()"
          @viewport-change="setViewport"
          @resize="resizeCanvas"
          @placement-move="placementMoved"
          @place-component="placeComponent"
        />
        <BottomPanel
          :bottom-tab="bottomTab"
          :outputs="outputs"
          :selected-node="selectedNode"
          :selected-connection="selectedConnection"
          :selected-node-name="selectedNodeName"
          :selected-node-value="selectedNodeValue"
          :selected-node-description="selectedNodeDescription"
          :selected-node-id="selectedNodeId"
          :show-details="showDetails"
          :engine-state="state.engineState"
          :engine-name="state.engineName"
          :operation-error="editorState?.error?.message ?? state.operationError"
          :waveform="state.waveform"
          :waveform-rows="waveformRows"
          :simulation-step="state.simulationStep"
          @select-tab="bottomTab = $event"
          @select-node="selectNode"
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
