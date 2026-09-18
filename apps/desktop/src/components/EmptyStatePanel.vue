<script setup lang="ts">
import RecentProjectList from "./RecentProjectList.vue";
import type { RecentProject } from "../project-file/recent-projects";
import type { WorkspaceEngineState } from "../workspace";

/**
 * 首启空状态面板（#40）：工作区还没有任何文档时占据画布区，提供打开、新建、加载示例
 * 与最近项目入口。全部入口都是原生按钮（Tab 可达、Enter 激活），最近项目条目复用
 * `RecentProjectList`；置脏确认与加载路径都由工作区组合层处理。引擎不可用时启动同样
 * 停在这块面板：给出可展示的引擎信息与原地重试入口，入口不静默失效。
 */
defineProps<{
  /** 工作区引擎状态；非 ready 时显示引擎说明与重试入口。 */
  engineState: WorkspaceEngineState;
  /** 工作区当前的可展示消息（引擎检查中、不可用或失败的原因）。 */
  engineMessage: string;
  /** 最近项目列表，最近使用在前；为空时不渲染最近项目一节。 */
  recentProjects: readonly RecentProject[];
}>();

const emit = defineEmits<{
  /** 请求新建空文档。 */
  newDocument: [];
  /** 请求打开项目文件。 */
  openProject: [];
  /** 请求加载 AND 示例（普通文档推送路径）。 */
  loadExample: [];
  /** 从最近项目列表打开指定路径。 */
  openRecentProject: [path: string];
  /** 请求重新检查引擎；引擎不可用时用户从这里原地重试。 */
  checkEngine: [];
}>();
</script>

<template>
  <section class="empty-state" aria-labelledby="empty-state-title">
    <div class="empty-state__card">
      <span class="eyebrow">WORKSPACE</span>
      <h2 id="empty-state-title">还没有电路</h2>
      <p class="empty-state__lead">新建一个空文档、加载示例电路，或打开一份项目文件继续上次的工作。</p>
      <div class="empty-state__actions">
        <button type="button" class="dialog-button" @click="emit('openProject')">打开项目</button>
        <button type="button" class="dialog-button" @click="emit('newDocument')">新建文档</button>
        <button type="button" class="dialog-button empty-state__primary" title="加载示例电路" @click="emit('loadExample')">加载示例</button>
      </div>
      <div v-if="recentProjects.length > 0" class="empty-state__recent">
        <h3 class="empty-state__recent-title">最近项目</h3>
        <RecentProjectList :projects="recentProjects" @open-project="emit('openRecentProject', $event)" />
      </div>
      <p
        v-if="engineState !== 'ready'"
        class="empty-state__engine"
        :class="{ 'empty-state__engine--problem': engineState === 'unavailable' || engineState === 'error' }"
        role="status"
      >{{ engineMessage }}</p>
      <button v-if="engineState !== 'ready'" type="button" class="dialog-button empty-state__retry" @click="emit('checkEngine')">重新检查引擎</button>
    </div>
  </section>
</template>
