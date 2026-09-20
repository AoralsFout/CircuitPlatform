<script setup lang="ts">
import { ref } from "vue";
import type { InputControl, RailPage } from "../composables/useEditorState";
import type { ComponentDefinition } from "../canvas";
import type { ComponentKindName } from "@circuit-platform/protocol";
import type { EditorComponentKind } from "../editor/component.ts";
import type { InputBit, InputKey } from "../workspace";
import { toggledInputBit } from "../workspace";
import { resolveInputBitKeyboardAction } from "../editor/keyboard";
import { WIRE_COLOR_PRESETS, type WireColorId } from "../editor";

/** 位按钮组的列数；票面要求每行八列。 */
const BIT_COLUMNS = 8;

interface SidebarComponent {
  id: string;
  kind: EditorComponentKind;
  displayName: string;
  selected: boolean;
}

defineProps<{
  activeRailPage: RailPage;
  inputControls: readonly InputControl[];
  /** 可以设置 Input 的位；运行中同样成立——那次设置会在下一次推进时生效。 */
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
  setInputBit: [key: InputKey, index: number, bit: InputBit];
  placeComponent: [kind: ComponentKindName, continuous: boolean];
  selectSubcircuit: [];
  defaultWireColorChange: [color: WireColorId];
}>();

/**
 * 位按钮组的展开状态，键为编辑器元件 ID。
 * 这是纯视图状态：它不进 EditorDocument、不进历史记录，因此收起一个宽输入不是一次可撤销的编辑。
 * 缺省为展开，宽输入因此默认可见；用户收起哪一个就记住哪一个。
 */
const expandedInputs = ref<Record<string, boolean>>({});
/**
 * 每组内当前聚焦位的下标，键为编辑器元件 ID。
 * 它决定 Tab 进入该组时落在哪一位上（roving tabindex），是 DOM 导航状态而不是取值状态。
 */
const focusedBits = ref<Record<string, number>>({});

function isBitGroupExpanded(key: InputKey): boolean {
  return expandedInputs.value[key] !== false;
}

function toggleBitGroup(key: InputKey): void {
  expandedInputs.value = { ...expandedInputs.value, [key]: !isBitGroupExpanded(key) };
}

function focusedBitIndex(key: InputKey): number {
  return focusedBits.value[key] ?? 0;
}

/** 让组内下标 `index` 的按钮拿到焦点；按钮与 `bits` 同序，因此下标可以直接用作 DOM 下标。 */
function focusBit(container: EventTarget | null, index: number): void {
  if (!(container instanceof HTMLElement)) return;
  container.querySelectorAll<HTMLButtonElement>(".input-bit")[index]?.focus();
}

/**
 * 组内的键盘分发。切换 `0` / `1` 不在这里——那是位按钮自己的 `Space` 与 `Enter`；
 * 这里只补导航与「设为 X」，两者都由 `resolveInputBitKeyboardAction` 判定。
 */
function onBitKeydown(event: KeyboardEvent, input: InputControl): void {
  const index = focusedBitIndex(input.key);
  const action = resolveInputBitKeyboardAction({
    key: event.key,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    index,
    count: input.bits.length,
    columns: BIT_COLUMNS,
  });
  if (!action) return;
  event.preventDefault();
  if (action.type === "set-bit-unknown") {
    emit("setInputBit", input.key, index, "X");
    return;
  }
  focusedBits.value = { ...focusedBits.value, [input.key]: action.index };
  focusBit(event.currentTarget, action.index);
}

/** 位按钮的取值档位；`X` 与确定的 `0` / `1` 用不同的类名区分外观。 */
function bitStateClass(bit: InputBit): string {
  if (bit === "1") return "input-bit--high";
  if (bit === "0") return "input-bit--low";
  return "input-bit--unknown";
}

function startComponentDrag(event: DragEvent, kind: EditorComponentKind): void {
  if (kind === "subcircuit") return;
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
        <button v-for="definition in componentDefinitions" :key="definition.kind" class="component-item" :class="{ 'component-item--disabled': !definition.available }" type="button" :draggable="definition.available && definition.kind !== 'subcircuit'" :disabled="!definition.available" :title="definition.disabledReason ?? `添加${definition.displayName}`" @dragstart="startComponentDrag($event, definition.kind)" @click="definition.kind === 'subcircuit' ? emit('selectSubcircuit') : emit('placeComponent', definition.kind, $event.shiftKey)">
          <span class="component-symbol">{{ definition.symbol }}</span><span><strong>{{ definition.displayName }}</strong><small>{{ definition.kind.toUpperCase() }}</small></span><span class="drag-hint">＋</span>
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
        <div v-for="input in inputControls" :key="input.key" class="input-setting" :class="{ 'input-setting--on': input.value.includes('1') }">
          <div class="input-setting-head">
            <span class="input-setting-id">IN {{ input.index }}</span>
            <span class="input-setting-copy"><strong>{{ input.label }}</strong><small>SOURCE / {{ input.width }} bit</small></span>
            <span class="input-setting-value">{{ input.value }}</span>
            <button
              class="input-setting-disclosure"
              type="button"
              :aria-expanded="isBitGroupExpanded(input.key)"
              :aria-controls="`input-bits-${input.key}`"
              :aria-label="isBitGroupExpanded(input.key) ? `收起${input.label}的位按钮组` : `展开${input.label}的位按钮组`"
              :title="isBitGroupExpanded(input.key) ? '收起位按钮组' : '展开位按钮组'"
              @click="toggleBitGroup(input.key)"
            >{{ isBitGroupExpanded(input.key) ? "▾" : "▸" }}</button>
          </div>
          <div
            v-if="isBitGroupExpanded(input.key)"
            :id="`input-bits-${input.key}`"
            class="input-bit-grid"
            role="group"
            :aria-label="`${input.label} 位按钮组`"
            @keydown="onBitKeydown($event, input)"
          >
            <button
              v-for="bit in input.bits"
              :key="bit.index"
              class="input-bit"
              :class="bitStateClass(bit.value)"
              type="button"
              :disabled="!canToggleInput"
              :tabindex="bit.index === focusedBitIndex(input.key) ? 0 : -1"
              :data-bit="bit.index"
              :data-bit-place="bit.place"
              :data-value="bit.value"
              :aria-label="`${input.label}第 ${bit.place} 位，当前为 ${bit.value}`"
              :title="`第 ${bit.place} 位 · ${bit.value}`"
              @focus="focusedBits = { ...focusedBits, [input.key]: bit.index }"
              @click="emit('setInputBit', input.key, bit.index, toggledInputBit(bit.value))"
              @contextmenu.prevent="emit('setInputBit', input.key, bit.index, 'X')"
            >{{ bit.value }}</button>
          </div>
        </div>
      </div>
      <p class="sidebar-hint">左键在 0 与 1 之间切换，右键把该位设为 X。键盘：Tab 进入位按钮组，方向键在组内移动，空格或回车切换 0 与 1，X 把当前位设为 X。停止或暂停时切换会立即求值；连续运行中切换会在下一次推进时生效。</p>
    </template>

    <template v-else>
      <div class="sidebar-section-title"><span>当前电路</span><span class="component-count">{{ componentCount }}</span></div>
      <div class="layer-list">
        <button v-for="component in components" :key="component.id" type="button" :class="{ 'layer-item--active': component.id === selectedComponentId }" @click="emit('selectComponent', component.id)"><span class="layer-dot" :class="{ 'layer-dot--output': component.kind === 'output', 'layer-dot--gate': component.kind !== 'input' && component.kind !== 'output' }"></span>{{ component.displayName }} <small>{{ component.kind.toUpperCase() }}</small></button>
      </div>
    </template>
  </aside>
</template>
