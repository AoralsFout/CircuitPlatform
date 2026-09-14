<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import ComponentMenu from "./ComponentMenu.vue";
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
import type { ComponentDefinition } from "../canvas";
import type { ComponentKindName } from "@circuit-platform/protocol";
import {
  positionComponentMenu,
} from "../editor/component-menu";

const props = defineProps<{
  scene: CanvasScene;
  viewport: ViewportState;
  interaction: InteractionState;
  componentDefinitions?: readonly ComponentDefinition[];
  recentComponentKinds?: readonly ComponentKindName[];
  addComponent?: (kind: ComponentKindName, center: { x: number; y: number }, altKey: boolean) => Promise<boolean>;
  rememberComponentKind?: (kind: ComponentKindName) => void;
}>();

const emit = defineEmits<{
  selectNode: [nodeId: string];
  selectConnection: [connectionId: string];
  viewportChange: [viewport: ViewportState];
  resize: [width: number, height: number];
  nodeDragStart: [payload: { nodeId: string; pointerWorld: { x: number; y: number } }];
  nodeDragMove: [payload: { pointerWorld: { x: number; y: number }; altKey: boolean }];
  nodeDragEnd: [];
  nodeDragCancel: [];
  routeEditStart: [payload: { connectionId: string; route: readonly { x: number; y: number }[]; target: { kind: "waypoint" | "segment"; index: number }; pointerWorld: { x: number; y: number } }];
  routeEditMove: [payload: { pointerWorld: { x: number; y: number }; altKey: boolean }];
  routeEditEnd: [];
  routeEditCancel: [];
  placementMove: [center: { x: number; y: number }, altKey: boolean];
  placeComponent: [center: { x: number; y: number }, altKey: boolean];
}>();

const canvasElement = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;
let spacePressed = false;
let panPointer: { pointerId: number; x: number; y: number } | null = null;
let nodeDragPointer: { pointerId: number; nodeId: string } | null = null;
let nodeDidMove = false;
let suppressNodeClick = false;
const componentMenu = ref<{
  position: { x: number; y: number };
  worldPoint: { x: number; y: number };
  altKey: boolean;
} | null>(null);
let routeEditPointer: { pointerId: number; connectionId: string; route: readonly { x: number; y: number }[]; target: { kind: "waypoint" | "segment"; index: number } } | null = null;

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

function segmentPath(points: readonly { x: number; y: number }[], index: number): string {
  const start = points[index];
  const end = points[index + 1];
  return start && end ? pathFor([start, end]) : "";
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

function pointerInCanvas(event: MouseEvent | PointerEvent | WheelEvent): { x: number; y: number } {
  const rect = canvasElement.value?.getBoundingClientRect();
  return {
    x: event.clientX - (rect?.left ?? 0),
    y: event.clientY - (rect?.top ?? 0),
  };
}

function pointerInWorld(event: PointerEvent): { x: number; y: number } {
  return screenToWorld(pointerInCanvas(event), props.viewport);
}

function closeComponentMenu(): void {
  componentMenu.value = null;
  void nextTick(() => canvasElement.value?.focus());
}

function openComponentMenu(anchor: { x: number; y: number }, altKey = false): void {
  if (props.interaction.connectionDraft || props.interaction.pendingPlacement || !props.componentDefinitions) return;
  componentMenu.value = {
    position: positionComponentMenu(anchor, { width: canvasElement.value?.clientWidth ?? 0, height: canvasElement.value?.clientHeight ?? 0 }),
    worldPoint: screenToWorld(anchor, props.viewport),
    altKey,
  };
}

async function selectComponentFromMenu(kind: ComponentKindName): Promise<void> {
  const menu = componentMenu.value;
  if (!menu) return;
  const succeeded = await props.addComponent?.(kind, menu.worldPoint, menu.altKey);
  if (succeeded) props.rememberComponentKind?.(kind);
  closeComponentMenu();
}

function onContextMenu(event: MouseEvent): void {
  event.preventDefault();
  const target = event.target instanceof Element ? event.target : null;
  // 对象右键菜单和布线状态由后续交互层处理；背景右键才打开添加元件菜单。
  if (target?.closest(".circuit-node, .signal-wire-hit, .component-menu")) return;
  const point = pointerInCanvas(event);
  openComponentMenu(point, event.altKey);
  canvasElement.value?.focus();
}

function onNodePointerDown(event: PointerEvent, node: CanvasNode): void {
  if (event.button !== 0 || spacePressed) return;
  nodeDragPointer = { pointerId: event.pointerId, nodeId: node.id };
  nodeDidMove = false;
  canvasElement.value?.setPointerCapture(event.pointerId);
  emit("nodeDragStart", { nodeId: node.id, pointerWorld: pointerInWorld(event) });
  event.preventDefault();
  event.stopPropagation();
}

function onRouteWaypointPointerDown(event: PointerEvent, wire: CanvasWire, pointIndex: number): void {
  if (event.button !== 0) return;
  routeEditPointer = { pointerId: event.pointerId, connectionId: wire.id, route: wire.route, target: { kind: "waypoint", index: pointIndex } };
  canvasElement.value?.setPointerCapture(event.pointerId);
  emit("routeEditStart", { connectionId: wire.id, route: wire.route, target: { kind: "waypoint", index: pointIndex }, pointerWorld: pointerInWorld(event) });
  event.preventDefault();
  event.stopPropagation();
}

function onRouteSegmentPointerDown(event: PointerEvent, wire: CanvasWire, segmentIndex: number): void {
  if (event.button !== 0 || !wire.selected) return;
  routeEditPointer = { pointerId: event.pointerId, connectionId: wire.id, route: wire.route, target: { kind: "segment", index: segmentIndex } };
  canvasElement.value?.setPointerCapture(event.pointerId);
  emit("routeEditStart", { connectionId: wire.id, route: wire.route, target: { kind: "segment", index: segmentIndex }, pointerWorld: pointerInWorld(event) });
  event.preventDefault();
  event.stopPropagation();
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
  if (routeEditPointer?.pointerId === event.pointerId) {
    emit("routeEditMove", { pointerWorld: pointerInWorld(event), altKey: event.altKey });
    event.preventDefault();
    return;
  }
  if (nodeDragPointer?.pointerId === event.pointerId) {
    nodeDidMove = true;
    emit("nodeDragMove", { pointerWorld: pointerInWorld(event), altKey: event.altKey });
    event.preventDefault();
    return;
  }
  if (props.interaction.pendingPlacement && !nodeDragPointer && !panPointer && !spacePressed) {
    emit("placementMove", screenToWorld(pointerInCanvas(event), props.viewport), event.altKey);
  }
  if (!panPointer || panPointer.pointerId !== event.pointerId) return;
  const delta = { x: event.clientX - panPointer.x, y: event.clientY - panPointer.y };
  panPointer = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  emit("viewportChange", panViewport(props.viewport, delta));
  event.preventDefault();
}

function onPointerUp(event: PointerEvent): void {
  if (routeEditPointer?.pointerId === event.pointerId) {
    if (canvasElement.value?.hasPointerCapture(event.pointerId)) canvasElement.value.releasePointerCapture(event.pointerId);
    if (event.type === "pointercancel") emit("routeEditCancel");
    else emit("routeEditEnd");
    routeEditPointer = null;
    event.preventDefault();
    return;
  }
  if (nodeDragPointer?.pointerId === event.pointerId) {
    if (canvasElement.value?.hasPointerCapture(event.pointerId)) canvasElement.value.releasePointerCapture(event.pointerId);
    if (event.type === "pointercancel") emit("nodeDragCancel");
    else emit("nodeDragEnd");
    nodeDragPointer = null;
    suppressNodeClick = event.type !== "pointercancel" && nodeDidMove;
    nodeDidMove = false;
    event.preventDefault();
    return;
  }
  if (!panPointer || panPointer.pointerId !== event.pointerId) return;
  if (canvasElement.value?.hasPointerCapture(event.pointerId)) canvasElement.value.releasePointerCapture(event.pointerId);
  panPointer = null;
}

function onNodeClick(nodeId: string): void {
  if (suppressNodeClick) {
    suppressNodeClick = false;
    return;
  }
  emit("selectNode", nodeId);
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

function onCanvasKeydown(event: KeyboardEvent): void {
  if ((event.key !== "F10" || !event.shiftKey) && event.key !== "ContextMenu") return;
  event.preventDefault();
  openComponentMenu({
    x: (canvasElement.value?.clientWidth ?? 0) / 2,
    y: (canvasElement.value?.clientHeight ?? 0) / 2,
  });
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
    <div ref="canvasElement" class="circuit-canvas" role="application" tabindex="0" aria-label="电路画布" @wheel="onWheel" @contextmenu="onContextMenu" @keydown="onCanvasKeydown" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp">
      <div class="canvas-grid" :style="gridStyle()" aria-hidden="true"></div>
      <div class="canvas-viewport" :style="viewportStyle()">
        <svg class="signal-map" aria-label="电路连接">
          <template v-for="wire in scene.wires" :key="wire.id">
            <path class="signal-wire-hit" :d="pathFor(wire.route)" role="button" tabindex="0" :aria-label="`选择连线 ${wire.id}`" @click.stop="emit('selectConnection', wire.id)" @keydown="onConnectionKeydown($event, wire.id)" />
            <template v-if="wire.selected" v-for="(_, segmentIndex) in wire.route.slice(0, -1)" :key="`${wire.id}-segment-${segmentIndex}`">
              <path class="route-segment-hit" :d="segmentPath(wire.route, segmentIndex)" :aria-label="`移动连线 ${wire.id} 线段 ${segmentIndex + 1}`" @pointerdown.stop="onRouteSegmentPointerDown($event, wire, segmentIndex)" />
            </template>
            <template v-if="wire.selected" v-for="(point, pointIndex) in wire.route.slice(1, -1)" :key="`${wire.id}-waypoint-${pointIndex}`">
              <circle class="route-waypoint-handle" :cx="point.x" :cy="point.y" r="7" role="button" tabindex="0" :aria-label="`编辑连线 ${wire.id} 折点 ${pointIndex + 1}`" @pointerdown.stop="onRouteWaypointPointerDown($event, wire, pointIndex + 1)" />
            </template>
            <path class="signal-wire" :class="[wireClass(wire.signal), { 'signal-wire--dangling': wire.danglingEndpoints.length > 0, 'signal-wire--selected': wire.selected }]" :d="pathFor(wire.route)" />
            <circle v-if="wire.danglingEndpoints.includes('source')" class="dangling-endpoint" :cx="wire.source.point.x" :cy="wire.source.point.y" r="6" />
            <circle v-if="wire.danglingEndpoints.includes('target')" class="dangling-endpoint" :cx="wire.target.point.x" :cy="wire.target.point.y" r="6" />
          </template>
          <path v-if="interaction.connectionDraft" class="signal-wire signal-wire--draft" :d="pathFor(interaction.connectionDraft)" />
        </svg>
        <article v-for="node in scene.nodes" :key="node.id" class="circuit-node" :class="{ 'circuit-node--selected': node.selected, 'circuit-node--dragging': interaction.draggingNodeId === node.id }" :style="nodeStyle(node)" role="button" tabindex="0" :aria-label="`选择${node.displayName}`" @pointerdown.stop="onNodePointerDown($event, node)" @click="onNodeClick(node.id)" @keydown="onNodeKeydown($event, node.id)">
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
      <ComponentMenu
        v-if="componentMenu && componentDefinitions"
        :style="{ left: `${componentMenu.position.x}px`, top: `${componentMenu.position.y}px` }"
        :definitions="componentDefinitions"
        :recent-kinds="recentComponentKinds ?? []"
        @select="selectComponentFromMenu"
        @close="closeComponentMenu"
      />
      <div class="canvas-crosshair canvas-crosshair--tl" aria-hidden="true"></div><div class="canvas-crosshair canvas-crosshair--br" aria-hidden="true"></div>
    </div>
    <div class="canvas-legend"><span><i class="legend-line legend-line--live"></i>高电平 <b>1</b></span><span><i class="legend-line"></i>低电平 <b>0</b></span><span><i class="legend-line legend-line--unknown"></i>未知 <b>X</b></span><span><i class="legend-line legend-line--dangling"></i>悬空</span></div>
  </div>
</template>
