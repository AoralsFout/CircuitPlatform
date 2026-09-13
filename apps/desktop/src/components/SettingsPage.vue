<script setup lang="ts">
import type { ThemePreference } from "../composables/useThemePreference";
import type { WorkspaceEngineState } from "../workspace";

defineProps<{
  themePreference: ThemePreference;
  engineMessage: string;
  engineState: WorkspaceEngineState;
  engineStateLabel: string;
  engineName: string;
  isBusy: boolean;
  componentCount: number;
  simulationStep: number;
}>();

const emit = defineEmits<{
  setThemePreference: [theme: ThemePreference];
  checkEngine: [];
}>();
</script>

<template>
  <section class="settings-page" aria-label="设置">
    <div class="settings-heading"><span class="eyebrow">WORKSPACE / SETTINGS</span><h1>设置</h1><p>调整工作区外观和仿真连接。设置独立成页，不打断当前电路。</p></div>
    <div class="settings-grid">
      <section class="settings-card"><div class="settings-card-heading"><span class="eyebrow">APPEARANCE</span><strong>外观</strong></div><p>选择工作区的显示主题。</p><div class="theme-options"><button type="button" :class="{ 'theme-option--active': themePreference === 'system' }" @click="emit('setThemePreference', 'system')"><span class="theme-swatch theme-swatch--system"></span><span>跟随系统</span></button><button type="button" :class="{ 'theme-option--active': themePreference === 'light' }" @click="emit('setThemePreference', 'light')"><span class="theme-swatch theme-swatch--light"></span><span>浅色主题</span></button><button type="button" :class="{ 'theme-option--active': themePreference === 'dark' }" @click="emit('setThemePreference', 'dark')"><span class="theme-swatch theme-swatch--dark"></span><span>深色主题</span></button></div></section>
      <section class="settings-card"><div class="settings-card-heading"><span class="eyebrow">ENGINE</span><strong>仿真引擎</strong></div><p>{{ engineMessage }}</p><div class="settings-engine-status"><span class="engine-indicator" :class="`engine-indicator--${engineState}`"></span><span>{{ engineStateLabel }}</span><small>{{ engineName }}</small></div><button class="settings-action" type="button" :disabled="isBusy" @click="emit('checkEngine')">重新检查引擎 <span aria-hidden="true">↻</span></button></section>
      <section class="settings-card"><div class="settings-card-heading"><span class="eyebrow">WORKSPACE</span><strong>工作区</strong></div><div class="settings-fact"><span>当前项目</span><strong>未命名电路</strong></div><div class="settings-fact"><span>组件数量</span><strong>{{ componentCount }}</strong></div><div class="settings-fact"><span>仿真步数</span><strong>{{ simulationStep }}</strong></div></section>
    </div>
  </section>
</template>
