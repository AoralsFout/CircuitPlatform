<script setup lang="ts">
import { onMounted } from "vue";
import BottomPanel from "./components/BottomPanel.vue";
import CircuitCanvas from "./components/CircuitCanvas.vue";
import EditorToolbar from "./components/EditorToolbar.vue";
import SettingsPage from "./components/SettingsPage.vue";
import ToolRail from "./components/ToolRail.vue";
import TopBar from "./components/TopBar.vue";
import WorkspaceSidebar from "./components/WorkspaceSidebar.vue";
import { useEditorState } from "./composables/useEditorState";
import { useThemePreference } from "./composables/useThemePreference";
import { useWorkspace } from "./composables/useWorkspace";

const { state, bootstrap, checkEngine, runSimulation, toggleInput } = useWorkspace();
const {
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
} = useEditorState(state);
const {
  preference: themePreference,
  label: themeLabel,
  restore: restoreTheme,
  setPreference: setThemePreference,
  cycle: cycleTheme,
} = useThemePreference();

onMounted(() => {
  restoreTheme();
  void bootstrap();
});
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
        @close="showSidebar = false"
        @select-node="selectNode"
        @toggle-input="toggleInput"
      />

      <section v-if="activeRailPage !== 'settings'" class="editor-main" aria-label="电路编辑器">
        <EditorToolbar
          :zoom-label="zoomLabel"
          :can-run="state.canRun"
          :simulation-state="state.simulationState"
          @adjust-zoom="adjustZoom"
          @reset-zoom="zoom = 100"
          @run-simulation="runSimulation"
        />
        <CircuitCanvas
          :zoom="zoom"
          :input-a="state.inputA"
          :input-b="state.inputB"
          :output-value="state.outputValue"
          :output-description="state.outputDescription"
          :engine-state="state.engineState"
          :engine-message="state.message"
          :has-lab="Boolean(state.labIds)"
          :waveform-length="state.waveform.length"
          :selected-node="selectedNode"
          @select-node="selectNode"
        />
        <BottomPanel
          :bottom-tab="bottomTab"
          :outputs="outputs"
          :selected-node="selectedNode"
          :selected-node-name="selectedNodeName"
          :selected-node-value="selectedNodeValue"
          :selected-node-description="selectedNodeDescription"
          :selected-node-id="selectedNodeId"
          :show-details="showDetails"
          :engine-state="state.engineState"
          :engine-name="state.engineName"
          :operation-error="state.operationError"
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
        :component-count="state.labIds ? 4 : 0"
        :simulation-step="state.simulationStep"
        @set-theme-preference="setThemePreference"
        @check-engine="checkEngine"
      />
    </section>
  </main>
</template>
