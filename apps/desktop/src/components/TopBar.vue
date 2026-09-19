<script setup lang="ts">
import { computed } from "vue";
import RecentProjectsMenu from "./RecentProjectsMenu.vue";
import type { ProjectSaveState } from "../composables/useWorkspace";
import type { RecentProject } from "../project-file/recent-projects";
import type { WorkspaceEngineState } from "../workspace";

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
}>();

/** 保存指示器的可见文案；脏标记与失败都必须让用户「看到」，不能只留在标题里。 */
const saveStateLabels: Record<ProjectSaveState, string> = {
  saved: "已保存",
  dirty: "未保存",
  error: "保存失败",
};

const saveStateLabel = computed(() => saveStateLabels[props.saveState]);
</script>

<template>
  <header class="topbar">
    <div class="brand-lockup">
      <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
      <strong class="brand-name">CircuitPlatform</strong>
      <span class="topbar-divider" aria-hidden="true"></span>
      <span class="project-name">{{ projectName ?? "未命名电路" }}</span>
      <span class="save-state" :class="`save-state--${saveState}`" :title="saveError ?? undefined" aria-live="polite"><span class="save-dot" aria-hidden="true"></span>{{ saveStateLabel }}</span>
    </div>

    <div class="topbar-actions">
      <button class="topbar-button topbar-button--text" type="button" :disabled="!canSave" title="新建 (Ctrl/Cmd+N)" @click="emit('newDocument')">新建</button>
      <button class="topbar-button topbar-button--text" type="button" :disabled="!canSave" title="打开 (Ctrl/Cmd+O)" @click="emit('openDocument')">打开</button>
      <RecentProjectsMenu :projects="recentProjects" :disabled="!canSave" @open-project="emit('openRecentProject', $event)" />
      <button class="topbar-button topbar-button--text" type="button" :disabled="!canSave" title="保存 (Ctrl/Cmd+S)" @click="emit('save')">保存</button>
      <button class="topbar-button topbar-button--text" type="button" :disabled="!canSave" title="另存为 (Ctrl/Cmd+Shift+S)" @click="emit('saveAs')">另存为</button>
      <span class="engine-chip" :class="`engine-chip--${engineState}`" aria-live="polite"><span class="pulse-dot" aria-hidden="true"></span>{{ engineStateLabel }}</span>
      <button class="topbar-button" type="button" @click="emit('cycleTheme')" :title="themeLabel"><span class="ui-icon ui-icon--sun" aria-hidden="true">◐</span></button>
      <button class="topbar-button" type="button" :disabled="isBusy" @click="emit('checkEngine')" title="重新检查引擎"><span class="ui-icon" aria-hidden="true">↻</span></button>
      <button class="avatar-button" type="button" aria-label="账户菜单">CP</button>
    </div>
  </header>
</template>
