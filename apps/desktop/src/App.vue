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

interface LabIds {
  inputA: number;
  inputB: number;
  andGate: number;
  output: number;
}

const engineState = ref<EngineState>("checking");
const engineMessage = ref("正在连接 C++ 仿真引擎…");
const engineName = ref("未连接");
const isBusy = ref(false);
const inputA = ref<0 | 1>(1);
const inputB = ref<0 | 1>(1);
const outputValue = ref<Signal>("X");
const labIds = ref<LabIds | null>(null);

const engineStateLabel = computed(() => {
  if (engineState.value === "ready") return "引擎在线";
  if (engineState.value === "unavailable") return "引擎不可用";
  if (engineState.value === "error") return "连接失败";
  return "连接中";
});

const canRun = computed(() => engineState.value === "ready" && labIds.value !== null && !isBusy.value);
const outputDescription = computed(() => {
  if (outputValue.value === "X") return "等待稳定求值";
  return outputValue.value === 1 ? "两个输入都为 1" : "至少一个输入为 0";
});

function isErrorResponse(response: EngineResponse): response is ErrorResponse {
  return response.type === "error";
}

/**
 * 确认引擎响应类型，并将协议错误转换为 UI 可展示的异常。
 * @param response 引擎返回的协议响应。
 * @param expectedType 当前操作期望的响应类型。
 * @returns 带有精确类型的成功响应。
 * @throws 当引擎返回错误或意外响应时抛出异常。
 */
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

/** 通过 preload 检查完整的 Vue → Electron → C++ 链路。 */
async function checkEngine(): Promise<boolean> {
  engineState.value = "checking";
  engineMessage.value = "正在连接 C++ 仿真引擎…";
  try {
    const result = await window.circuitPlatform.checkEngine();
    if (result.status === "ok") {
      engineState.value = "ready";
      engineName.value = result.engine ?? "CircuitPlatform C++ Engine";
      engineMessage.value = "可以开始运行练习电路。";
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

async function addConnection(
  sourceComponentId: number,
  sourcePort: string,
  targetComponentId: number,
  targetPort: string,
) {
  expectResponse(
    await window.circuitPlatform.addConnection(
      { componentId: sourceComponentId, port: sourcePort },
      { componentId: targetComponentId, port: targetPort },
    ),
    "connection_added",
  );
}

/** 创建一次性的 AND 教学样例，展示 UI 命令如何组成一份 Circuit。 */
async function loadPracticeCircuit() {
  if (labIds.value || isBusy.value) return;
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
    engineMessage.value = "样例已创建，点击输入开关运行一次仿真。";
    await runSimulation(ids);
  } catch (error) {
    engineMessage.value = error instanceof Error ? error.message : "创建练习电路失败。";
  } finally {
    isBusy.value = false;
  }
}

/** 将当前两个输入值发送到引擎，稳定仿真后读取 Output 的输入端。 */
async function runSimulation(ids = labIds.value) {
  if (!ids) return;
  try {
    expectResponse(
      await window.circuitPlatform.setInput(ids.inputA, inputA.value),
      "input_set",
    );
    expectResponse(
      await window.circuitPlatform.setInput(ids.inputB, inputB.value),
      "input_set",
    );
    expectResponse(await window.circuitPlatform.settle(), "settled");
    const result = expectResponse(
      await window.circuitPlatform.getSignal(ids.output, "in"),
      "signal_result",
    );
    outputValue.value = result.value;
    engineMessage.value = "仿真已稳定，输出值已更新。";
  } catch (error) {
    engineMessage.value = error instanceof Error ? error.message : "仿真失败。";
  }
}

/** 切换一个输入并立即执行一次完整的求值闭环。 */
async function toggleInput(key: InputKey) {
  if (!labIds.value || isBusy.value) return;
  if (key === "a") inputA.value = inputA.value === 1 ? 0 : 1;
  if (key === "b") inputB.value = inputB.value === 1 ? 0 : 1;
  isBusy.value = true;
  await runSimulation();
  isBusy.value = false;
}

onMounted(() => {
  void checkEngine();
});
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand-lockup">
        <span class="brand-mark" aria-hidden="true">CP</span>
        <div>
          <p class="eyebrow">DIGITAL CIRCUIT LAB / 02</p>
          <h1>CircuitPlatform</h1>
        </div>
      </div>
      <div class="topbar-actions">
        <span class="engine-chip" :class="`engine-chip--${engineState}`">
          <span class="pulse-dot" aria-hidden="true"></span>
          {{ engineStateLabel }}
        </span>
        <button class="quiet-button" type="button" :disabled="isBusy" @click="checkEngine">
          重新检查
        </button>
      </div>
    </header>

    <section class="workspace-heading">
      <div>
        <p class="eyebrow">组合逻辑 / FIRST VERTICAL SLICE</p>
        <h2>让一条信号<br /><em>真正走起来。</em></h2>
      </div>
      <div class="heading-note">
        <span class="note-index">练习 01</span>
        <p>先观察结构，再改变输入。每次操作都会经过 Electron 桥接，由 C++ 引擎完成求值。</p>
      </div>
    </section>

    <section class="lab-layout">
      <aside class="control-panel">
        <div class="panel-heading">
          <span class="panel-kicker">实验控制</span>
          <span class="panel-status" :class="{ 'panel-status--ready': labIds }">
            {{ labIds ? "已加载" : "未加载" }}
          </span>
        </div>

        <div class="lesson-card">
          <span class="lesson-number">01</span>
          <div>
            <strong>AND 门练习</strong>
            <p>两个输入都为 1 时，输出才为 1。</p>
          </div>
        </div>

        <button
          class="primary-button"
          type="button"
          :disabled="engineState !== 'ready' || !!labIds || isBusy"
          @click="loadPracticeCircuit"
        >
          <span>{{ isBusy && !labIds ? "创建中…" : labIds ? "样例已创建" : "加载练习电路" }}</span>
          <span aria-hidden="true">↗</span>
        </button>

        <div class="control-divider"></div>

        <div class="input-controls">
          <div class="section-label">输入开关</div>
          <button
            class="input-switch"
            :class="{ 'input-switch--on': inputA === 1 }"
            type="button"
            :disabled="!canRun"
            @click="toggleInput('a')"
          >
            <span class="switch-id">A</span>
            <span class="switch-copy"><strong>输入 A</strong><small>Input / out</small></span>
            <span class="switch-value">{{ inputA }}</span>
          </button>
          <button
            class="input-switch"
            :class="{ 'input-switch--on': inputB === 1 }"
            type="button"
            :disabled="!canRun"
            @click="toggleInput('b')"
          >
            <span class="switch-id">B</span>
            <span class="switch-copy"><strong>输入 B</strong><small>Input / out</small></span>
            <span class="switch-value">{{ inputB }}</span>
          </button>
        </div>

        <div class="engine-readout" aria-live="polite">
          <span class="section-label">运行信息</span>
          <p>{{ engineMessage }}</p>
          <small>{{ engineName }}</small>
        </div>
      </aside>

      <section class="canvas-panel" aria-label="AND 门练习电路">
        <div class="canvas-toolbar">
          <div>
            <span class="panel-kicker">Circuit / live view</span>
            <span class="canvas-caption">结构和信号分层显示</span>
          </div>
          <div class="legend">
            <span><i class="legend-line legend-line--live"></i>当前为 1</span>
            <span><i class="legend-line"></i>当前为 0</span>
          </div>
        </div>

        <div class="circuit-canvas">
          <div class="canvas-grid" aria-hidden="true"></div>
          <svg class="signal-map" viewBox="0 0 1000 460" preserveAspectRatio="none" aria-hidden="true">
            <path class="signal-wire" :class="{ 'signal-wire--live': inputA === 1 }" d="M 190 122 C 290 122, 330 195, 425 195" />
            <path class="signal-wire" :class="{ 'signal-wire--live': inputB === 1 }" d="M 190 320 C 290 320, 330 235, 425 235" />
            <path class="signal-wire" :class="{ 'signal-wire--live': outputValue === 1 }" d="M 575 215 C 670 215, 700 215, 785 215" />
          </svg>

          <article class="circuit-node circuit-node--input-a">
            <span class="node-tag">SOURCE / 01</span>
            <strong>输入 A</strong>
            <span class="node-port node-port--right">out · {{ inputA }}</span>
          </article>
          <article class="circuit-node circuit-node--input-b">
            <span class="node-tag">SOURCE / 02</span>
            <strong>输入 B</strong>
            <span class="node-port node-port--right">out · {{ inputB }}</span>
          </article>
          <article class="circuit-node circuit-node--gate">
            <span class="node-tag">LOGIC / AND</span>
            <strong>AND</strong>
            <span class="node-port node-port--left node-port--upper">in1</span>
            <span class="node-port node-port--left node-port--lower">in2</span>
            <span class="node-port node-port--right">out · {{ outputValue }}</span>
          </article>
          <article class="circuit-node circuit-node--output" :class="{ 'circuit-node--active': outputValue === 1 }">
            <span class="node-tag">MONITOR / 01</span>
            <strong>输出</strong>
            <span class="output-signal">{{ outputValue }}</span>
            <span class="output-description">{{ outputDescription }}</span>
            <span class="node-port node-port--left">in</span>
          </article>

          <div v-if="!labIds" class="canvas-empty-state">
            <span class="empty-orbit">＋</span>
            <strong>先加载一份练习电路</strong>
            <p>左侧操作会创建结构并启动第一次仿真。</p>
          </div>
        </div>
      </section>
    </section>

    <footer class="learning-footer">
      <span class="footer-title">本轮工程观察</span>
      <p>UI 只发送命令和展示结果；Circuit 保存结构，Simulation 保存运行时信号。</p>
      <span class="footer-step">下一步：编辑器命令 →</span>
    </footer>
  </main>
</template>
