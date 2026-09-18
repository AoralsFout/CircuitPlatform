<script setup lang="ts">
import { computed } from "vue";
import type { SimulationState } from "../workspace";

const props = defineProps<{
  zoomLabel: string;
  canStart: boolean;
  canPause: boolean;
  canResume: boolean;
  canStep: boolean;
  canReset: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canDelete: boolean;
  canDuplicate: boolean;
  canClear: boolean;
  simulationState: SimulationState;
  /** 已经推进的步数；界面上唯一的步数，与波形记录用的是同一个计数。 */
  simulationStep: number;
}>();

/** 运行控制组的状态文案；与键盘等价路径共用同一套三态。 */
const stateLabels: Record<SimulationState, string> = {
  stopped: "已停止",
  running: "运行中",
  paused: "已暂停",
};

const runStateLabel = computed(() => stateLabels[props.simulationState]);

const emit = defineEmits<{
  adjustZoom: [delta: number];
  resetZoom: [];
  /** 界面上唯一的推进原语：推进一个 tick。 */
  stepSimulation: [];
  startSimulation: [];
  pauseSimulation: [];
  resumeSimulation: [];
  /** 把仿真恢复到初始状态；Circuit 结构不变。 */
  resetSimulation: [];
  undo: [];
  redo: [];
  deleteSelection: [];
  duplicateSelection: [];
  requestClear: [];
}>();
</script>

<template>
  <div class="editor-toolbar">
    <div class="toolbar-breadcrumb"><span class="breadcrumb-muted">电路</span><span aria-hidden="true">/</span><strong>编辑器场景</strong><span class="toolbar-status"><span class="status-mark" aria-hidden="true">◇</span> 数据驱动</span></div>
    <div class="toolbar-tools">
      <button class="tool-button" type="button" :disabled="!canUndo" title="撤销 (Ctrl/Cmd+Z)" @click="emit('undo')"><span aria-hidden="true">↶</span></button>
      <button class="tool-button" type="button" :disabled="!canRedo" title="重做 (Ctrl/Cmd+Shift+Z)" @click="emit('redo')"><span aria-hidden="true">↷</span></button>
      <button class="tool-button" type="button" :disabled="!canDelete" title="删除选中对象 (Delete)" @click="emit('deleteSelection')"><span aria-hidden="true">⌫</span></button>
      <button class="tool-button" type="button" :disabled="!canDuplicate" title="复制选中元件 (Ctrl/Cmd+D)" @click="emit('duplicateSelection')"><span aria-hidden="true">⧉</span></button>
      <button class="tool-button tool-button--fit" type="button" :disabled="!canClear" title="清空画布" aria-label="清空画布" @click="emit('requestClear')">清空</button>
      <span class="toolbar-rule" aria-hidden="true"></span>
      <button class="tool-button" type="button" @click="emit('adjustZoom', -10)" title="缩小">−</button><span class="zoom-label">{{ zoomLabel }}</span><button class="tool-button" type="button" @click="emit('adjustZoom', 10)" title="放大">＋</button><button class="tool-button tool-button--fit" type="button" @click="emit('resetZoom')" title="适合窗口">适合窗口</button>
      <span class="toolbar-rule" aria-hidden="true"></span>
      <div class="run-controls" role="group" aria-label="运行控制">
        <span class="run-state" :class="`run-state--${simulationState}`" aria-live="polite"><span class="run-state-mark" aria-hidden="true"></span>{{ runStateLabel }}</span>
        <span class="run-step" :title="`已推进 ${simulationStep} 步`">第 {{ simulationStep }} 步</span>
        <button class="run-button" type="button" :disabled="!canStart" title="开始连续运行 (F5)" @click="emit('startSimulation')">开始</button>
        <button class="tool-button tool-button--fit" type="button" :disabled="!canPause" title="暂停连续运行 (F6)" @click="emit('pauseSimulation')">暂停</button>
        <button class="run-button" type="button" :disabled="!canResume" title="从暂停处继续 (F5)" @click="emit('resumeSimulation')">继续</button>
        <button class="tool-button tool-button--fit" type="button" :disabled="!canStep" title="推进一个 tick (F7)" @click="emit('stepSimulation')">单步</button>
        <button class="tool-button tool-button--fit" type="button" :disabled="!canReset" title="重置到初始状态 (F8)" @click="emit('resetSimulation')">重置</button>
      </div>
    </div>
  </div>
</template>
