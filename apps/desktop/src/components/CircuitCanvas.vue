<script setup lang="ts">
import type { Signal } from "@circuit-platform/protocol";
import type { NodeKey } from "../composables/useEditorState";
import type { WorkspaceEngineState } from "../workspace";

defineProps<{
  zoom: number;
  inputA: 0 | 1;
  inputB: 0 | 1;
  outputValue: Signal;
  outputDescription: string;
  engineState: WorkspaceEngineState;
  engineMessage: string;
  hasLab: boolean;
  waveformLength: number;
  selectedNode: NodeKey;
}>();

const emit = defineEmits<{
  selectNode: [node: NodeKey];
}>();

function signalClass(value: Signal): string {
  if (value === 1) return "signal-state--high";
  if (value === 0) return "signal-state--low";
  return "signal-state--unknown";
}

function wireClass(value: Signal): string {
  if (value === 1) return "signal-wire--live";
  if (value === "X") return "signal-wire--unknown";
  return "";
}

function onNodeKeydown(event: KeyboardEvent, node: NodeKey): void {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    emit("selectNode", node);
  }
}
</script>

<template>
  <div class="editor-canvas-wrap"><div class="canvas-info"><span class="canvas-mode"><span class="mode-dot" aria-hidden="true"></span>演示模式</span><span>使用工具栏缩放画布</span></div><div class="circuit-canvas" :style="{ '--canvas-zoom': `${zoom / 100}` }"><div class="canvas-grid" aria-hidden="true"></div><div class="canvas-zoom-layer"><svg class="signal-map" viewBox="0 0 1000 560" preserveAspectRatio="none" aria-hidden="true"><path class="signal-wire" :class="wireClass(inputA)" d="M 210 150 H 330 V 250 H 435" /><path class="signal-wire" :class="wireClass(inputB)" d="M 210 405 H 330 V 290 H 435" /><path class="signal-wire" :class="wireClass(outputValue)" d="M 585 270 H 805" /></svg><article class="circuit-node circuit-node--input-a" :class="{ 'circuit-node--selected': selectedNode === 'inputA' }" role="button" tabindex="0" aria-label="选择输入 A" @click="emit('selectNode', 'inputA')" @keydown="onNodeKeydown($event, 'inputA')"><span class="node-tag">SOURCE / 01</span><strong>输入 A</strong><span class="node-value" :class="signalClass(inputA)">{{ inputA }}</span><span class="node-port node-port--right" :class="signalClass(inputA)">out</span></article><article class="circuit-node circuit-node--input-b" :class="{ 'circuit-node--selected': selectedNode === 'inputB' }" role="button" tabindex="0" aria-label="选择输入 B" @click="emit('selectNode', 'inputB')" @keydown="onNodeKeydown($event, 'inputB')"><span class="node-tag">SOURCE / 02</span><strong>输入 B</strong><span class="node-value" :class="signalClass(inputB)">{{ inputB }}</span><span class="node-port node-port--right" :class="signalClass(inputB)">out</span></article><article class="circuit-node circuit-node--gate" :class="{ 'circuit-node--selected': selectedNode === 'andGate' }" role="button" tabindex="0" aria-label="选择 AND 门" @click="emit('selectNode', 'andGate')" @keydown="onNodeKeydown($event, 'andGate')"><span class="node-tag">LOGIC / 2 → 1</span><strong>AND</strong><span class="node-port node-port--left node-port--upper">in1</span><span class="node-port node-port--left node-port--lower">in2</span><span class="node-port node-port--right" :class="signalClass(outputValue)">out · {{ outputValue }}</span></article><article class="circuit-node circuit-node--output" :class="[{ 'circuit-node--active': outputValue === 1 }, { 'circuit-node--selected': selectedNode === 'output' }]" role="button" tabindex="0" aria-label="选择输出" @click="emit('selectNode', 'output')" @keydown="onNodeKeydown($event, 'output')"><span class="node-tag">MONITOR / 01</span><strong>输出</strong><span class="output-signal" :class="signalClass(outputValue)">{{ outputValue }}</span><span class="output-description">{{ outputDescription }}</span><span class="node-port node-port--left" :class="signalClass(outputValue)">in</span></article><div v-if="!hasLab" class="canvas-empty-state"><span class="empty-orbit">＋</span><strong>{{ engineState === "ready" ? "正在准备示例电路" : "等待仿真引擎" }}</strong><p>{{ engineMessage }}</p></div><div v-if="hasLab && waveformLength === 1" class="canvas-guidance"><span class="guidance-mark">↗</span><div><strong>试着切换输入 A</strong><p>观察高电平如何沿着连线影响输出。</p></div></div></div><div class="canvas-crosshair canvas-crosshair--tl" aria-hidden="true"></div><div class="canvas-crosshair canvas-crosshair--br" aria-hidden="true"></div></div><div class="canvas-legend"><span><i class="legend-line legend-line--live"></i>高电平 <b>1</b></span><span><i class="legend-line"></i>低电平 <b>0</b></span><span><i class="legend-line legend-line--unknown"></i>未知 <b>X</b></span></div></div>
</template>
