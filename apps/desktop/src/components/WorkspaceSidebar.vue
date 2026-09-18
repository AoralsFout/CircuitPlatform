<script setup lang="ts">
import type { RailPage } from "../composables/useEditorState";
import type { ComponentDefinition } from "../canvas";
import type { ComponentKindName } from "@circuit-platform/protocol";
import type { InputKey } from "../workspace";
import { WIRE_COLOR_PRESETS, type WireColorId } from "../editor";

interface InputControl {
  key: InputKey;
  index: number;
  label: string;
  value: 0 | 1;
  componentId: string | null;
}

interface SidebarComponent {
  id: string;
  kind: ComponentKindName;
  displayName: string;
  selected: boolean;
}

defineProps<{
  activeRailPage: RailPage;
  inputControls: readonly InputControl[];
  /** 可以切换 Input；运行中同样成立——那次切换会在下一次推进时生效。 */
  canToggleInput: boolean;
  selectedComponentId: string | null;
  components: readonly SidebarComponent[];
  componentCount: number;
  componentDefinitions: readonly ComponentDefinition[];
  defaultWireColor: WireColorId;
}>();

const emit = defineEmits<{
  close: [];
  selectComponent: [componentId: string];
  toggleInput: [key: InputKey];
  placeComponent: [kind: ComponentKindName, continuous: boolean];
  defaultWireColorChange: [color: WireColorId];
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
      <div class="wire-default-setting">
        <div class="sidebar-section-title"><span>Wire 默认颜色</span><small>仅影响新连线</small></div>
        <div class="wire-color-options" role="radiogroup" aria-label="新建 Wire 默认颜色">
          <button
            v-for="preset in WIRE_COLOR_PRESETS"
            :key="preset.id"
            class="wire-color-swatch"
            :class="[`wire-color--${preset.id}`, { 'wire-color-swatch--active': preset.id === defaultWireColor }]"
            type="button"
            role="radio"
            :aria-checked="preset.id === defaultWireColor"
            :aria-label="preset.label"
            :title="preset.label"
            @click="emit('defaultWireColorChange', preset.id)"
          ><span aria-hidden="true"></span></button>
        </div>
      </div>
      <p class="sidebar-hint">单击元件后移动到画布并单击放置；也可直接拖到画布释放；按 Esc 取消。</p>
    </template>

    <template v-else-if="activeRailPage === 'inputs'">
      <div class="sidebar-section-title"><span>当前输入</span><span class="component-count">{{ inputControls.length }}</span></div>
      <div class="input-settings-list">
        <button v-for="input in inputControls" :key="input.key" class="input-setting" :class="{ 'input-setting--on': input.value === 1 }" type="button" :disabled="!canToggleInput" @click="emit('toggleInput', input.key)">
          <span class="input-setting-id">IN {{ input.index }}</span>
          <span class="input-setting-copy"><strong>{{ input.label }}</strong><small>SOURCE / 1 bit</small></span>
          <span class="input-setting-value">{{ input.value }}</span>
        </button>
      </div>
      <p class="sidebar-hint">停止或暂停时切换会立即求值；连续运行中切换会在下一次推进时生效。所有输入都从这里统一编辑。</p>
    </template>

    <template v-else>
      <div class="sidebar-section-title"><span>当前电路</span><span class="component-count">{{ componentCount }}</span></div>
      <div class="layer-list">
        <button v-for="component in components" :key="component.id" type="button" :class="{ 'layer-item--active': component.id === selectedComponentId }" @click="emit('selectComponent', component.id)"><span class="layer-dot" :class="{ 'layer-dot--output': component.kind === 'output', 'layer-dot--gate': component.kind !== 'input' && component.kind !== 'output' }"></span>{{ component.displayName }} <small>{{ component.kind.toUpperCase() }}</small></button>
      </div>
    </template>
  </aside>
</template>
