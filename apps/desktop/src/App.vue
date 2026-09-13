<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type {
  ComponentKindName,
  EngineResponse,
  ErrorResponse,
  Signal,
} from "@circuit-platform/protocol";

type EngineState = "checking" | "ready" | "unavailable" | "error";
type InputKey = "a" | "b";
type NodeKey = "inputA" | "inputB" | "andGate" | "output";
type WaveformKey = "a" | "b" | "output";
type ThemePreference = "system" | "light" | "dark";
type SimulationState = "idle" | "running";
type RailPage = "components" | "inputs" | "layers" | "settings";
type BottomTab = "inspector" | "outputs" | "waveform";

interface LabIds {
  inputA: number;
  inputB: number;
  andGate: number;
  output: number;
}

interface WaveformPoint {
  step: number;
  a: Signal;
  b: Signal;
  output: Signal;
}

interface WaveformRow {
  label: string;
  key: WaveformKey;
}

const themeStorageKey = "circuit-platform-theme";
const engineState = ref<EngineState>("checking");
const engineMessage = ref("正在连接 C++ 仿真引擎…");
const engineName = ref("未连接");
const isBusy = ref(false);
const simulationState = ref<SimulationState>("idle");
const inputA = ref<0 | 1>(1);
const inputB = ref<0 | 1>(1);
const outputValue = ref<Signal>("X");
const labIds = ref<LabIds | null>(null);
const selectedNode = ref<NodeKey>("andGate");
const themePreference = ref<ThemePreference>("system");
const showDetails = ref(false);
const showSidebar = ref(true);
const activeRailPage = ref<RailPage>("components");
const bottomTab = ref<BottomTab>("outputs");
const zoom = ref(100);
const simulationStep = ref(0);
const waveform = ref<WaveformPoint[]>([]);
const waveformRows: WaveformRow[] = [
  { label: "输入 A", key: "a" },
  { label: "输入 B", key: "b" },
  { label: "输出", key: "output" },
];
const inputControls = computed(() => [
  { key: "a" as InputKey, label: "输入 A", value: inputA.value, componentId: labIds.value?.inputA ?? null },
  { key: "b" as InputKey, label: "输入 B", value: inputB.value, componentId: labIds.value?.inputB ?? null },
]);
const outputs = computed(() => [
  {
    key: "output",
    label: "输出",
    value: outputValue.value,
    description: outputDescription.value,
    componentId: labIds.value?.output ?? null,
  },
]);

const engineStateLabel = computed(() => {
  if (engineState.value === "ready") return "引擎在线";
  if (engineState.value === "unavailable") return "引擎不可用";
  if (engineState.value === "error") return "连接失败";
  return "连接中";
});

const themeLabel = computed(() => {
  if (themePreference.value === "light") return "浅色主题";
  if (themePreference.value === "dark") return "深色主题";
  return "跟随系统";
});

const canRun = computed(
  () =>
    engineState.value === "ready" &&
    labIds.value !== null &&
    !isBusy.value &&
    simulationState.value === "idle",
);
const outputDescription = computed(() => {
  if (outputValue.value === "X") return "等待稳定求值";
  return outputValue.value === 1 ? "两个输入都为 1" : "至少一个输入为 0";
});
const selectedNodeName = computed(() => {
  if (selectedNode.value === "inputA") return "输入 A";
  if (selectedNode.value === "inputB") return "输入 B";
  if (selectedNode.value === "andGate") return "AND 门";
  return "输出";
});
const selectedNodeValue = computed<Signal>(() => {
  if (selectedNode.value === "inputA") return inputA.value;
  if (selectedNode.value === "inputB") return inputB.value;
  return outputValue.value;
});
const selectedNodeDescription = computed(() => {
  if (selectedNode.value === "inputA" || selectedNode.value === "inputB") {
    return "点击开关或画布节点，改变这个输入值。";
  }
  if (selectedNode.value === "andGate") return "两个输入都为 1 时，输出才为 1。";
  return outputDescription.value;
});
const zoomLabel = computed(() => `${zoom.value}%`);

function isErrorResponse(response: EngineResponse): response is ErrorResponse {
  return response.type === "error";
}

/** 确认引擎响应类型，并将协议错误转换为 UI 可展示的异常。 */
function expectResponse<T extends EngineResponse["type"]>(
  response: EngineResponse,
  expectedType: T,
): Extract<EngineResponse, { type: T }> {
  if (isErrorResponse(response)) throw new Error(response.message);
  if (response.type !== expectedType) {
    throw new Error(`引擎返回了意外响应：${response.type}`);
  }
  return response as Extract<EngineResponse, { type: T }>;
}

/** 将主题偏好同步到 document，并持久化用户选择。 */
function setThemePreference(theme: ThemePreference): void {
  themePreference.value = theme;
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.dataset.theme = theme;
  }
  localStorage.setItem(themeStorageKey, theme);
}

/** 在跟随系统、浅色和深色主题之间循环切换。 */
function cycleTheme(): void {
  const nextTheme: Record<ThemePreference, ThemePreference> = {
    system: "light",
    light: "dark",
    dark: "system",
  };
  setThemePreference(nextTheme[themePreference.value]);
}

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

function waveformValue(point: WaveformPoint, key: WaveformKey): Signal {
  return point[key];
}

/** 调整工作区缩放，只影响画布内容，不改变编辑器面板布局。 */
function adjustZoom(delta: number): void {
  zoom.value = Math.min(140, Math.max(60, zoom.value + delta));
}

/** 通过 preload 检查完整的 Vue → Electron → C++ 链路。 */
async function checkEngine(): Promise<boolean> {
  engineState.value = "checking";
  engineMessage.value = "正在连接 C++ 仿真引擎…";
  try {
    const result = await window.circuitPlatform.checkEngine();
    if (result.status === "ok") {
      engineState.value = "ready";
      engineName.value = result.engine ?? "CircuitPlatform C++ Engine";
      engineMessage.value = "引擎已就绪，可以运行示例电路。";
      return true;
    }

    engineState.value = result.status === "unavailable" ? "unavailable" : "error";
    engineMessage.value = result.message ?? "无法获得引擎状态。";
    return false;
  } catch (error) {
    engineState.value = "error";
    engineMessage.value = error instanceof Error ? error.message : "无法连接到 Electron 主进程。";
    return false;
  }
}

async function addComponent(kind: ComponentKindName): Promise<number> {
  return expectResponse(await window.circuitPlatform.addComponent(kind), "component_added").componentId;
}

/** 建立两个元件之间的协议连接，并在失败时保留可展示的错误信息。 */
async function addConnection(
  sourceComponentId: number,
  sourcePort: string,
  targetComponentId: number,
  targetPort: string,
): Promise<void> {
  expectResponse(
    await window.circuitPlatform.addConnection(
      { componentId: sourceComponentId, port: sourcePort },
      { componentId: targetComponentId, port: targetPort },
    ),
    "connection_added",
  );
}

/** 将当前输入发送到引擎，稳定求值并记录一次可展开的波形快照。 */
async function runSimulation(ids = labIds.value): Promise<boolean> {
  if (!ids) return false;
  simulationState.value = "running";
  try {
    expectResponse(await window.circuitPlatform.setInput(ids.inputA, inputA.value), "input_set");
    expectResponse(await window.circuitPlatform.setInput(ids.inputB, inputB.value), "input_set");
    expectResponse(await window.circuitPlatform.settle(), "settled");
    const result = expectResponse(
      await window.circuitPlatform.getSignal(ids.output, "in"),
      "signal_result",
    );
    outputValue.value = result.value;
    simulationStep.value += 1;
    waveform.value.push({
      step: simulationStep.value,
      a: inputA.value,
      b: inputB.value,
      output: outputValue.value,
    });
    engineMessage.value = "仿真已稳定，输出值已更新。";
    return true;
  } catch (error) {
    engineMessage.value = error instanceof Error ? error.message : "仿真失败。";
    return false;
  } finally {
    simulationState.value = "idle";
  }
}

/** 创建 AND 示例电路，并在创建完成后自动执行第一次求值。 */
async function loadDemoCircuit(): Promise<void> {
  if (labIds.value || isBusy.value || engineState.value !== "ready") return;
  isBusy.value = true;
  engineMessage.value = "正在创建 2 个输入、AND 门和输出端…";
  try {
    const ids: LabIds = {
      inputA: await addComponent("input"),
      inputB: await addComponent("input"),
      andGate: await addComponent("and"),
      output: await addComponent("output"),
    };

    await addConnection(ids.inputA, "out", ids.andGate, "in1");
    await addConnection(ids.inputB, "out", ids.andGate, "in2");
    await addConnection(ids.andGate, "out", ids.output, "in");
    labIds.value = ids;
    engineMessage.value = "示例已创建，试着切换输入 A 或输入 B。";
    await runSimulation(ids);
  } catch (error) {
    engineMessage.value = error instanceof Error ? error.message : "创建示例电路失败。";
  } finally {
    isBusy.value = false;
  }
}

/** 切换输入并立即执行一次完整的求值闭环。 */
async function toggleInput(key: InputKey): Promise<void> {
  if (!labIds.value || isBusy.value || simulationState.value === "running") return;
  if (key === "a") inputA.value = inputA.value === 1 ? 0 : 1;
  if (key === "b") inputB.value = inputB.value === 1 ? 0 : 1;
  isBusy.value = true;
  await runSimulation();
  isBusy.value = false;
}

/** 选中画布节点，并让属性区域展示同一个对象。 */
function selectNode(node: NodeKey): void {
  selectedNode.value = node;
}

function onNodeKeydown(event: KeyboardEvent, node: NodeKey): void {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    selectNode(node);
  }
}

/** 首次启动时恢复主题，并在引擎可用后自动加载教学示例。 */
async function bootstrap(): Promise<void> {
  const storedTheme = localStorage.getItem(themeStorageKey);
  if (storedTheme === "light" || storedTheme === "dark" || storedTheme === "system") {
    setThemePreference(storedTheme);
  }

  const engineReady = await checkEngine();
  if (engineReady) await loadDemoCircuit();
}

onMounted(() => {
  void bootstrap();
});
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand-lockup">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <strong class="brand-name">CircuitPlatform</strong>
        <span class="topbar-divider" aria-hidden="true"></span>
        <span class="project-name">未命名电路</span>
        <span class="save-state"><span class="save-dot" aria-hidden="true"></span>已保存</span>
      </div>

      <div class="topbar-actions">
        <span class="engine-chip" :class="`engine-chip--${engineState}`" aria-live="polite"><span class="pulse-dot" aria-hidden="true"></span>{{ engineStateLabel }}</span>
        <button class="topbar-button" type="button" @click="cycleTheme" :title="themeLabel"><span class="ui-icon ui-icon--sun" aria-hidden="true">◐</span></button>
        <button class="topbar-button" type="button" :disabled="isBusy" @click="checkEngine" title="重新检查引擎"><span class="ui-icon" aria-hidden="true">↻</span></button>
        <button class="avatar-button" type="button" aria-label="账户菜单">CP</button>
      </div>
    </header>

    <section class="editor-layout" :class="{ 'editor-layout--sidebar-collapsed': !showSidebar || activeRailPage === 'settings' }">
      <nav class="tool-rail" aria-label="工作区导航">
        <button class="rail-button" :class="{ 'rail-button--active': activeRailPage === 'components' }" type="button" aria-label="元件库" title="元件库" @click="showSidebar = true; activeRailPage = 'components'"><span class="rail-glyph rail-glyph--nodes" aria-hidden="true"><i></i><i></i><i></i></span></button>
        <button class="rail-button" :class="{ 'rail-button--active': activeRailPage === 'inputs' }" type="button" aria-label="输入设置" title="输入设置" @click="showSidebar = true; activeRailPage = 'inputs'"><span class="rail-glyph rail-glyph--switch" aria-hidden="true"><i></i><i></i></span></button>
        <button class="rail-button" :class="{ 'rail-button--active': activeRailPage === 'layers' }" type="button" aria-label="层级" title="层级" @click="showSidebar = true; activeRailPage = 'layers'"><span class="rail-glyph rail-glyph--layers" aria-hidden="true"><i></i><i></i><i></i></span></button>
        <span class="rail-spacer"></span>
        <button class="rail-button" :class="{ 'rail-button--active': activeRailPage === 'settings' }" type="button" aria-label="设置" title="设置" @click="activeRailPage = 'settings'"><span class="rail-glyph" aria-hidden="true">⚙</span></button>
      </nav>

      <aside v-if="showSidebar && activeRailPage !== 'settings'" class="sidebar" :aria-label="activeRailPage === 'components' ? '元件库' : activeRailPage === 'inputs' ? '输入设置' : '电路层级'">
        <div class="sidebar-heading"><div><span class="eyebrow">WORKSPACE / {{ activeRailPage }}</span><h1>{{ activeRailPage === "components" ? "元件库" : activeRailPage === "inputs" ? "输入设置" : "层级" }}</h1></div><button class="icon-button" type="button" aria-label="收起侧栏" title="收起侧栏" @click="showSidebar = false">‹</button></div>

        <template v-if="activeRailPage === 'components'">
          <div class="sidebar-section-title"><span>基础元件</span><span class="component-count">5</span></div>
          <div class="component-list">
            <button class="component-item" type="button" disabled title="元件添加将在画布编辑模式中开放"><span class="component-symbol component-symbol--input">↗</span><span><strong>输入</strong><small>INPUT / 1 bit</small></span><span class="drag-hint">＋</span></button>
            <button class="component-item" type="button" disabled title="元件添加将在画布编辑模式中开放"><span class="component-symbol component-symbol--output">↙</span><span><strong>输出</strong><small>OUTPUT / 1 bit</small></span><span class="drag-hint">＋</span></button>
            <button class="component-item component-item--selected" type="button" @click="selectNode('andGate')"><span class="component-symbol component-symbol--gate">&amp;</span><span><strong>AND 门</strong><small>LOGIC / 2 → 1</small></span><span class="drag-hint">＋</span></button>
            <button class="component-item" type="button" disabled title="暂未开放"><span class="component-symbol">≥1</span><span><strong>OR 门</strong><small>LOGIC / 2 → 1</small></span><span class="drag-hint">＋</span></button>
            <button class="component-item" type="button" disabled title="暂未开放"><span class="component-symbol">¬</span><span><strong>NOT 门</strong><small>LOGIC / 1 → 1</small></span><span class="drag-hint">＋</span></button>
          </div>
          <p class="sidebar-hint">选择元件后，拖入画布即可开始搭建。</p>
        </template>

        <template v-else-if="activeRailPage === 'inputs'">
          <div class="sidebar-section-title"><span>当前输入</span><span class="component-count">{{ inputControls.length }}</span></div>
          <div class="input-settings-list">
            <button v-for="input in inputControls" :key="input.key" class="input-setting" :class="{ 'input-setting--on': input.value === 1 }" type="button" :disabled="!canRun" @click="toggleInput(input.key)">
              <span class="input-setting-id">{{ input.key.toUpperCase() }}</span>
              <span class="input-setting-copy"><strong>{{ input.label }}</strong><small>source / component {{ input.componentId ?? "—" }}</small></span>
              <span class="input-setting-value">{{ input.value }}</span>
            </button>
          </div>
          <p class="sidebar-hint">切换后会立即运行一次仿真，所有输入都从这里统一编辑。</p>
        </template>

        <template v-else>
          <div class="sidebar-section-title"><span>当前电路</span><span class="component-count">4</span></div>
          <div class="layer-list">
            <button type="button" :class="{ 'layer-item--active': selectedNode === 'output' }" @click="selectNode('output')"><span class="layer-dot layer-dot--output"></span>输出 <small>OUTPUT</small></button>
            <button type="button" :class="{ 'layer-item--active': selectedNode === 'andGate' }" @click="selectNode('andGate')"><span class="layer-dot layer-dot--gate"></span>AND 门 <small>AND</small></button>
            <button type="button" :class="{ 'layer-item--active': selectedNode === 'inputB' }" @click="selectNode('inputB')"><span class="layer-dot"></span>输入 B <small>INPUT</small></button>
            <button type="button" :class="{ 'layer-item--active': selectedNode === 'inputA' }" @click="selectNode('inputA')"><span class="layer-dot"></span>输入 A <small>INPUT</small></button>
          </div>
        </template>
      </aside>

      <section v-if="activeRailPage !== 'settings'" class="editor-main" aria-label="电路编辑器">
        <div class="editor-toolbar"><div class="toolbar-breadcrumb"><span class="breadcrumb-muted">电路</span><span aria-hidden="true">/</span><strong>AND 门示例</strong><span class="toolbar-status"><span class="status-mark" aria-hidden="true">✓</span> 已保存</span></div><div class="toolbar-tools"><button class="tool-button" type="button" disabled title="撤销"><span aria-hidden="true">↶</span></button><button class="tool-button" type="button" disabled title="重做"><span aria-hidden="true">↷</span></button><span class="toolbar-rule" aria-hidden="true"></span><button class="tool-button" type="button" @click="adjustZoom(-10)" title="缩小">−</button><span class="zoom-label">{{ zoomLabel }}</span><button class="tool-button" type="button" @click="adjustZoom(10)" title="放大">＋</button><button class="tool-button tool-button--fit" type="button" @click="zoom = 100" title="适合窗口">适合窗口</button><span class="toolbar-rule" aria-hidden="true"></span><button class="run-button" type="button" :disabled="!canRun" @click="runSimulation()"><span aria-hidden="true">▶</span>{{ simulationState === "running" ? "仿真中…" : "运行一次" }}</button></div></div>

        <div class="editor-canvas-wrap"><div class="canvas-info"><span class="canvas-mode"><span class="mode-dot" aria-hidden="true"></span>编辑模式</span><span>按住空格拖动画布</span></div><div class="circuit-canvas" :style="{ '--canvas-zoom': `${zoom / 100}` }"><div class="canvas-grid" aria-hidden="true"></div><div class="canvas-zoom-layer"><svg class="signal-map" viewBox="0 0 1000 560" preserveAspectRatio="none" aria-hidden="true"><path class="signal-wire" :class="wireClass(inputA)" d="M 210 150 H 330 V 250 H 435" /><path class="signal-wire" :class="wireClass(inputB)" d="M 210 405 H 330 V 290 H 435" /><path class="signal-wire" :class="wireClass(outputValue)" d="M 585 270 H 805" /></svg><article class="circuit-node circuit-node--input-a" :class="{ 'circuit-node--selected': selectedNode === 'inputA' }" role="button" tabindex="0" aria-label="选择输入 A" @click="selectNode('inputA')" @keydown="onNodeKeydown($event, 'inputA')"><span class="node-tag">SOURCE / 01</span><strong>输入 A</strong><span class="node-value" :class="signalClass(inputA)">{{ inputA }}</span><span class="node-port node-port--right" :class="signalClass(inputA)">out</span></article><article class="circuit-node circuit-node--input-b" :class="{ 'circuit-node--selected': selectedNode === 'inputB' }" role="button" tabindex="0" aria-label="选择输入 B" @click="selectNode('inputB')" @keydown="onNodeKeydown($event, 'inputB')"><span class="node-tag">SOURCE / 02</span><strong>输入 B</strong><span class="node-value" :class="signalClass(inputB)">{{ inputB }}</span><span class="node-port node-port--right" :class="signalClass(inputB)">out</span></article><article class="circuit-node circuit-node--gate" :class="{ 'circuit-node--selected': selectedNode === 'andGate' }" role="button" tabindex="0" aria-label="选择 AND 门" @click="selectNode('andGate')" @keydown="onNodeKeydown($event, 'andGate')"><span class="node-tag">LOGIC / 2 → 1</span><strong>AND</strong><span class="node-port node-port--left node-port--upper">in1</span><span class="node-port node-port--left node-port--lower">in2</span><span class="node-port node-port--right" :class="signalClass(outputValue)">out · {{ outputValue }}</span></article><article class="circuit-node circuit-node--output" :class="[{ 'circuit-node--active': outputValue === 1 }, { 'circuit-node--selected': selectedNode === 'output' }]" role="button" tabindex="0" aria-label="选择输出" @click="selectNode('output')" @keydown="onNodeKeydown($event, 'output')"><span class="node-tag">MONITOR / 01</span><strong>输出</strong><span class="output-signal" :class="signalClass(outputValue)">{{ outputValue }}</span><span class="output-description">{{ outputDescription }}</span><span class="node-port node-port--left" :class="signalClass(outputValue)">in</span></article><div v-if="!labIds" class="canvas-empty-state"><span class="empty-orbit">＋</span><strong>{{ engineState === "ready" ? "正在准备示例电路" : "等待仿真引擎" }}</strong><p>{{ engineMessage }}</p></div><div v-if="labIds && waveform.length === 1" class="canvas-guidance"><span class="guidance-mark">↗</span><div><strong>试着切换输入 A</strong><p>观察高电平如何沿着连线影响输出。</p></div></div></div><div class="canvas-crosshair canvas-crosshair--tl" aria-hidden="true"></div><div class="canvas-crosshair canvas-crosshair--br" aria-hidden="true"></div></div><div class="canvas-legend"><span><i class="legend-line legend-line--live"></i>高电平 <b>1</b></span><span><i class="legend-line"></i>低电平 <b>0</b></span><span><i class="legend-line legend-line--unknown"></i>未知 <b>X</b></span></div></div>

        <section class="bottom-panel" aria-label="仿真结果面板">
          <div class="bottom-tabs">
            <button type="button" :class="{ 'bottom-tab--active': bottomTab === 'inspector' }" @click="bottomTab = 'inspector'">检查器</button>
            <button type="button" :class="{ 'bottom-tab--active': bottomTab === 'outputs' }" @click="bottomTab = 'outputs'">输出 <span class="tab-count">{{ outputs.length }}</span></button>
            <button type="button" :class="{ 'bottom-tab--active': bottomTab === 'waveform' }" :disabled="!waveform.length" @click="bottomTab = 'waveform'">波形 <span class="tab-count">{{ waveform.length }}</span></button>
          </div>
          <div v-if="bottomTab === 'inspector'" class="bottom-content bottom-content--inspector" aria-live="polite">
            <div class="bottom-inspector-heading"><div><span class="eyebrow">INSPECTOR</span><strong>{{ selectedNodeName }}</strong></div><span class="inspector-kind">{{ selectedNode === "andGate" ? "LOGIC" : "NODE" }}</span></div>
            <p>{{ selectedNodeDescription }}</p>
            <div class="inspector-value"><span>当前值</span><strong :class="signalClass(selectedNodeValue)">{{ selectedNodeValue }}</strong></div>
            <button class="details-button" type="button" @click="showDetails = !showDetails">{{ showDetails ? "收起详细信息" : "显示详细信息" }} <span aria-hidden="true">{{ showDetails ? "⌃" : "⌄" }}</span></button>
            <div v-if="showDetails" class="inspector-details"><span>端口：{{ selectedNode === "andGate" ? "in1 / in2 / out" : selectedNode === "output" ? "in" : "out" }}</span><span>组件 ID：{{ labIds?.[selectedNode] ?? "—" }}</span></div>
          </div>
          <div v-else-if="bottomTab === 'outputs'" class="bottom-content bottom-content--outputs" aria-live="polite">
            <div class="output-panel-heading"><div><span class="eyebrow">OUTPUT MONITOR</span><strong>当前电路输出</strong></div><span>{{ outputs.length }} 个输出</span></div>
            <div class="output-list"><button v-for="output in outputs" :key="output.key" class="output-readout" type="button" @click="selectNode('output')"><span class="output-readout-symbol" :class="signalClass(output.value)">OUT</span><span class="output-readout-copy"><strong>{{ output.label }}</strong><small>{{ output.description }} · component {{ output.componentId ?? "—" }}</small></span><b :class="signalClass(output.value)">{{ output.value }}</b></button></div>
            <div class="bottom-engine"><span class="engine-indicator" :class="`engine-indicator--${engineState}`"></span><span>{{ engineName }}</span></div>
          </div>
          <div v-else class="bottom-content bottom-content--waveform">
            <div class="waveform-meta"><span class="eyebrow">WAVEFORM / HISTORY</span><span>STEP 01–{{ simulationStep.toString().padStart(2, "0") }}</span></div>
            <div class="waveform-grid" :style="{ '--waveform-steps': waveform.length }"><div class="waveform-axis"><span>信号</span><span v-for="point in waveform" :key="`axis-${point.step}`">{{ point.step }}</span></div><div v-for="row in waveformRows" :key="row.key" class="waveform-row"><span class="waveform-label">{{ row.label }}</span><span v-for="point in waveform" :key="`${row.key}-${point.step}`" class="waveform-cell" :class="signalClass(waveformValue(point, row.key))">{{ waveformValue(point, row.key) }}</span></div></div>
          </div>
        </section>
      </section>
      <section v-else class="settings-page" aria-label="设置">
        <div class="settings-heading"><span class="eyebrow">WORKSPACE / SETTINGS</span><h1>设置</h1><p>调整工作区外观和仿真连接。设置独立成页，不打断当前电路。</p></div>
        <div class="settings-grid">
          <section class="settings-card"><div class="settings-card-heading"><span class="eyebrow">APPEARANCE</span><strong>外观</strong></div><p>选择工作区的显示主题。</p><div class="theme-options"><button type="button" :class="{ 'theme-option--active': themePreference === 'system' }" @click="setThemePreference('system')"><span class="theme-swatch theme-swatch--system"></span><span>跟随系统</span></button><button type="button" :class="{ 'theme-option--active': themePreference === 'light' }" @click="setThemePreference('light')"><span class="theme-swatch theme-swatch--light"></span><span>浅色主题</span></button><button type="button" :class="{ 'theme-option--active': themePreference === 'dark' }" @click="setThemePreference('dark')"><span class="theme-swatch theme-swatch--dark"></span><span>深色主题</span></button></div></section>
          <section class="settings-card"><div class="settings-card-heading"><span class="eyebrow">ENGINE</span><strong>仿真引擎</strong></div><p>{{ engineMessage }}</p><div class="settings-engine-status"><span class="engine-indicator" :class="`engine-indicator--${engineState}`"></span><span>{{ engineStateLabel }}</span><small>{{ engineName }}</small></div><button class="settings-action" type="button" :disabled="isBusy" @click="checkEngine">重新检查引擎 <span aria-hidden="true">↻</span></button></section>
          <section class="settings-card"><div class="settings-card-heading"><span class="eyebrow">WORKSPACE</span><strong>工作区</strong></div><div class="settings-fact"><span>当前项目</span><strong>未命名电路</strong></div><div class="settings-fact"><span>组件数量</span><strong>{{ labIds ? 4 : 0 }}</strong></div><div class="settings-fact"><span>仿真步数</span><strong>{{ simulationStep }}</strong></div></section>
        </div>
      </section>
    </section>
  </main>
</template>
