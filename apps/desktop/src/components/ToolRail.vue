<script setup lang="ts">
import type { RailPage } from "../composables/useEditorState";

defineProps<{
  activeRailPage: RailPage;
}>();

const emit = defineEmits<{
  selectPage: [page: RailPage];
}>();
</script>

<template>
  <nav class="tool-rail" aria-label="工作区导航">
    <button class="rail-button" :class="{ 'rail-button--active': activeRailPage === 'components' }" type="button" aria-label="元件库" title="元件库" @click="emit('selectPage', 'components')"><span class="rail-glyph rail-glyph--nodes" aria-hidden="true"><i></i><i></i><i></i></span></button>
    <button class="rail-button" :class="{ 'rail-button--active': activeRailPage === 'inputs' }" type="button" aria-label="输入设置" title="输入设置" @click="emit('selectPage', 'inputs')"><span class="rail-glyph rail-glyph--switch" aria-hidden="true"><i></i><i></i></span></button>
    <button class="rail-button" :class="{ 'rail-button--active': activeRailPage === 'layers' }" type="button" aria-label="层级" title="层级" @click="emit('selectPage', 'layers')"><span class="rail-glyph rail-glyph--layers" aria-hidden="true"><i></i><i></i><i></i></span></button>
    <button class="rail-button" :class="{ 'rail-button--active': activeRailPage === 'subcircuits' }" type="button" aria-label="子电路" title="子电路" @click="emit('selectPage', 'subcircuits')"><span class="rail-glyph rail-glyph--subcircuits" aria-hidden="true">◇</span></button>
    <span class="rail-spacer"></span>
    <button class="rail-button" :class="{ 'rail-button--active': activeRailPage === 'settings' }" type="button" aria-label="设置" title="设置" @click="emit('selectPage', 'settings')"><span class="rail-glyph" aria-hidden="true">⚙</span></button>
  </nav>
</template>
