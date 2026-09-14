<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import {
  applyWheelViewport,
  isViewportPanPointer,
  panViewport,
  screenToWorld,
  type CanvasNode,
  type CanvasScene,
  type CanvasWire,
  type InteractionState,
  type ViewportState,
} from "../canvas";

const props = defineProps<{
  scene: CanvasScene;
  viewport: ViewportState;
  interaction: InteractionState;
}>();

const emit = defineEmits<{
  selectNode: [nodeId: string];
  selectConnection: [connectionId: string];
  viewportChange: [viewport: ViewportState];
  resize: [width: number, height: number];
  placementMove: [center: { x: number; y: number }, altKey: boolean];
  placeComponent: [center: { x: number; y: number }, altKey: boolean];
}>();

const canvasElement = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;
let spacePressed = false;
let panPointer: { pointerId: number; x: number; y: number } | null = null;

function signalClass(value: 0 | 1 | "X"): string {
  if (value === 1) return "signal-state--high";
  if (value === 0) return "signal-state--low";
  return "signal-state--unknown";
}

function wireClass(value: 0 | 1 | "X"): string {
  if (value === 1) return "signal-wire--live";
  if (value === "X") return "signal-wire--unknown";
  return "";
}

function pathFor(points: readonly { x: number; y: number }[]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function nodeStyle(node: CanvasNode): Record<string, string> {
  return { left: `${node.position.x}px`, top: `${node.position.y}px`, width: `${node.size.width}px`, height: `${node.size.height}px` };
}

function onNodeKeydown(event: KeyboardEvent, nodeId: string): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  emit("selectNode", nodeId);
}

function onConnectionKeydown(event: KeyboardEvent, connectionId: string): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  emit("selectConnection", connectionId);
}

function viewportStyle(): Record<string, string> {
  return { transform: `translate(${props.viewport.x}px, ${props.viewport.y}px) scale(${props.viewport.zoom})`, transformOrigin: "0 0" };
}

function gridStyle(): Record<string, string> {
  const spacing = 24 * props.viewport.zoom;
  return {
    backgroundSize: `${spacing}px ${spacing}px`,
    backgroundPosition: `${props.viewport.x}px ${props.viewport.y}px`,
  };
}

function pointerInCanvas(event: PointerEvent | WheelEvent): { x: number; y: number } {
  const rect = canvasElement.value?.getBoundingClientRect();
  return {
    x: event.clientX - (rect?.left ?? 0),
    y: event.clientY - (rect?.top ?? 0),
  };
}

function onWheel(event: WheelEvent): void {
  event.preventDefault();
  emit("viewportChange", applyWheelViewport(props.viewport, event, pointerInCanvas(event)));
}

function onPointerDown(event: PointerEvent): void {
  if (props.interaction.pendingPlacement && event.button === 0 && !spacePressed) {
    const point = screenToWorld(pointerInCanvas(event), props.viewport);
    emit("placeComponent", point, event.altKey);
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (!isViewportPanPointer(event.button, spacePressed)) return;
  panPointer = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  canvasElement.value?.setPointerCapture(event.pointerId);
  event.preventDefault();
  event.stopPropagation();
}

function onPointerMove(event: PointerEvent): void {
  if (props.interaction.pendingPlacement && !panPointer && !spacePressed) {
    emit("placementMove", screenToWorld(pointerInCanvas(event), props.viewport), event.altKey);
  }
  if (!panPointer || panPointer.pointerId !== event.pointerId) return;
  const delta = { x: event.clientX - panPointer.x, y: event.clientY - panPointer.y };
  panPointer = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  emit("viewportChange", panViewport(props.viewport, delta));
  event.preventDefault();
}

function onPointerUp(event: PointerEvent): void {
  if (!panPointer || panPointer.pointerId !== event.pointerId) return;
  if (canvasElement.value?.hasPointerCapture(event.pointerId)) canvasElement.value.releasePointerCapture(event.pointerId);
  panPointer = null;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === " ") {
    spacePressed = true;
    event.preventDefault();
  }
}

function onKeyup(event: KeyboardEvent): void {
  if (event.key === " ") spacePressed = false;
}

function reportResize(): void {
  const element = canvasElement.value;
  if (element) emit("resize", element.clientWidth, element.clientHeight);
}

onMounted(() => {
  reportResize();
  if (typeof ResizeObserver !== "undefined" && canvasElement.value) {
    resizeObserver = new ResizeObserver(reportResize);
    resizeObserver.observe(canvasElement.value);
  }
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("keyup", onKeyup);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("keyup", onKeyup);
});
</script>

<template>
  <div class="editor-canvas-wrap">
    <div class="canvas-info"><span class="canvas-mode"><span class="mode-dot" aria-hidden="true"></span>场景模式</span><span>Delete 删除 · Ctrl/Cmd+Z 撤销 · Esc 取消</span></div>
    <div ref="canvasElement" class="circuit-canvas" role="application" tabindex="0" aria-label="电路画布" @wheel="onWheel" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp">
      <div class="canvas-grid" :style="gridStyle()" aria-hidden="true"></div>
      <div class="canvas-viewport" :style="viewportStyle()">
        <svg class="signal-map" aria-label="电路连接">
          <template v-for="wire in scene.wires" :key="wire.id">
            <path class="signal-wire-hit" :d="pathFor(wire.route)" role="button" tabindex="0" :aria-label="`选择连线 ${wire.id}`" @click.stop="emit('selectConnection', wire.id)" @keydown="onConnectionKeydown($event, wire.id)" />
            <path class="signal-wire" :class="[wireClass(wire.signal), { 'signal-wire--dangling': wire.danglingEndpoints.length > 0, 'signal-wire--selected': wire.selected }]" :d="pathFor(wire.route)" />
            <circle v-if="wire.danglingEndpoints.includes('source')" class="dangling-endpoint" :cx="wire.source.point.x" :cy="wire.source.point.y" r="6" />
            <circle v-if="wire.danglingEndpoints.includes('target')" class="dangling-endpoint" :cx="wire.target.point.x" :cy="wire.target.point.y" r="6" />
          </template>
          <path v-if="interaction.connectionDraft" class="signal-wire signal-wire--draft" :d="pathFor(interaction.connectionDraft)" />
        </svg>
        <article v-for="node in scene.nodes" :key="node.id" class="circuit-node" :class="{ 'circuit-node--selected': node.selected, 'circuit-node--dragging': interaction.draggingNodeId === node.id }" :style="nodeStyle(node)" role="button" tabindex="0" :aria-label="`选择${node.displayName}`" @click="emit('selectNode', node.id)" @keydown="onNodeKeydown($event, node.id)">
          <span class="node-tag">{{ node.kind.toUpperCase() }} / {{ node.ports.length }}</span>
          <strong>{{ node.symbol }} <span class="node-display-name">{{ node.displayName }}</span></strong>
          <span class="node-description">{{ node.description }}</span>
          <span v-for="port in node.ports" :key="port.id" class="node-port" :class="[port.direction === 'input' ? 'node-port--left' : 'node-port--right', signalClass(port.signal)]" :style="{ top: `${port.offset.y}px` }">{{ port.name }} · {{ port.signal }}</span>
        </article>
        <article v-if="interaction.pendingPlacement" class="circuit-node circuit-node--pending" :style="{ left: `${interaction.pendingPlacement.position.x}px`, top: `${interaction.pendingPlacement.position.y}px`, width: `${interaction.pendingPlacement.size.width}px`, height: `${interaction.pendingPlacement.size.height}px` }" aria-hidden="true">
          <span class="node-tag">待放置</span><strong>{{ interaction.pendingPlacement.kind.toUpperCase() }}</strong><span class="node-description">单击画布放置 · Esc 取消</span>
        </article>
      </div>
      <div v-if="interaction.emptyState" class="canvas-empty-state"><span class="empty-orbit">＋</span><strong>{{ interaction.emptyState.title }}</strong><p>{{ interaction.emptyState.message }}</p></div>
      <div class="canvas-crosshair canvas-crosshair--tl" aria-hidden="true"></div><div class="canvas-crosshair canvas-crosshair--br" aria-hidden="true"></div>
    </div>
    <div class="canvas-legend"><span><i class="legend-line legend-line--live"></i>高电平 <b>1</b></span><span><i class="legend-line"></i>低电平 <b>0</b></span><span><i class="legend-line legend-line--unknown"></i>未知 <b>X</b></span><span><i class="legend-line legend-line--dangling"></i>悬空</span></div>
  </div>
</template>
