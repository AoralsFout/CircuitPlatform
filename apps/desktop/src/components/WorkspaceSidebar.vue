<script setup lang="ts">
import type { NodeKey, RailPage } from "../composables/useEditorState";
import type { InputKey } from "../workspace";

interface InputControl {
  key: InputKey;
  label: string;
  value: 0 | 1;
  componentId: number | null;
}

defineProps<{
  activeRailPage: RailPage;
  inputControls: readonly InputControl[];
  canRun: boolean;
  selectedNode: NodeKey;
}>();

const emit = defineEmits<{
  close: [];
  selectNode: [node: NodeKey];
  toggleInput: [key: InputKey];
}>();
</script>

<template>
  <aside v-if="activeRailPage !== 'settings'" class="sidebar" :aria-label="activeRailPage === 'components' ? '元件库' : activeRailPage === 'inputs' ? '输入设置' : '电路层级'">
    <div class="sidebar-heading"><div><span class="eyebrow">WORKSPACE / {{ activeRailPage }}</span><h1>{{ activeRailPage === "components" ? "元件库" : activeRailPage === "inputs" ? "输入设置" : "层级" }}</h1></div><button class="icon-button" type="button" aria-label="收起侧栏" title="收起侧栏" @click="emit('close')">‹</button></div>

    <template v-if="activeRailPage === 'components'">
      <div class="sidebar-section-title"><span>基础元件</span><span class="component-count">5</span></div>
      <div class="component-list">
        <button class="component-item" type="button" disabled title="元件添加将在画布编辑模式中开放"><span class="component-symbol component-symbol--input">↗</span><span><strong>输入</strong><small>INPUT / 1 bit</small></span><span class="drag-hint">＋</span></button>
        <button class="component-item" type="button" disabled title="元件添加将在画布编辑模式中开放"><span class="component-symbol component-symbol--output">↙</span><span><strong>输出</strong><small>OUTPUT / 1 bit</small></span><span class="drag-hint">＋</span></button>
        <button class="component-item component-item--selected" type="button" @click="emit('selectNode', 'andGate')"><span class="component-symbol component-symbol--gate">&amp;</span><span><strong>AND 门</strong><small>LOGIC / 2 → 1</small></span><span class="drag-hint">＋</span></button>
        <button class="component-item" type="button" disabled title="暂未开放"><span class="component-symbol">≥1</span><span><strong>OR 门</strong><small>LOGIC / 2 → 1</small></span><span class="drag-hint">＋</span></button>
        <button class="component-item" type="button" disabled title="暂未开放"><span class="component-symbol">¬</span><span><strong>NOT 门</strong><small>LOGIC / 1 → 1</small></span><span class="drag-hint">＋</span></button>
      </div>
      <p class="sidebar-hint">当前展示示例所用元件；添加和拖动将在后续编辑切片开放。</p>
    </template>

    <template v-else-if="activeRailPage === 'inputs'">
      <div class="sidebar-section-title"><span>当前输入</span><span class="component-count">{{ inputControls.length }}</span></div>
      <div class="input-settings-list">
        <button v-for="input in inputControls" :key="input.key" class="input-setting" :class="{ 'input-setting--on': input.value === 1 }" type="button" :disabled="!canRun" @click="emit('toggleInput', input.key)">
          <span class="input-setting-id">{{ input.key.toUpperCase() }}</span>
          <span class="input-setting-copy"><strong>{{ input.label }}</strong><small>SOURCE / 1 bit</small></span>
          <span class="input-setting-value">{{ input.value }}</span>
        </button>
      </div>
      <p class="sidebar-hint">切换后会立即运行一次仿真，所有输入都从这里统一编辑。</p>
    </template>

    <template v-else>
      <div class="sidebar-section-title"><span>当前电路</span><span class="component-count">4</span></div>
      <div class="layer-list">
        <button type="button" :class="{ 'layer-item--active': selectedNode === 'output' }" @click="emit('selectNode', 'output')"><span class="layer-dot layer-dot--output"></span>输出 <small>OUTPUT</small></button>
        <button type="button" :class="{ 'layer-item--active': selectedNode === 'andGate' }" @click="emit('selectNode', 'andGate')"><span class="layer-dot layer-dot--gate"></span>AND 门 <small>AND</small></button>
        <button type="button" :class="{ 'layer-item--active': selectedNode === 'inputB' }" @click="emit('selectNode', 'inputB')"><span class="layer-dot"></span>输入 B <small>INPUT</small></button>
        <button type="button" :class="{ 'layer-item--active': selectedNode === 'inputA' }" @click="emit('selectNode', 'inputA')"><span class="layer-dot"></span>输入 A <small>INPUT</small></button>
      </div>
    </template>
  </aside>
</template>
