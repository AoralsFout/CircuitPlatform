<script setup lang="ts">
import type { SimulationState } from "../workspace";

defineProps<{
  zoomLabel: string;
  canRun: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canDelete: boolean;
  canDuplicate: boolean;
  canClear: boolean;
  simulationState: SimulationState;
}>();

const emit = defineEmits<{
  adjustZoom: [delta: number];
  resetZoom: [];
  runSimulation: [];
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
      <button class="run-button" type="button" :disabled="!canRun" @click="emit('runSimulation')"><span aria-hidden="true">▶</span>{{ simulationState === "running" ? "仿真中…" : "运行一次" }}</button>
    </div>
  </div>
</template>
