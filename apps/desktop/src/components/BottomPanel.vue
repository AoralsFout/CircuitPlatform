<script setup lang="ts">
import { computed } from "vue";
import type { BitRange, Signal } from "@circuit-platform/protocol";
import type { BottomTab, WaveformRow } from "../composables/useEditorState";
import type { EditorConnectionId } from "../editor";
import type { BitRangeAttribute, InspectorModel, WidthAttribute } from "../editor/inspector";
import { parseBitRangeList } from "../editor/bus-ports.ts";
import { signalStateClass } from "../editor/signal-state.ts";
import type { WaveformPoint, WorkspaceEngineState } from "../workspace";

interface OutputItem {
  key: string;
  label: string;
  value: Signal;
  description: string;
}

const props = defineProps<{
  isExpanded: boolean;
  bottomTab: BottomTab;
  waveformRows: readonly WaveformRow[];
  waveform: readonly WaveformPoint[];
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
  setPortWidth: [componentId: string, portName: string, width: number];
  setBitRanges: [componentId: string, ranges: readonly BitRange[]];
  reloadSubcircuit: [componentId: string];
}>();

/**
 * 提交一次位宽编辑。
 *
 * 非法输入就地还原成当前值，不发出命令。提交后的 DOM 值先退回模型里的当前值：成功时模型
 * 更新会把输入框重新渲染成新值，失败时它就停在原值上——「失败保留原值」因此不需要额外状态。
 */
function onWidthChange(attribute: WidthAttribute, event: Event): void {
  const input = event.target as HTMLInputElement;
  const width = Number.parseInt(input.value, 10);
  input.value = String(attribute.value);
  if (props.inspector?.kind !== "component") return;
  if (!Number.isSafeInteger(width) || width < 1 || width === attribute.value) return;
  emit("setPortWidth", props.inspector.id, attribute.portName, width);
}

/**
 * 提交一次位区间列表编辑。
 *
 * 与位宽一样就地还原成当前值再发出命令：列表是文本，形状不对的一行连一份端口清单都拼不出来，
 * 因此这里只判断形状，覆盖是否完整交给引擎——它的拒绝信息里带着「越界 / 重叠 / 漏位」里的
 * 哪一种，那正是用户需要看到的那条。
 */
function onBitRangesChange(attribute: BitRangeAttribute, event: Event): void {
  const input = event.target as HTMLInputElement;
  const ranges = parseBitRangeList(input.value);
  input.value = attribute.value;
  if (props.inspector?.kind !== "component") return;
  if (!ranges) return;
  emit("setBitRanges", props.inspector.id, ranges);
}

function subcircuitStatusLabel(status: "resolved" | "resolving" | "unresolved"): string {
  if (status === "resolved") return "已解析";
  if (status === "resolving") return "解析中";
  return "未解析";
}

// 记录按信号键索引，行的键直接用来取值；某个信号在记录这一点时还不存在就是未知。
// 多位信号以逐位文本原样显示（`1010`、`X1X0`），因此每一位都读得出来。
function waveformValue(point: WaveformPoint, key: string): Signal {
  return point.signals[key] ?? "X";
}

/**
 * 表头显示的步区间，直接从已记录的点推出来。
 * 逐 tick 记录（Phase 5）之后列会随推进一路增长，网格改为固定列宽加左右滚动；
 * 表头仍然只宣称已记录的点构成的区间，不宣称尚未发生的历史。
 */
const waveformRange = computed(() => {
  const first = props.waveform[0];
  const last = props.waveform.at(-1);
  if (!first || !last) return "STEP —";
  const pad = (step: number): string => step.toString().padStart(2, "0");
  return `STEP ${pad(first.step)}–${pad(last.step)}`;
});
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
        <p v-if="inspector.hint" class="inspector-hint">{{ inspector.hint }}</p>
        <div v-if="inspector.subcircuit" class="inspector-subcircuit" aria-label="子电路状态">
          <div class="inspector-details"><span>引用：{{ inspector.subcircuit.relativePath }}</span><span role="status">状态：{{ subcircuitStatusLabel(inspector.subcircuit.status) }}</span></div>
          <p v-if="inspector.subcircuit.diagnostic" class="inspector-hint" role="alert">{{ inspector.subcircuit.diagnostic }}</p>
          <button type="button" :disabled="inspector.subcircuit.status === 'resolving'" :aria-label="`重新加载子电路 ${inspector.subcircuit.relativePath}`" @click="emit('reloadSubcircuit', inspector.id)">重新加载子电路</button>
        </div>
        <div class="inspector-value"><span>当前信号</span><strong :class="signalStateClass(inspector.signal)">{{ inspector.signal }}</strong></div>
        <div v-if="inspector.attributes.length > 0" class="inspector-attributes" aria-label="可编辑属性">
          <label v-for="attribute in inspector.attributes" :key="attribute.id" class="inspector-attribute">
            <span>{{ attribute.label }}</span>
            <input v-if="attribute.id === 'width'" type="number" min="1" step="1" :value="attribute.value" :aria-label="`${attribute.label}：${attribute.portName}`" @change="onWidthChange(attribute, $event)" />
            <input v-else type="text" spellcheck="false" :value="attribute.value" placeholder="7:4, 3:0" :aria-label="`${attribute.label}：${attribute.portName}`" @change="onBitRangesChange(attribute, $event)" />
          </label>
        </div>
        <div class="inspector-port-list" aria-label="端口信号">
          <span v-for="port in inspector.ports" :key="port.id" class="inspector-port-row"><span>{{ port.direction === 'input' ? '输入' : '输出' }} · {{ port.label }}（{{ port.width }} 位）</span><strong :class="signalStateClass(port.signal)">{{ port.signal }}</strong><small>{{ port.connectionState === 'connected' ? '已连接' : port.connectionState === 'dangling' ? '悬空' : '未连接' }}</small></span>
        </div>
      </template>
      <template v-else-if="inspector?.kind === 'wire'">
        <div class="bottom-inspector-heading"><div><span class="eyebrow">WIRE</span><strong>选中 Wire</strong></div><span class="inspector-kind">{{ inspector.status === 'dangling' ? '悬空' : '正常' }}</span></div>
        <div class="inspector-copy"><p>起点端口：{{ inspector.source.port }}</p><p>终点端口：{{ inspector.target.port }}</p></div>
        <div class="inspector-value"><span>当前信号</span><strong :class="signalStateClass(inspector.signal)">{{ inspector.signal }}</strong></div>
        <div class="inspector-details"><span>状态：{{ inspector.status === 'dangling' ? '悬空' : '正常' }}</span><span>Waypoint 数：{{ inspector.waypointCount }}</span></div>
      </template>
      <div v-else class="inspector-empty"><strong>未选择对象</strong><span>选择一个 Component 或 Wire 查看只读详情。</span></div>
    </div>
    <div v-else-if="isExpanded && bottomTab === 'outputs'" class="bottom-content bottom-content--outputs" aria-live="polite">
      <div class="output-panel-heading"><div><span class="eyebrow">OUTPUT MONITOR</span><strong>当前电路输出</strong></div><span>{{ outputs.length }} 个输出</span></div>
      <div class="output-list"><button v-for="output in outputs" :key="output.key" class="output-readout" type="button" @click="emit('selectComponent', output.key)"><span class="output-readout-symbol" :class="signalStateClass(output.value)">OUT</span><span class="output-readout-copy"><strong>{{ output.label }}</strong><small>{{ output.description }}</small></span><b :class="signalStateClass(output.value)">{{ output.value }}</b></button></div>
      <div class="bottom-engine"><span class="engine-indicator" :class="`engine-indicator--${engineState}`"></span><span>{{ engineName }}</span></div>
    </div>
    <div v-else-if="isExpanded" class="bottom-content bottom-content--waveform">
      <div class="waveform-meta"><span class="eyebrow">WAVEFORM / HISTORY</span><span>{{ waveformRange }}</span></div>
      <div class="waveform-grid" :style="{ '--waveform-steps': waveform.length }"><div class="waveform-axis"><span>信号</span><span v-for="point in waveform" :key="`axis-${point.step}`">{{ point.step }}</span></div><div v-for="row in waveformRows" :key="row.key" class="waveform-row"><span class="waveform-label">{{ row.label }}</span><span v-for="point in waveform" :key="`${row.key}-${point.step}`" class="waveform-cell" :class="signalStateClass(waveformValue(point, row.key))" :title="waveformValue(point, row.key)">{{ waveformValue(point, row.key) }}</span></div></div>
    </div>
  </section>
</template>
