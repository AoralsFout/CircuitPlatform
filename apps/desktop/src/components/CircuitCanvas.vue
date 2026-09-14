<script setup lang="ts">
import type { Signal } from "@circuit-platform/protocol";
import type { EditorConnectionId } from "../editor";
import type { NodeKey, WireDanglingState, WireKey } from "../composables/useEditorState";
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
  selectedNode: NodeKey | null;
  selectedConnection: EditorConnectionId | null;
  componentVisibility: Record<NodeKey, boolean>;
  wireVisibility: Record<WireKey, boolean>;
  wireDangling: Record<WireKey, WireDanglingState>;
  isEmpty: boolean;
}>();

const emit = defineEmits<{
  selectNode: [node: NodeKey];
  selectConnection: [connectionId: EditorConnectionId];
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

function onConnectionKeydown(event: KeyboardEvent, connectionId: EditorConnectionId): void {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    emit("selectConnection", connectionId);
  }
}
</script>

<template>
  <div class="editor-canvas-wrap">
    <div class="canvas-info"><span class="canvas-mode"><span class="mode-dot" aria-hidden="true"></span>演示模式</span><span>Delete 删除 · Ctrl/Cmd+Z 撤销 · Esc 取消</span></div>
    <div class="circuit-canvas" :style="{ '--canvas-zoom': `${zoom / 100}` }">
      <div class="canvas-grid" aria-hidden="true"></div>
      <div class="canvas-zoom-layer">
        <svg class="signal-map" viewBox="0 0 1000 560" preserveAspectRatio="none">
          <path v-if="wireVisibility.wireA" class="signal-wire-hit" d="M 210 150 H 330 V 250 H 435" role="button" tabindex="0" aria-label="选择输入 A 到 AND 门的连线" @click.stop="emit('selectConnection', 'wire-a')" @keydown="onConnectionKeydown($event, 'wire-a')" />
          <path v-if="wireVisibility.wireB" class="signal-wire-hit" d="M 210 405 H 330 V 290 H 435" role="button" tabindex="0" aria-label="选择输入 B 到 AND 门的连线" @click.stop="emit('selectConnection', 'wire-b')" @keydown="onConnectionKeydown($event, 'wire-b')" />
          <path v-if="wireVisibility.wireOutput" class="signal-wire-hit" d="M 585 270 H 805" role="button" tabindex="0" aria-label="选择 AND 门到输出的连线" @click.stop="emit('selectConnection', 'wire-output')" @keydown="onConnectionKeydown($event, 'wire-output')" />
          <path v-if="wireVisibility.wireA" class="signal-wire" :class="[wireClass(inputA), { 'signal-wire--dangling': wireDangling.wireA.source || wireDangling.wireA.target, 'signal-wire--selected': selectedConnection === 'wire-a' }]" d="M 210 150 H 330 V 250 H 435" />
          <path v-if="wireVisibility.wireB" class="signal-wire" :class="[wireClass(inputB), { 'signal-wire--dangling': wireDangling.wireB.source || wireDangling.wireB.target, 'signal-wire--selected': selectedConnection === 'wire-b' }]" d="M 210 405 H 330 V 290 H 435" />
          <path v-if="wireVisibility.wireOutput" class="signal-wire" :class="[wireClass(outputValue), { 'signal-wire--dangling': wireDangling.wireOutput.source || wireDangling.wireOutput.target, 'signal-wire--selected': selectedConnection === 'wire-output' }]" d="M 585 270 H 805" />
          <circle v-if="wireVisibility.wireA && wireDangling.wireA.source" class="dangling-endpoint" cx="210" cy="150" r="6" /><circle v-if="wireVisibility.wireA && wireDangling.wireA.target" class="dangling-endpoint" cx="435" cy="250" r="6" />
          <circle v-if="wireVisibility.wireB && wireDangling.wireB.source" class="dangling-endpoint" cx="210" cy="405" r="6" /><circle v-if="wireVisibility.wireB && wireDangling.wireB.target" class="dangling-endpoint" cx="435" cy="290" r="6" />
          <circle v-if="wireVisibility.wireOutput && wireDangling.wireOutput.source" class="dangling-endpoint" cx="585" cy="270" r="6" /><circle v-if="wireVisibility.wireOutput && wireDangling.wireOutput.target" class="dangling-endpoint" cx="805" cy="270" r="6" />
        </svg>
        <article v-if="componentVisibility.inputA" class="circuit-node circuit-node--input-a" :class="{ 'circuit-node--selected': selectedNode === 'inputA' }" role="button" tabindex="0" aria-label="选择输入 A" @click="emit('selectNode', 'inputA')" @keydown="onNodeKeydown($event, 'inputA')"><span class="node-tag">SOURCE / 01</span><strong>输入 A</strong><span class="node-value" :class="signalClass(inputA)">{{ inputA }}</span><span class="node-port node-port--right" :class="signalClass(inputA)">out</span></article>
        <article v-if="componentVisibility.inputB" class="circuit-node circuit-node--input-b" :class="{ 'circuit-node--selected': selectedNode === 'inputB' }" role="button" tabindex="0" aria-label="选择输入 B" @click="emit('selectNode', 'inputB')" @keydown="onNodeKeydown($event, 'inputB')"><span class="node-tag">SOURCE / 02</span><strong>输入 B</strong><span class="node-value" :class="signalClass(inputB)">{{ inputB }}</span><span class="node-port node-port--right" :class="signalClass(inputB)">out</span></article>
        <article v-if="componentVisibility.andGate" class="circuit-node circuit-node--gate" :class="{ 'circuit-node--selected': selectedNode === 'andGate' }" role="button" tabindex="0" aria-label="选择 AND 门" @click="emit('selectNode', 'andGate')" @keydown="onNodeKeydown($event, 'andGate')"><span class="node-tag">LOGIC / 2 → 1</span><strong>AND</strong><span class="node-port node-port--left node-port--upper">in1</span><span class="node-port node-port--left node-port--lower">in2</span><span class="node-port node-port--right" :class="signalClass(outputValue)">out · {{ outputValue }}</span></article>
        <article v-if="componentVisibility.output" class="circuit-node circuit-node--output" :class="[{ 'circuit-node--active': outputValue === 1 }, { 'circuit-node--selected': selectedNode === 'output' }]" role="button" tabindex="0" aria-label="选择输出" @click="emit('selectNode', 'output')" @keydown="onNodeKeydown($event, 'output')"><span class="node-tag">MONITOR / 01</span><strong>输出</strong><span class="output-signal" :class="signalClass(outputValue)">{{ outputValue }}</span><span class="output-description">{{ outputDescription }}</span><span class="node-port node-port--left" :class="signalClass(outputValue)">in</span></article>
        <div v-if="!hasLab" class="canvas-empty-state"><span class="empty-orbit">＋</span><strong>{{ engineState === "ready" ? "正在准备示例电路" : "等待仿真引擎" }}</strong><p>{{ engineMessage }}</p></div>
        <div v-else-if="isEmpty" class="canvas-empty-state"><span class="empty-orbit">＋</span><strong>还没有电路</strong><p>使用撤销恢复刚才的电路，或从元件库开始新设计。</p></div>
        <div v-if="hasLab && !isEmpty && waveformLength === 1" class="canvas-guidance"><span class="guidance-mark">↗</span><div><strong>试着切换输入 A</strong><p>观察高电平如何沿着连线影响输出。</p></div></div>
      </div>
      <div class="canvas-crosshair canvas-crosshair--tl" aria-hidden="true"></div><div class="canvas-crosshair canvas-crosshair--br" aria-hidden="true"></div>
    </div>
    <div class="canvas-legend"><span><i class="legend-line legend-line--live"></i>高电平 <b>1</b></span><span><i class="legend-line"></i>低电平 <b>0</b></span><span><i class="legend-line legend-line--unknown"></i>未知 <b>X</b></span><span><i class="legend-line legend-line--dangling"></i>悬空</span></div>
  </div>
</template>
