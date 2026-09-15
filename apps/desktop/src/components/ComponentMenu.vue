<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  createComponentMenuGroups,
  type ComponentMenuGroup,
} from "../editor/component-menu";
import type { ComponentDefinition } from "../canvas";
import type { ComponentKindName } from "@circuit-platform/protocol";

const props = defineProps<{
  definitions: readonly ComponentDefinition[];
  recentKinds: readonly ComponentKindName[];
}>();

const emit = defineEmits<{
  select: [kind: ComponentKindName];
  close: [];
}>();

const query = ref("");
const activeIndex = ref(0);
const searchInput = ref<HTMLInputElement | null>(null);

const groups = computed<readonly ComponentMenuGroup[]>(() => createComponentMenuGroups(props.definitions, props.recentKinds, query.value));
const items = computed(() => groups.value.flatMap((group) => group.definitions));
const activeKind = computed(() => items.value[activeIndex.value]?.kind);

function focusSearch(): void {
  void nextTick(() => searchInput.value?.focus());
}

function resetActive(): void {
  activeIndex.value = 0;
}

function moveActive(delta: number): void {
  const count = items.value.length;
  if (count === 0) return;
  let next = activeIndex.value;
  for (let attempts = 0; attempts < count; attempts += 1) {
    next = (next + delta + count) % count;
    if (items.value[next]?.available) {
      activeIndex.value = next;
      return;
    }
  }
}

function select(kind: ComponentKindName): void {
  const definition = props.definitions.find((item) => item.kind === kind);
  if (!definition?.available) return;
  emit("select", kind);
}

function selectActive(): void {
  if (activeKind.value) select(activeKind.value);
}

/** 在菜单分类之间移动；搜索结果是单层分类，左右键保持列表内导航。 */
function moveGroup(delta: number): void {
  if (groups.value.length <= 1) {
    moveActive(delta);
    return;
  }
  const currentGroup = groups.value.findIndex((group) => group.definitions.some((definition) => definition.kind === activeKind.value));
  const nextGroupIndex = (Math.max(0, currentGroup) + delta + groups.value.length) % groups.value.length;
  const nextGroup = groups.value[nextGroupIndex];
  if (!nextGroup) return;
  const nextItem = nextGroup.definitions.find((definition) => definition.available) ?? nextGroup.definitions[0];
  if (nextItem) activeIndex.value = items.value.findIndex((item) => item.kind === nextItem.kind);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    moveActive(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveActive(-1);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    moveGroup(1);
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    moveGroup(-1);
  } else if (event.key === "Home") {
    event.preventDefault();
    activeIndex.value = 0;
  } else if (event.key === "End") {
    event.preventDefault();
    activeIndex.value = Math.max(0, items.value.length - 1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    selectActive();
  }
}

watch(() => query.value, resetActive);
watch(() => props.recentKinds, resetActive);
focusSearch();
</script>

<template>
  <section class="component-menu" role="menu" aria-label="添加元件" @keydown="onKeydown" @wheel.stop>
    <div class="component-menu__heading">
      <div><span class="eyebrow">ADD / COMPONENT</span><strong>添加元件</strong></div>
      <button type="button" class="component-menu__close" aria-label="关闭元件菜单" @click="emit('close')">×</button>
    </div>
    <label class="component-menu__search">
      <span aria-hidden="true">⌕</span>
      <input ref="searchInput" v-model="query" type="search" placeholder="搜索名称或类型…" aria-label="搜索元件名称或类型" autocomplete="off" />
      <kbd>Esc</kbd>
    </label>
    <div class="component-menu__groups">
      <div v-for="group in groups" :key="group.id" class="component-menu__group">
        <h2>{{ group.label }}</h2>
        <button
          v-for="definition in group.definitions"
          :key="definition.kind"
          type="button"
          class="component-menu__item"
          :class="{ 'component-menu__item--active': activeKind === definition.kind, 'component-menu__item--disabled': !definition.available }"
          role="menuitem"
          :disabled="!definition.available"
          :aria-disabled="!definition.available"
          :title="definition.available ? `添加${definition.displayName}` : definition.disabledReason ?? '暂不可用'"
          @mouseenter="activeIndex = items.findIndex((item) => item.kind === definition.kind)"
          @click="select(definition.kind)"
        >
          <span class="component-menu__symbol" aria-hidden="true">{{ definition.symbol }}</span>
          <span class="component-menu__copy"><strong>{{ definition.displayName }}</strong><small>{{ definition.kind.toUpperCase() }} · {{ definition.description }}</small><small v-if="!definition.available" class="component-menu__reason">不可用：{{ definition.disabledReason }}</small></span>
          <span v-if="activeKind === definition.kind && definition.available" class="component-menu__shortcut">↵</span>
        </button>
      </div>
      <p v-if="items.length === 0" class="component-menu__empty">没有匹配的元件</p>
    </div>
    <footer class="component-menu__footer"><span><kbd>↑</kbd><kbd>↓</kbd> 导航</span><span><kbd>Enter</kbd> 添加</span><span><kbd>Esc</kbd> 关闭</span></footer>
  </section>
</template>
