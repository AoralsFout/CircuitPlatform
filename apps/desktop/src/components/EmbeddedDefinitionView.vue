<script setup lang="ts">
import { computed } from "vue";
import type { PortSpec } from "@circuit-platform/protocol";
import type { EmbeddedDefinitionSnapshot } from "../composables/useWorkspace.ts";
import type { ProjectFileComponent, ProjectFileConnection } from "../project-file/index.ts";
import { canvasSubcircuitName } from "../project-file/library.ts";

const props = defineProps<{ definition: EmbeddedDefinitionSnapshot & { missing: boolean }; canOpenDefinition: (definitionId: string) => boolean }>();
const emit = defineEmits<{ openDefinition: [definitionId: string] }>();
const NODE_WIDTH = 120;
const NODE_HEIGHT = 66;
const PORT_PITCH = 20;

interface DisplayPort extends PortSpec {
  order: number;
  inferred: boolean;
  x: number;
  y: number;
}

const components = computed(() => props.definition.circuit.components);
const savedConnections = computed(() => props.definition.circuit.connections);

function nestedDefinitionId(component: ProjectFileComponent): string | null {
  return component.kind === "subcircuit" && component.data && "definitionId" in component.data
    ? component.data.definitionId : null;
}

function savedInputValue(component: ProjectFileComponent): string | null {
  return component.kind === "input" && component.data && "value" in component.data
    ? component.data.value ?? null : null;
}

// v2 内置元件不保存完整 Port 清单；连线端点能证明的 Port 仍按出现顺序展示。
function portsForView(component: ProjectFileComponent, connections: readonly ProjectFileConnection[]): readonly DisplayPort[] {
  const data = component.data && "definitionId" in component.data ? component.data : null;
  const saved = data?.cachedPorts ?? component.ports ?? [];
  const order = data?.portOrder;
  const ordered = order
    ? [...order.flatMap((name) => saved.filter((port) => port.name === name)), ...saved.filter((port) => !order.includes(port.name))]
    : [...saved];
  const seen = new Set(ordered.map((port) => `${port.direction}:${port.name}`));
  const inferred: PortSpec[] = [];
  for (const connection of connections) {
    for (const [endpoint, direction] of [[connection.source, "output"], [connection.target, "input"]] as const) {
      const key = `${direction}:${endpoint.port}`;
      if (endpoint.component !== component.id || seen.has(key)) continue;
      inferred.push({ name: endpoint.port, direction, width: 1 });
      seen.add(key);
    }
  }
  const ports = [...ordered.map((port) => ({ ...port, inferred: false })), ...inferred.map((port) => ({ ...port, inferred: true }))];
  return ports.map((port, index) => {
    const side = ports.filter((item) => item.direction === port.direction);
    const sideIndex = side.indexOf(port);
    return { ...port, order: index + 1, x: port.direction === "input" ? -NODE_WIDTH / 2 : NODE_WIDTH / 2,
      y: (sideIndex - (side.length - 1) / 2) * PORT_PITCH };
  });
}

const nodes = computed(() => components.value.map((component) => {
  const ports = portsForView(component, savedConnections.value);
  return { component, ports, height: Math.max(NODE_HEIGHT, 24 + Math.max(
    ports.filter((port) => port.direction === "input").length,
    ports.filter((port) => port.direction === "output").length,
  ) * PORT_PITCH), inputValue: savedInputValue(component) };
}));
const nodeById = computed(() => new Map(nodes.value.map((node) => [node.component.id, node])));

const connections = computed(() => savedConnections.value.map((connection) => {
  const source = nodeById.value.get(connection.source.component);
  const target = nodeById.value.get(connection.target.component);
  if (!source || !target) return null;
  const sourcePort = source.ports.find((port) => port.name === connection.source.port && port.direction === "output");
  const targetPort = target.ports.find((port) => port.name === connection.target.port && port.direction === "input");
  const points = [
    { x: source.component.position.x + (sourcePort?.x ?? NODE_WIDTH / 2), y: source.component.position.y + (sourcePort?.y ?? 0) },
    ...(connection.waypoints ?? []),
    { x: target.component.position.x + (targetPort?.x ?? -NODE_WIDTH / 2), y: target.component.position.y + (targetPort?.y ?? 0) },
  ];
  const label = `${connection.source.component}.${connection.source.port} → ${connection.target.component}.${connection.target.port}`;
  return { id: connection.id, label, points: points.map((point) => `${point.x},${point.y}`).join(" ") };
}).filter((connection) => connection !== null));

const viewBox = computed(() => {
  const points = nodes.value.flatMap((node) => [
    { x: node.component.position.x - NODE_WIDTH / 2, y: node.component.position.y - node.height / 2 },
    { x: node.component.position.x + NODE_WIDTH / 2, y: node.component.position.y + node.height / 2 },
  ]);
  for (const connection of savedConnections.value) points.push(...connection.waypoints ?? []);
  if (points.length === 0) return "-200 -120 400 240";
  const left = Math.min(...points.map((point) => point.x)) - 110;
  const top = Math.min(...points.map((point) => point.y)) - 60;
  const right = Math.max(...points.map((point) => point.x)) + 110;
  const bottom = Math.max(...points.map((point) => point.y)) + 60;
  return `${left} ${top} ${Math.max(400, right - left)} ${Math.max(240, bottom - top)}`;
});

function openNested(definitionId: string | null): void {
  if (definitionId !== null && props.canOpenDefinition(definitionId)) emit("openDefinition", definitionId);
}
</script>

<template>
  <section class="embedded-definition-view" :aria-label="`只读子电路 ${definition.displayName}`">
    <header class="embedded-definition-view__header">
      <div><strong>{{ definition.displayName }}</strong><p>父工程内保存的定义 · 只读结构 · 无独立仿真状态</p><p>内置元件未保存的空闲端口不列出；从连线得知的端口位宽未知。</p></div>
      <span class="embedded-definition-view__badge">只读</span>
    </header>
    <div v-if="definition.missing" class="embedded-definition-view__missing" role="status">定义已删除。撤销删除后，此标签会恢复原有内容。</div>
    <template v-else>
      <div class="embedded-definition-view__canvas">
        <svg :viewBox="viewBox" preserveAspectRatio="xMidYMid meet" role="img" :aria-label="`${definition.displayName} 的保存布局，${components.length} 个元件、${connections.length} 条连线`">
          <polyline v-for="connection in connections" :key="connection.id" :points="connection.points" :aria-label="`连接 ${connection.id}：${connection.label}`" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
          <g v-for="node in nodes" :key="node.component.id" :transform="`translate(${node.component.position.x}, ${node.component.position.y})`">
            <rect :x="-NODE_WIDTH / 2" :y="-node.height / 2" :width="NODE_WIDTH" :height="node.height" rx="8" />
            <text class="embedded-definition-view__kind" text-anchor="middle" y="-13">{{ node.component.kind.toUpperCase() }}</text>
            <text class="embedded-definition-view__name" text-anchor="middle" y="4">{{ node.component.kind === 'subcircuit' ? canvasSubcircuitName(node.component.displayName) : node.component.displayName }}</text>
            <text v-if="node.inputValue !== null" class="embedded-definition-view__value" text-anchor="middle" y="21">值 {{ node.inputValue }}</text>
            <g v-for="port in node.ports" :key="`${port.direction}:${port.name}`" class="embedded-definition-view__port" :data-port="`${node.component.id}.${port.name}`" :data-direction="port.direction">
              <circle :cx="port.x" :cy="port.y" r="4" />
              <text :x="port.x + (port.direction === 'input' ? -7 : 7)" :y="port.y + 3" :text-anchor="port.direction === 'input' ? 'end' : 'start'">{{ port.order }} {{ port.name }}{{ port.width > 1 ? `[${port.width - 1}:0]` : '' }}</text>
            </g>
          </g>
        </svg>
      </div>
      <p v-if="components.length === 0" class="embedded-definition-view__empty">这个定义没有元件。</p>
      <div class="embedded-definition-view__contents" aria-label="保存的电路内容">
        <span>{{ components.length }} 个元件 · {{ connections.length }} 条连线</span>
        <div v-for="node in nodes" :key="node.component.id" class="embedded-definition-view__item">
          <span>{{ node.component.displayName }} · {{ node.component.kind.toUpperCase() }} <small>({{ node.component.position.x }}, {{ node.component.position.y }})</small><template v-if="node.inputValue !== null"> · 保存值 {{ node.inputValue }}</template></span>
          <ol v-if="node.ports.length" class="embedded-definition-view__ports" :aria-label="`${node.component.displayName} 的端口顺序`">
            <li v-for="port in node.ports" :key="`${port.direction}:${port.name}`">{{ port.direction === 'input' ? '输入' : '输出' }} {{ port.name }}{{ port.width > 1 && !port.inferred ? `[${port.width - 1}:0]` : '' }}{{ port.inferred ? '（由连接端点得知，位宽未知）' : '' }}</li>
          </ol>
          <button v-if="nestedDefinitionId(node.component)" type="button" :disabled="!canOpenDefinition(nestedDefinitionId(node.component)!)" :aria-label="canOpenDefinition(nestedDefinitionId(node.component)!) ? `查看内嵌子电路 ${node.component.displayName}` : `${node.component.displayName}，定义已删除，无法查看`" @click="openNested(nestedDefinitionId(node.component))">{{ canOpenDefinition(nestedDefinitionId(node.component)!) ? '查看定义' : '定义已删除' }}</button>
        </div>
        <ol v-if="connections.length" class="embedded-definition-view__connections" aria-label="保存的连接端点">
          <li v-for="connection in connections" :key="connection.id">{{ connection.id }}：{{ connection.label }}</li>
        </ol>
      </div>
    </template>
  </section>
</template>
