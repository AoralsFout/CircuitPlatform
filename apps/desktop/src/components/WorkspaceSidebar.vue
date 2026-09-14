<script setup lang="ts">
import type { NodeKey, RailPage } from "../composables/useEditorState";
import type { ComponentDefinition } from "../canvas";
import type { ComponentKindName } from "@circuit-platform/protocol";
import type { InputKey } from "../workspace";

interface InputControl {
  key: InputKey;
  label: string;
  value: 0 | 1;
}

defineProps<{
  activeRailPage: RailPage;
  inputControls: readonly InputControl[];
  canRun: boolean;
  selectedNode: NodeKey | null;
  componentVisibility: Record<NodeKey, boolean>;
  componentCount: number;
  componentDefinitions: readonly ComponentDefinition[];
}>();

const emit = defineEmits<{
  close: [];
  selectNode: [node: NodeKey];
  toggleInput: [key: InputKey];
  placeComponent: [kind: ComponentKindName, continuous: boolean];
}>();

function startComponentDrag(event: DragEvent, kind: ComponentKindName): void {
  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("application/x-circuit-component", kind);
  event.dataTransfer.setData("text/plain", kind);
}
</script>

<template>
  <aside v-if="activeRailPage !== 'settings'" class="sidebar" :aria-label="activeRailPage === 'components' ? '元件库' : activeRailPage === 'inputs' ? '输入设置' : '电路层级'">
    <div class="sidebar-heading"><div><span class="eyebrow">WORKSPACE / {{ activeRailPage }}</span><h1>{{ activeRailPage === "components" ? "元件库" : activeRailPage === "inputs" ? "输入设置" : "层级" }}</h1></div><button class="icon-button" type="button" aria-label="收起侧栏" title="收起侧栏" @click="emit('close')">‹</button></div>

    <template v-if="activeRailPage === 'components'">
      <div class="sidebar-section-title"><span>元件库</span><span class="component-count">{{ componentDefinitions.length }}</span></div>
      <div class="component-list">
        <button v-for="definition in componentDefinitions" :key="definition.kind" class="component-item" :class="{ 'component-item--disabled': !definition.available }" type="button" :draggable="definition.available" :disabled="!definition.available" :title="definition.disabledReason ?? `添加${definition.displayName}`" @dragstart="startComponentDrag($event, definition.kind)" @click="emit('placeComponent', definition.kind, $event.shiftKey)">
          <span class="component-symbol">{{ definition.symbol }}</span><span><strong>{{ definition.displayName }}</strong><small>{{ definition.kind.toUpperCase() }} / {{ definition.ports.filter((port) => port.direction === 'input').length }} → {{ definition.ports.filter((port) => port.direction === 'output').length }}</small></span><span class="drag-hint">＋</span>
        </button>
      </div>
      <p class="sidebar-hint">单击元件后移动到画布并单击放置；也可直接拖到画布释放；按 Esc 取消。</p>
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
      <div class="sidebar-section-title"><span>当前电路</span><span class="component-count">{{ componentCount }}</span></div>
      <div class="layer-list">
        <button v-if="componentVisibility.output" type="button" :class="{ 'layer-item--active': selectedNode === 'output' }" @click="emit('selectNode', 'output')"><span class="layer-dot layer-dot--output"></span>输出 <small>OUTPUT</small></button>
        <button v-if="componentVisibility.andGate" type="button" :class="{ 'layer-item--active': selectedNode === 'andGate' }" @click="emit('selectNode', 'andGate')"><span class="layer-dot layer-dot--gate"></span>AND 门 <small>AND</small></button>
        <button v-if="componentVisibility.inputB" type="button" :class="{ 'layer-item--active': selectedNode === 'inputB' }" @click="emit('selectNode', 'inputB')"><span class="layer-dot"></span>输入 B <small>INPUT</small></button>
        <button v-if="componentVisibility.inputA" type="button" :class="{ 'layer-item--active': selectedNode === 'inputA' }" @click="emit('selectNode', 'inputA')"><span class="layer-dot"></span>输入 A <small>INPUT</small></button>
      </div>
    </template>
  </aside>
</template>
