<script setup lang="ts">
import { ref } from "vue";

type EngineState = "未检查" | "连接正常" | "不可用" | "检查失败";

const engineState = ref<EngineState>("未检查");
const engineMessage = ref("点击下方按钮验证 C++ 仿真引擎连接。");
const isChecking = ref(false);

async function checkEngine() {
  isChecking.value = true;
  try {
    const result = await window.circuitPlatform.checkEngine();
    if (result.status === "ok") {
      engineState.value = "连接正常";
      engineMessage.value = `引擎已响应：${result.engine ?? "未知版本"}`;
    } else if (result.status === "unavailable") {
      engineState.value = "不可用";
      engineMessage.value = result.message ?? "尚未找到 C++ 引擎。";
    } else {
      engineState.value = "检查失败";
      engineMessage.value = result.message ?? "C++ 引擎返回了错误。";
    }
  } catch (error) {
    engineState.value = "检查失败";
    engineMessage.value = error instanceof Error ? error.message : "无法连接到 Electron 主进程。";
  } finally {
    isChecking.value = false;
  }
}
</script>

<template>
  <main class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">DIGITAL CIRCUIT SIMULATOR</p>
        <h1>CircuitPlatform</h1>
      </div>
      <span class="phase-badge">Phase 0 · 脚手架</span>
    </header>

    <section class="welcome-card">
      <div class="welcome-copy">
        <p class="eyebrow">欢迎进入实验台</p>
        <h2>从一个可验证的工程闭环开始。</h2>
        <p>
          这里将逐步变成一个数字电路仿真器。当前版本先验证 Vue、Electron 与 C++ 引擎之间的连接。
        </p>
        <button class="primary-button" :disabled="isChecking" @click="checkEngine">
          {{ isChecking ? "检查中…" : "检查 C++ 引擎" }}
        </button>
      </div>

      <div class="status-panel" aria-live="polite">
        <span class="status-label">ENGINE STATUS</span>
        <strong :class="['status-value', `status-${engineState}`]">{{ engineState }}</strong>
        <p>{{ engineMessage }}</p>
      </div>
    </section>

    <section class="learning-grid">
      <article>
        <span class="card-index">01</span>
        <h3>领域模型</h3>
        <p>建立 Circuit、Component、Port、Wire 和 Signal 的共同语言。</p>
      </article>
      <article>
        <span class="card-index">02</span>
        <h3>仿真内核</h3>
        <p>先实现组合逻辑，再加入 Clock、D Flip-Flop 和状态更新。</p>
      </article>
      <article>
        <span class="card-index">03</span>
        <h3>工程能力</h3>
        <p>用测试、文档、CI 和复盘把每个功能做成完整闭环。</p>
      </article>
    </section>
  </main>
</template>
