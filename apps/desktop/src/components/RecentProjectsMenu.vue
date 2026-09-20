<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import RecentProjectList from "./RecentProjectList.vue";
import { moveRecentProjectsMenuFocus, resolveRecentProjectsMenuKeyAction } from "./recent-projects-menu";
import type { RecentProject } from "../project-file/recent-projects";

/**
 * 顶栏的「最近项目」下拉入口：条目渲染复用 `RecentProjectList`，菜单容器提供键盘语义——
 * 方向键在列表内循环移动焦点，`Esc` 关闭并把焦点还给入口按钮，焦点或指针离开即收起。
 * 列表为空时整个入口不渲染：空菜单只是噪音，首启空状态的最近项目入口由 #40 挂载。
 */
const props = defineProps<{
  /** 最近项目列表，最近使用在前。 */
  projects: readonly RecentProject[];
  /** 与其它顶栏入口一致：编辑器未就绪时入口禁用。 */
  disabled?: boolean;
}>();

const emit = defineEmits<{
  /** 请求打开指定路径的项目；置脏确认与加载路径由工作区组合层处理。 */
  openProject: [path: string];
}>();

const isOpen = ref(false);
const rootRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);

/** 面板内的条目按钮；方向键导航在这份扁平列表上进行。 */
function itemButtons(): HTMLButtonElement[] {
  return panelRef.value ? Array.from(panelRef.value.querySelectorAll<HTMLButtonElement>(".recent-projects-item")) : [];
}

async function toggle(): Promise<void> {
  isOpen.value = !isOpen.value;
  if (!isOpen.value) return;
  // 打开即把焦点移入列表：方向键与 Tab 从第一条开始，不需要再按一次 Tab 找位置。
  await nextTick();
  itemButtons()[0]?.focus();
}

function close(refocusTrigger = false): void {
  if (!isOpen.value) return;
  isOpen.value = false;
  if (refocusTrigger) triggerRef.value?.focus();
}

function chooseProject(path: string): void {
  close();
  emit("openProject", path);
}

function onPanelKeydown(event: KeyboardEvent): void {
  const action = resolveRecentProjectsMenuKeyAction(event.key);
  if (action === "none") return;
  // 菜单内的 Esc 只关菜单：不冒泡给窗口级处理器，避免顺手取消画布上的选择或确认框。
  event.preventDefault();
  event.stopPropagation();
  if (action === "close") {
    close(true);
    return;
  }
  const items = itemButtons();
  const current = items.findIndex((item) => item === document.activeElement);
  items[moveRecentProjectsMenuFocus(current, items.length, action)]?.focus();
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!isOpen.value) return;
  if (event.target instanceof Node && rootRef.value?.contains(event.target)) return;
  close();
}

function onRootFocusOut(event: FocusEvent): void {
  if (!isOpen.value) return;
  if (event.relatedTarget instanceof Node && rootRef.value?.contains(event.relatedTarget)) return;
  close();
}

onMounted(() => document.addEventListener("pointerdown", onDocumentPointerDown));
onBeforeUnmount(() => document.removeEventListener("pointerdown", onDocumentPointerDown));
</script>

<template>
  <div v-if="projects.length > 0" ref="rootRef" class="recent-projects" @focusout="onRootFocusOut">
    <button
      ref="triggerRef"
      class="topbar-button topbar-button--text"
      type="button"
      :disabled="disabled"
      aria-haspopup="menu"
      :aria-expanded="isOpen"
      title="最近项目"
      @click="toggle"
    >最近项目</button>
    <div
      v-if="isOpen"
      ref="panelRef"
      class="recent-projects-menu"
      role="menu"
      aria-label="最近项目"
      @keydown="onPanelKeydown"
    >
      <RecentProjectList :projects="projects" item-role="menuitem" @open-project="chooseProject" />
    </div>
  </div>
</template>
