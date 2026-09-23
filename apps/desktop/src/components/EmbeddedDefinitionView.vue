<script setup lang="ts">
import { computed } from "vue";
import type { EmbeddedDefinitionSnapshot } from "../composables/useWorkspace.ts";
import type { ProjectFileComponent } from "../project-file/index.ts";
import { canvasSubcircuitName } from "../project-file/library.ts";

const props = defineProps<{ definition: EmbeddedDefinitionSnapshot & { missing: boolean } }>();
const emit = defineEmits<{ openDefinition: [definitionId: string] }>();

const NODE_WIDTH = 120;
const NODE_HEIGHT = 66;
const components = computed(() => props.definition.circuit.components);
const componentById = computed(() => new Map(components.value.map((component) => [component.id, component])));
const connections = computed(() => props.definition.circuit.connections.map((connection) => {
  const source = componentById.value.get(connection.source.component);
  const target = componentById.value.get(connection.target.component);
  if (!source || !target) return null;
  const points = [
    { x: source.position.x + NODE_WIDTH / 2, y: source.position.y },
    ...(connection.waypoints ?? []),
    { x: target.position.x - NODE_WIDTH / 2, y: target.position.y },
  ];
  return { id: connection.id, source: connection.source.port, target: connection.target.port, points: points.map((point) => `${point.x},${point.y}`).join(" ") };
}).filter((connection) => connection !== null));
const viewBox = computed(() => {
  const points = components.value.flatMap((component) => [
    { x: component.position.x - NODE_WIDTH / 2, y: component.position.y - NODE_HEIGHT / 2 },
    { x: component.position.x + NODE_WIDTH / 2, y: component.position.y + NODE_HEIGHT / 2 },
  ]);
  for (const connection of props.definition.circuit.connections) points.push(...connection.waypoints ?? []);
  if (points.length === 0) return "-200 -120 400 240";
  const left = Math.min(...points.map((point) => point.x)) - 60;
  const top = Math.min(...points.map((point) => point.y)) - 60;
  const right = Math.max(...points.map((point) => point.x)) + 60;
  const bottom = Math.max(...points.map((point) => point.y)) + 60;
  return `${left} ${top} ${Math.max(400, right - left)} ${Math.max(240, bottom - top)}`;
});

function nestedDefinitionId(component: ProjectFileComponent): string | null {
  return component.kind === "subcircuit" && component.data && "definitionId" in component.data
    ? component.data.definitionId : null;
}

function openNested(definitionId: string | null): void {
  if (definitionId !== null) emit("openDefinition", definitionId);
}
</script>

<template>
  <section class="embedded-definition-view" :aria-label="`只读子电路 ${definition.displayName}`">
    <header class="embedded-definition-view__header">
      <div><strong>{{ definition.displayName }}</strong><p>父工程内保存的定义 · 只读结构 · 无独立仿真状态</p></div>
      <span class="embedded-definition-view__badge">只读</span>
    </header>
    <div v-if="definition.missing" class="embedded-definition-view__missing" role="status">定义已删除。撤销删除后，此标签会恢复原有内容。</div>
    <template v-else>
      <div class="embedded-definition-view__canvas">
        <svg :viewBox="viewBox" preserveAspectRatio="xMidYMid meet" role="img" :aria-label="`${definition.displayName} 的保存布局，${components.length} 个元件、${connections.length} 条连线`">
          <polyline v-for="connection in connections" :key="connection.id" :points="connection.points" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
          <g v-for="component in components" :key="component.id" :transform="`translate(${component.position.x}, ${component.position.y})`">
            <rect :x="-NODE_WIDTH / 2" :y="-NODE_HEIGHT / 2" :width="NODE_WIDTH" :height="NODE_HEIGHT" rx="8" />
            <text class="embedded-definition-view__kind" text-anchor="middle" y="-5">{{ component.kind.toUpperCase() }}</text>
            <text class="embedded-definition-view__name" text-anchor="middle" y="16">{{ component.kind === 'subcircuit' ? canvasSubcircuitName(component.displayName) : component.displayName }}</text>
          </g>
        </svg>
      </div>
      <p v-if="components.length === 0" class="embedded-definition-view__empty">这个定义没有元件。</p>
      <div class="embedded-definition-view__contents" aria-label="保存的电路内容">
        <span>{{ components.length }} 个元件 · {{ connections.length }} 条连线</span>
        <div v-for="component in components" :key="component.id" class="embedded-definition-view__item">
          <span>{{ component.displayName }} · {{ component.kind.toUpperCase() }} <small>({{ component.position.x }}, {{ component.position.y }})</small></span>
          <button v-if="nestedDefinitionId(component)" type="button" :aria-label="`查看内嵌子电路 ${component.displayName}`" @click="openNested(nestedDefinitionId(component))">查看定义</button>
        </div>
      </div>
    </template>
  </section>
</template>
