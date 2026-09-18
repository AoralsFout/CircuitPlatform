<script setup lang="ts">
import type { RecentProject } from "../project-file/recent-projects";

/**
 * 最近项目的条目列表：显示名 + 路径提示，条目是原生按钮（Tab 可达、Enter 激活）。
 * 顶栏下拉与首启空状态（#40）共用这一份条目渲染；菜单容器等外层语义由宿主提供。
 */
defineProps<{
  /** 最近项目列表，最近使用在前。 */
  projects: readonly RecentProject[];
  /** 条目的 ARIA 角色；菜单宿主传 `"menuitem"`，非菜单宿主省略后走原生按钮语义。 */
  itemRole?: string;
}>();

const emit = defineEmits<{
  /** 请求打开指定路径的项目；确认与加载路径由宿主决定。 */
  openProject: [path: string];
}>();
</script>

<template>
  <button
    v-for="project in projects"
    :key="project.path"
    class="recent-projects-item"
    type="button"
    :role="itemRole"
    :title="project.path"
    @click="emit('openProject', project.path)"
  >
    <span class="recent-projects-name">{{ project.displayName }}</span>
    <span class="recent-projects-path">{{ project.path }}</span>
  </button>
</template>
