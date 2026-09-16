<script setup lang="ts">
import type { Signal } from "@circuit-platform/protocol";
import type { BottomTab, WaveformKey, WaveformRow } from "../composables/useEditorState";
import type { EditorConnectionId } from "../editor";
import type { InspectorModel } from "../editor/inspector";
import type { WaveformPoint, WorkspaceEngineState } from "../workspace";

interface OutputItem {
  key: string;
  label: string;
  value: Signal;
  description: string;
}

defineProps<{
  isExpanded: boolean;
  bottomTab: BottomTab;
  waveformRows: readonly WaveformRow[];
  waveform: readonly WaveformPoint[];
  simulationStep: number;
  outputs: readonly OutputItem[];
  selectedComponentName: string;
  selectedConnection: EditorConnectionId | null;
  selectedObjectId: string | null;
  selectedComponentValue: Signal;
  selectedComponentDescription: string;
  showDetails: boolean;
  engineState: WorkspaceEngineState;
  engineName: string;
  operationError: string | null;
  inspector: InspectorModel;
}>();

const emit = defineEmits<{
  selectTab: [tab: BottomTab];
  togglePanel: [];
  selectComponent: [componentId: string];
  toggleDetails: [];
}>();

function signalClass(value: Signal): string {
  if (value === 1) return "signal-state--high";
  if (value === 0) return "signal-state--low";
  return "signal-state--unknown";
}

function waveformValue(point: WaveformPoint, key: WaveformKey): Signal {
  return point[key];
}
</script>

<template>
  <section class="bottom-panel" :aria-expanded="isExpanded" aria-label="仿真结果面板">
    <p v-if="operationError" class="bottom-error" role="alert">{{ operationError }}</p>
    <div class="bottom-tabs">
      <button type="button" :class="{ 'bottom-tab--active': bottomTab === 'inspector' }" @click="emit('selectTab', 'inspector')">检查器</button>
      <button type="button" :class="{ 'bottom-tab--active': bottomTab === 'outputs' }" @click="emit('selectTab', 'outputs')">输出 <span class="tab-count">{{ outputs.length }}</span></button>
      <button type="button" :class="{ 'bottom-tab--active': bottomTab === 'waveform' }" :disabled="!waveform.length" @click="emit('selectTab', 'waveform')">波形 <span class="tab-count">{{ waveform.length }}</span></button>
      <span class="bottom-tabs__spacer" aria-hidden="true"></span>
      <button class="bottom-panel-toggle" type="button" :aria-expanded="isExpanded" :aria-label="isExpanded ? '收起仿真结果面板' : '展开仿真结果面板'" :title="isExpanded ? '收起仿真结果面板' : '展开仿真结果面板'" @click="emit('togglePanel')"><span aria-hidden="true">{{ isExpanded ? '⌄' : '⌃' }}</span></button>
    </div>
    <div v-if="isExpanded && bottomTab === 'inspector'" class="bottom-content bottom-content--inspector" aria-live="polite">
      <template v-if="inspector?.kind === 'component'">
        <div class="bottom-inspector-heading"><div><span class="eyebrow">COMPONENT</span><strong>{{ inspector.displayName }}</strong></div><span class="inspector-kind">{{ inspector.type }}</span></div>
        <div class="inspector-copy"><p>{{ inspector.behavior }}</p><span>类型：{{ inspector.type }}</span></div>
        <div class="inspector-value"><span>当前信号</span><strong :class="signalClass(inspector.signal)">{{ inspector.signal }}</strong></div>
        <div class="inspector-port-list" aria-label="端口信号">
          <span v-for="port in inspector.ports" :key="port.id" class="inspector-port-row"><span>{{ port.direction === 'input' ? '输入' : '输出' }} · {{ port.name }}</span><strong :class="signalClass(port.signal)">{{ port.signal }}</strong><small>{{ port.connectionState === 'connected' ? '已连接' : port.connectionState === 'dangling' ? '悬空' : '未连接' }}</small></span>
        </div>
      </template>
      <template v-else-if="inspector?.kind === 'wire'">
        <div class="bottom-inspector-heading"><div><span class="eyebrow">WIRE</span><strong>选中 Wire</strong></div><span class="inspector-kind">{{ inspector.status === 'dangling' ? '悬空' : '正常' }}</span></div>
        <div class="inspector-copy"><p>起点端口：{{ inspector.source.port }}</p><p>终点端口：{{ inspector.target.port }}</p></div>
        <div class="inspector-value"><span>当前信号</span><strong :class="signalClass(inspector.signal)">{{ inspector.signal }}</strong></div>
        <div class="inspector-details"><span>状态：{{ inspector.status === 'dangling' ? '悬空' : '正常' }}</span><span>Waypoint 数：{{ inspector.waypointCount }}</span></div>
      </template>
      <div v-else class="inspector-empty"><strong>未选择对象</strong><span>选择一个 Component 或 Wire 查看只读详情。</span></div>
    </div>
    <div v-else-if="isExpanded && bottomTab === 'outputs'" class="bottom-content bottom-content--outputs" aria-live="polite">
      <div class="output-panel-heading"><div><span class="eyebrow">OUTPUT MONITOR</span><strong>当前电路输出</strong></div><span>{{ outputs.length }} 个输出</span></div>
      <div class="output-list"><button v-for="output in outputs" :key="output.key" class="output-readout" type="button" @click="emit('selectComponent', output.key)"><span class="output-readout-symbol" :class="signalClass(output.value)">OUT</span><span class="output-readout-copy"><strong>{{ output.label }}</strong><small>{{ output.description }}</small></span><b :class="signalClass(output.value)">{{ output.value }}</b></button></div>
      <div class="bottom-engine"><span class="engine-indicator" :class="`engine-indicator--${engineState}`"></span><span>{{ engineName }}</span></div>
    </div>
    <div v-else-if="isExpanded" class="bottom-content bottom-content--waveform">
      <div class="waveform-meta"><span class="eyebrow">WAVEFORM / HISTORY</span><span>STEP 01–{{ simulationStep.toString().padStart(2, "0") }}</span></div>
      <div class="waveform-grid" :style="{ '--waveform-steps': waveform.length }"><div class="waveform-axis"><span>信号</span><span v-for="point in waveform" :key="`axis-${point.step}`">{{ point.step }}</span></div><div v-for="row in waveformRows" :key="row.key" class="waveform-row"><span class="waveform-label">{{ row.label }}</span><span v-for="point in waveform" :key="`${row.key}-${point.step}`" class="waveform-cell" :class="signalClass(waveformValue(point, row.key))">{{ waveformValue(point, row.key) }}</span></div></div>
    </div>
  </section>
</template>
