<script setup lang="ts">
import type { WorkspaceEngineState } from "../workspace";

defineProps<{
  engineState: WorkspaceEngineState;
  engineStateLabel: string;
  themeLabel: string;
  isBusy: boolean;
}>();

const emit = defineEmits<{
  cycleTheme: [];
  checkEngine: [];
}>();
</script>

<template>
  <header class="topbar">
    <div class="brand-lockup">
      <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
      <strong class="brand-name">CircuitPlatform</strong>
      <span class="topbar-divider" aria-hidden="true"></span>
      <span class="project-name">未命名电路</span>
      <span class="save-state"><span class="save-dot" aria-hidden="true"></span>示例电路</span>
    </div>

    <div class="topbar-actions">
      <span class="engine-chip" :class="`engine-chip--${engineState}`" aria-live="polite"><span class="pulse-dot" aria-hidden="true"></span>{{ engineStateLabel }}</span>
      <button class="topbar-button" type="button" @click="emit('cycleTheme')" :title="themeLabel"><span class="ui-icon ui-icon--sun" aria-hidden="true">◐</span></button>
      <button class="topbar-button" type="button" :disabled="isBusy" @click="emit('checkEngine')" title="重新检查引擎"><span class="ui-icon" aria-hidden="true">↻</span></button>
      <button class="avatar-button" type="button" aria-label="账户菜单">CP</button>
    </div>
  </header>
</template>
