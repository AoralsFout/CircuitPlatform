<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import RecentProjectsMenu from "./RecentProjectsMenu.vue";
import type { ProjectSaveState } from "../composables/useWorkspace";
import type { RecentProject } from "../project-file/recent-projects";
import type { WorkspaceEngineState } from "../workspace";
import type { DocumentTabSnapshot } from "../workspace/documentCoordinator";
import { resolveDocumentTabKey } from "./document-tabs";

const props = defineProps<{
  engineState: WorkspaceEngineState;
  engineStateLabel: string;
  themeLabel: string;
  isBusy: boolean;
  /** 当前文档已保存到的文件名；未保存过时为 null，展示占位名。 */
  projectName: string | null;
  /** 保存状态语义：已保存、有未保存改动、最近一次保存失败。 */
  saveState: ProjectSaveState;
  /** 最近一次保存失败的原因；作为指示器的悬停提示展示。 */
  saveError: string | null;
  /** 编辑器会话就绪；新建、打开与保存都以它为前提。 */
  canSave: boolean;
  /** 最近项目列表，最近使用在前；为空时最近项目入口不渲染。 */
  recentProjects: readonly RecentProject[];
  /** 打开的文档标签；顺序由协调器维护。 */
  tabs?: readonly DocumentTabSnapshot[];
  /** 当前活动标签键。 */
  activeDocumentKey?: string | null;
  canReturnToParent?: boolean;
}>();

const emit = defineEmits<{
  cycleTheme: [];
  checkEngine: [];
  /** 新建空文档；文档置脏时先确认。 */
  newDocument: [];
  /** 打开项目文件；文档置脏时先确认。 */
  openDocument: [];
  /** 从最近项目列表打开指定路径；置脏确认与加载路径由工作区组合层处理。 */
  openRecentProject: [path: string];
  /** 保存当前文档；已有路径直接覆写，没有路径转入另存为。 */
  save: [];
  /** 另存为：总是询问位置，成功后文档身份切换为新路径。 */
  saveAs: [];
  activateTab: [key: string];
  closeTab: [key: string];
  returnToParent: [];
}>();

/** 保存指示器的可见文案；脏标记与失败都必须让用户「看到」，不能只留在标题里。 */
const saveStateLabels: Record<ProjectSaveState, string> = {
  saved: "已保存",
  dirty: "未保存",
  error: "保存失败",
};

const saveStateLabel = computed(() => saveStateLabels[props.saveState]);

const tablist = ref<HTMLElement | null>(null);

/**
 * 关闭按钮既支持鼠标也支持原生 Enter/Space 键；关闭完成后把焦点放回活动标签。
 * 如果未保存确认被取消，目标标签仍然存在，焦点也会留在它上面，避免跳到页面正文。
 */
async function closeTab(key: string): Promise<void> {
  emit("closeTab", key);
  await nextTick();
  const target = Array.from(tablist.value?.querySelectorAll<HTMLElement>("[data-document-key]") ?? [])
    .find((tab) => tab.dataset.documentKey === key);
  const active = tablist.value?.querySelector<HTMLElement>("[role=tab][aria-selected=true]");
  (target ?? active ?? tablist.value)?.focus();
}

function onTabKeydown(event: KeyboardEvent, index: number): void {
  // Let the nested close button keep its native Enter/Space activation. Without
  // this guard the tab's roving-focus handler would prevent that click while the
  // event bubbles from the button.
  if (event.target instanceof HTMLElement && event.target.closest("button") !== null) return;
  const result = resolveDocumentTabKey(event.key, index, props.tabs?.length ?? 0);
  if (result.action === "none") return;
  event.preventDefault();
  const buttons = Array.from((event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>("[role=tab]") ?? []);
  buttons[result.index]?.focus();
  if (result.action === "activate") {
    const tab = props.tabs?.[result.index];
    if (tab) emit("activateTab", tab.key);
  }
}
</script>

<template>
  <header class="topbar">
    <div class="brand-lockup">
      <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
      <strong class="brand-name">CircuitPlatform</strong>
      <span class="topbar-divider" aria-hidden="true"></span>
      <div v-if="tabs && tabs.length > 0" ref="tablist" class="document-tabs" role="tablist" aria-label="打开的项目">
        <div
          v-for="(tab, index) in tabs"
          :key="tab.key"
          class="document-tab"
          :class="{ 'document-tab--active': tab.key === activeDocumentKey }"
          role="tab"
          :aria-selected="tab.key === activeDocumentKey"
          :aria-label="`${tab.displayName}${tab.kind === 'definition' ? '，只读定义' : ''}${tab.isDirty ? '，有未保存改动' : ''}`"
          :data-document-key="tab.key"
          :tabindex="tab.key === activeDocumentKey ? 0 : -1"
          @click="emit('activateTab', tab.key)"
          @keydown="onTabKeydown($event, index)"
        >
          <span class="document-tab__label">{{ tab.kind === 'definition' ? '◇ ' : '' }}{{ tab.displayName }}</span>
          <span v-if="tab.isDirty" class="document-tab__dirty" aria-label="未保存" title="未保存">●</span>
          <span class="document-tab__active-indicator" aria-hidden="true"></span>
          <span class="document-tab__close-wrap">
            <button type="button" class="document-tab__close" :aria-label="`关闭 ${tab.displayName}`" @click.stop="closeTab(tab.key)">×</button>
          </span>
        </div>
      </div>
      <span v-else class="project-name">{{ projectName ?? "未命名电路" }}</span>
      <span class="save-state" :class="`save-state--${saveState}`" :title="saveError ?? undefined" aria-live="polite"><span class="save-dot" aria-hidden="true"></span>{{ saveStateLabel }}</span>
    </div>

    <div class="topbar-actions">
      <button class="topbar-button topbar-button--text" type="button" :disabled="!canSave" title="新建 (Ctrl/Cmd+N)" @click="emit('newDocument')">新建</button>
      <button class="topbar-button topbar-button--text" type="button" :disabled="!canSave" title="打开 (Ctrl/Cmd+O)" @click="emit('openDocument')">打开</button>
      <RecentProjectsMenu :projects="recentProjects" :disabled="!canSave" @open-project="emit('openRecentProject', $event)" />
      <button class="topbar-button topbar-button--text" type="button" :disabled="!canSave" title="保存 (Ctrl/Cmd+S)" @click="emit('save')">保存</button>
      <button class="topbar-button topbar-button--text" type="button" :disabled="!canSave" title="另存为 (Ctrl/Cmd+Shift+S)" @click="emit('saveAs')">另存为</button>
      <button v-if="canReturnToParent" class="topbar-button topbar-button--text" type="button" title="返回父电路" @click="emit('returnToParent')">返回父电路</button>
      <span class="engine-chip" :class="`engine-chip--${engineState}`" aria-live="polite"><span class="pulse-dot" aria-hidden="true"></span>{{ engineStateLabel }}</span>
      <button class="topbar-button" type="button" @click="emit('cycleTheme')" :title="themeLabel"><span class="ui-icon ui-icon--sun" aria-hidden="true">◐</span></button>
      <button class="topbar-button" type="button" :disabled="isBusy" @click="emit('checkEngine')" title="重新检查引擎"><span class="ui-icon" aria-hidden="true">↻</span></button>
      <button class="avatar-button" type="button" aria-label="账户菜单">CP</button>
    </div>
  </header>
</template>
