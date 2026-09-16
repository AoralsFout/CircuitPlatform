<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import ComponentMenu from "./ComponentMenu.vue";
import {
  applyWheelViewport,
  createFrameCoalescer,
  isViewportPanPointer,
  panViewport,
  screenToWorld,
  hitTestCanvas,
  isDenseCanvasScene,
  type CanvasNode,
  type CanvasScene,
  type CanvasWire,
  type InteractionState,
  type ViewportState,
} from "../canvas";
import type { ComponentDefinition } from "../canvas";
import type { ComponentKindName } from "@circuit-platform/protocol";
import { isConnectionDraftTarget, resolveConnectionPortPointerAction, type ConnectionDraftPort } from "../editor/connection-draft.ts";
import type { Point } from "../editor";
import { resolveCanvasKeyboardAction, isEditableKeyboardTarget } from "../editor/keyboard.ts";
import {
  positionComponentMenu,
} from "../editor/component-menu";
import { contextActionsFor, type ContextAction, type ContextActionId } from "../editor/context-menu";
import type { CanvasHitTarget } from "../canvas/hit-testing";
import { DEFAULT_WIRE_COLOR, WIRE_COLOR_PRESETS, isWireColorId, type WireColorId } from "../editor";

export interface CanvasController {
  componentDefinitions: readonly ComponentDefinition[];
  recentComponentKinds: readonly ComponentKindName[];
  addComponent: (kind: ComponentKindName, center: Point, altKey: boolean, continuous?: boolean) => Promise<boolean>;
  rememberComponentKind: (kind: ComponentKindName) => void;
  duplicateComponent: (componentId: string) => Promise<boolean>;
  deleteComponent: (componentId: string) => Promise<void>;
  resetRoute: (connectionId: string) => Promise<void>;
  setWireColor: (connectionId: string, color: WireColorId) => Promise<void>;
  deleteWaypoint: (connectionId: string, pointIndex: number) => Promise<void>;
  deleteConnection: (connectionId: string) => Promise<void>;
}

const props = defineProps<{
  scene: CanvasScene;
  viewport: ViewportState;
  interaction: InteractionState;
  controller: CanvasController;
}>();

const emit = defineEmits<{
  selectComponent: [componentId: string];
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
  placementMove: [center: Point, altKey: boolean];
  placeComponent: [center: Point, altKey: boolean];
  retryPlacement: [];
  cancelPlacement: [];
  connectionStart: [port: ConnectionDraftPort];
  connectionMove: [payload: { point: Point; altKey: boolean }];
  connectionWaypoint: [payload: { point: Point; altKey: boolean }];
  connectionEnd: [port: ConnectionDraftPort];
  connectionAxisToggle: [];
  connectionWaypointRemove: [];
  connectionWaypointRemoveOrCancel: [];
  connectionCancel: [];
  focusChange: [id: string | null];
  clearSelection: [];
}>();

const canvasElement = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;
let spacePressed = false;
let panPointer: { pointerId: number; x: number; y: number } | null = null;
const isPanning = ref(false);
const panMoveCoalescer = createFrameCoalescer<{ pointerId: number; x: number; y: number }>((next) => {
  if (!panPointer || panPointer.pointerId !== next.pointerId) return;
  const delta = { x: next.x - panPointer.x, y: next.y - panPointer.y };
  panPointer = { pointerId: next.pointerId, x: next.x, y: next.y };
  emit("viewportChange", panViewport(props.viewport, delta));
});
let nodeDragPointer: { pointerId: number; nodeId: string } | null = null;
let nodeDidMove = false;
let suppressNodeClick = false;
const componentMenu = ref<{
  position: { x: number; y: number };
  worldPoint: { x: number; y: number };
  altKey: boolean;
} | null>(null);
const objectMenu = ref<{
  position: { x: number; y: number };
  target: Exclude<CanvasHitTarget, { kind: "background" | "port" }>;
  actions: readonly ContextAction[];
} | null>(null);
let routeEditPointer: { pointerId: number; connectionId: string; route: readonly { x: number; y: number }[]; target: { kind: "waypoint" | "segment"; index: number } } | null = null;
let connectionPointer: { pointerId: number; ended: boolean } | null = null;
let connectionDraftOrigin: ConnectionDraftPort | null = null;
let allowSameDirectionDraftTarget = false;
const hoveredConnectionTarget = ref<string | null>(null);
let lastPointerAnchor: { x: number; y: number } | null = null;

function keyboardMenuAnchor(target: EventTarget | null): { x: number; y: number } {
  const element = target instanceof Element ? target : null;
  const rect = element?.getBoundingClientRect();
  const canvasRect = canvasElement.value?.getBoundingClientRect();
  if (rect && canvasRect) return { x: rect.left - canvasRect.left + rect.width / 2, y: rect.top - canvasRect.top + rect.height / 2 };
  return lastPointerAnchor ?? { x: (canvasElement.value?.clientWidth ?? 0) / 2, y: (canvasElement.value?.clientHeight ?? 0) / 2 };
}

function signalClass(value: 0 | 1 | "X"): string {
  if (value === 1) return "signal-state--high";
  if (value === 0) return "signal-state--low";
  return "signal-state--unknown";
}

function wireColorClass(color: WireColorId | undefined): string {
  return `wire-color--${isWireColorId(color) ? color : DEFAULT_WIRE_COLOR}`;
}

function wirePathId(wireId: string): string {
  return `wire-path-${wireId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function objectMenuWireId(): string | null {
  const target = objectMenu.value?.target;
  return target && (target.kind === "wire" || target.kind === "wire-handle") ? target.connectionId : null;
}

function objectMenuWireColor(): WireColorId {
  const connectionId = objectMenuWireId();
  return props.scene.wires.find((wire) => wire.id === connectionId)?.color ?? DEFAULT_WIRE_COLOR;
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

function focusByOffset(delta: number): void {
  const targets = [...(canvasElement.value?.querySelectorAll<HTMLElement>("[data-canvas-focus]") ?? [])];
  if (targets.length === 0) return;
  const current = targets.indexOf(document.activeElement as HTMLElement);
  const next = (current < 0 ? (delta > 0 ? -1 : 0) : current) + delta;
  const element = targets[(next + targets.length) % targets.length];
  if (!element) return;
  element.focus();
  emit("focusChange", element.dataset.focusId ?? null);
}

/** 按空间方向在节点、Wire 和 Port 之间移动焦点，避免把选择状态当作焦点状态。 */
function focusByDirection(dx: number, dy: number): void {
  const targets = [...(canvasElement.value?.querySelectorAll<HTMLElement>("[data-canvas-focus]") ?? [])];
  const current = document.activeElement as HTMLElement | null;
  if (!current || !targets.includes(current)) {
    focusByOffset(dx || dy || 1);
    return;
  }
  const currentRect = current.getBoundingClientRect();
  const currentCenter = { x: currentRect.left + currentRect.width / 2, y: currentRect.top + currentRect.height / 2 };
  const candidates = targets
    .filter((element) => element !== current)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const offset = { x: center.x - currentCenter.x, y: center.y - currentCenter.y };
      const primary = dx !== 0 ? offset.x * dx : offset.y * dy;
      const secondary = dx !== 0 ? Math.abs(offset.y) : Math.abs(offset.x);
      return { element, score: primary > 0 ? primary * 10 + secondary : Number.POSITIVE_INFINITY };
    })
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((left, right) => left.score - right.score);
  const next = candidates[0]?.element;
  if (!next) return;
  next.focus();
  emit("focusChange", next.dataset.focusId ?? null);
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

function connectionPort(node: CanvasNode, port: CanvasNode["ports"][number]): ConnectionDraftPort {
  return {
    componentId: node.id,
    port: port.id,
    direction: port.direction,
    point: { ...port.point },
    outward: port.direction === "output" ? "right" : "left",
  };
}

function portAtWorld(point: { x: number; y: number }): ConnectionDraftPort | null {
  const radius = 12 / Math.max(props.viewport.zoom, 0.01);
  for (const node of props.scene.nodes) {
    for (const port of node.ports) {
      if (Math.hypot(port.point.x - point.x, port.point.y - point.y) <= radius) return connectionPort(node, port);
    }
  }
  return null;
}

function portKey(port: Pick<ConnectionDraftPort, "componentId" | "port">): string {
  return `${port.componentId}:${port.port}`;
}

/** 更新当前合法目标 Port 的悬浮反馈；非法或离开的目标立即清除。 */
function updateConnectionTargetHover(point: Point): void {
  const target = portAtWorld(point);
  hoveredConnectionTarget.value = isConnectionDraftTarget(connectionDraftOrigin, target, allowSameDirectionDraftTarget) && target
    ? portKey(target)
    : null;
}

function isHoveredConnectionTarget(nodeId: string, portId: string): boolean {
  return hoveredConnectionTarget.value === `${nodeId}:${portId}`;
}

function closeComponentMenu(): void {
  componentMenu.value = null;
  void nextTick(() => canvasElement.value?.focus());
}

function closeObjectMenu(): void {
  objectMenu.value = null;
  void nextTick(() => canvasElement.value?.focus());
}

function focusObjectMenuFirst(): void {
  void nextTick(() => canvasElement.value?.querySelector<HTMLButtonElement>(".object-context-menu button")?.focus());
}

function onObjectMenuKeydown(event: KeyboardEvent): void {
  const menu = canvasElement.value?.querySelector<HTMLElement>(".object-context-menu");
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeObjectMenu();
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Tab") return;
  const buttons = [...(menu?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
  if (buttons.length === 0) return;
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const delta = event.key === "ArrowUp" || event.shiftKey ? -1 : 1;
  const next = buttons[(Math.max(0, current) + delta + buttons.length) % buttons.length];
  next?.focus();
  event.preventDefault();
  event.stopPropagation();
}

/** 执行 Component/Wire 的最小右键动作集合；Route 编辑本身仍由画布手柄完成。 */
async function selectObjectAction(action: ContextActionId): Promise<void> {
  const menu = objectMenu.value;
  if (!menu) return;
  const target = menu.target;
  closeObjectMenu();
  if (target.kind === "component") {
    if (action === "copy-component") await props.controller.duplicateComponent(target.nodeId);
    else if (action === "delete-component") await props.controller.deleteComponent(target.nodeId);
    return;
  }
  if (action === "delete-waypoint" && target.kind === "wire-handle" && target.handle === "waypoint") {
    await props.controller.deleteWaypoint(target.connectionId, target.index);
  } else if (action === "edit-route") {
    emit("selectConnection", target.connectionId);
  } else if (action === "reset-route") {
    await props.controller.resetRoute(target.connectionId);
  } else if (action === "delete-connection") {
    await props.controller.deleteConnection(target.connectionId);
  }
}

/** 从对象菜单修改单条 Wire 颜色，并把变更提交到编辑器撤销历史。 */
async function selectWireColor(color: WireColorId): Promise<void> {
  const connectionId = objectMenuWireId();
  if (!connectionId) return;
  closeObjectMenu();
  await props.controller.setWireColor(connectionId, color);
}

function openComponentMenu(anchor: { x: number; y: number }, altKey = false): void {
  if (props.interaction.connectionDraft || props.interaction.pendingPlacement) return;
  componentMenu.value = {
    position: positionComponentMenu(anchor, { width: canvasElement.value?.clientWidth ?? 0, height: canvasElement.value?.clientHeight ?? 0 }),
    worldPoint: screenToWorld(anchor, props.viewport),
    altKey,
  };
}

async function selectComponentFromMenu(kind: ComponentKindName): Promise<void> {
  const menu = componentMenu.value;
  if (!menu) return;
  // 布线草稿优先级更高；菜单可能在草稿开始前已打开，提交前再次检查避免并发添加。
  if (props.interaction.connectionDraft) {
    closeComponentMenu();
    return;
  }
  const succeeded = await props.controller.addComponent(kind, menu.worldPoint, menu.altKey);
  if (succeeded) props.controller.rememberComponentKind(kind);
  closeComponentMenu();
}

function dragKind(event: DragEvent): ComponentKindName | null {
  const raw = event.dataTransfer?.getData("application/x-circuit-component") || event.dataTransfer?.getData("text/plain");
  if (!raw) return null;
  return props.controller.componentDefinitions.find((definition) => definition.kind === raw && definition.available)?.kind ?? null;
}

function onDragOver(event: DragEvent): void {
  const types = event.dataTransfer?.types ?? [];
  if (!types.includes("application/x-circuit-component") && !types.includes("text/plain")) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

/** 将元件库拖放释放点转换为 WorldPoint，并提交统一添加事务。 */
async function onDrop(event: DragEvent): Promise<void> {
  // 拖放事件可能在菜单打开后才到达；连接草稿期间不能启动另一种结构意图。
  if (props.interaction.connectionDraft) return;
  const kind = dragKind(event);
  if (!kind) return;
  event.preventDefault();
  const center = screenToWorld(pointerInCanvas(event), props.viewport);
  const succeeded = await props.controller.addComponent(kind, center, event.altKey, event.shiftKey);
  if (succeeded) props.controller.rememberComponentKind(kind);
}

function onContextMenu(event: MouseEvent): void {
  event.preventDefault();
  if (props.interaction.connectionDraft) {
    objectMenu.value = null;
    componentMenu.value = null;
    emit("connectionWaypointRemoveOrCancel");
    canvasElement.value?.focus();
    return;
  }
  if (props.interaction.pendingPlacement) {
    objectMenu.value = null;
    return;
  }
  const point = pointerInCanvas(event);
  const worldPoint = screenToWorld(point, props.viewport);
  const hit = hitTestCanvas(props.scene, worldPoint, { zoom: props.viewport.zoom });
  objectMenu.value = null;
  const objectHit = hit;
  if (objectHit.kind === "component" || objectHit.kind === "wire") {
    if (objectHit.kind === "component") emit("selectComponent", objectHit.nodeId);
    else emit("selectConnection", objectHit.connectionId);
    objectMenu.value = {
      position: point,
      target: objectHit,
      actions: contextActionsFor(objectHit),
    };
    canvasElement.value?.focus();
    focusObjectMenuFirst();
    return;
  }
  if (objectHit.kind === "wire-handle") {
    emit("selectConnection", objectHit.connectionId);
    objectMenu.value = {
      position: point,
      target: objectHit,
      actions: contextActionsFor(objectHit),
    };
    canvasElement.value?.focus();
    focusObjectMenuFirst();
    return;
  }
  if (hit.kind === "port") {
    emit("selectComponent", hit.nodeId);
    canvasElement.value?.focus();
    return;
  }
  // 只有统一命中结果为背景时才打开添加元件菜单。
  openComponentMenu(point, event.altKey);
  canvasElement.value?.focus();
}

function onNodePointerDown(event: PointerEvent, node: CanvasNode): void {
  if (event.button !== 0 || spacePressed || props.interaction.connectionDraft) {
    if (props.interaction.connectionDraft && event.button === 0) {
      event.preventDefault();
      event.stopPropagation();
    }
    return;
  }
  nodeDragPointer = { pointerId: event.pointerId, nodeId: node.id };
  nodeDidMove = false;
  canvasElement.value?.setPointerCapture(event.pointerId);
  emit("nodeDragStart", { nodeId: node.id, pointerWorld: pointerInWorld(event) });
  event.preventDefault();
  event.stopPropagation();
}

function onRouteWaypointPointerDown(event: PointerEvent, wire: CanvasWire, pointIndex: number): void {
  if (event.button !== 0 || props.interaction.connectionDraft) return;
  routeEditPointer = { pointerId: event.pointerId, connectionId: wire.id, route: wire.route, target: { kind: "waypoint", index: pointIndex } };
  canvasElement.value?.setPointerCapture(event.pointerId);
  emit("routeEditStart", { connectionId: wire.id, route: wire.route, target: { kind: "waypoint", index: pointIndex }, pointerWorld: pointerInWorld(event) });
  event.preventDefault();
  event.stopPropagation();
}

function onRouteSegmentPointerDown(event: PointerEvent, wire: CanvasWire, segmentIndex: number): void {
  if (event.button !== 0 || !wire.selected || props.interaction.connectionDraft) return;
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
  lastPointerAnchor = pointerInCanvas(event);
  if (props.interaction.connectionDraft && event.button === 0 && !spacePressed) {
    emit("connectionWaypoint", { point: pointerInWorld(event), altKey: event.altKey });
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (props.interaction.pendingPlacement && event.button === 0 && !spacePressed) {
    const point = screenToWorld(pointerInCanvas(event), props.viewport);
    emit("placeComponent", point, event.altKey);
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const hit = event.button === 0 && !spacePressed
    ? hitTestCanvas(props.scene, pointerInWorld(event), { zoom: props.viewport.zoom })
    : null;
  if (hit?.kind === "background") {
    objectMenu.value = null;
    componentMenu.value = null;
    emit("clearSelection");
    // 选择与键盘焦点是两套独立状态；空白点击必须同时结束 Wire 的焦点反馈。
    emit("focusChange", null);
    canvasElement.value?.focus();
  }
  if (!isViewportPanPointer(event.button, spacePressed, hit?.kind === "background")) return;
  panPointer = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  isPanning.value = true;
  canvasElement.value?.setPointerCapture(event.pointerId);
  event.preventDefault();
  event.stopPropagation();
}

function onPointerMove(event: PointerEvent): void {
  lastPointerAnchor = pointerInCanvas(event);
  if (connectionPointer?.pointerId === event.pointerId) {
    const point = pointerInWorld(event);
    emit("connectionMove", { point, altKey: event.altKey });
    updateConnectionTargetHover(point);
    event.preventDefault();
    return;
  }
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
  if (props.interaction.connectionDraft && !nodeDragPointer && !routeEditPointer && !panPointer && !spacePressed) {
    const point = pointerInWorld(event);
    emit("connectionMove", { point, altKey: event.altKey });
    updateConnectionTargetHover(point);
  }
  if (!panPointer || panPointer.pointerId !== event.pointerId) return;
  panMoveCoalescer.schedule({ pointerId: event.pointerId, x: event.clientX, y: event.clientY });
  event.preventDefault();
}

function onPointerUp(event: PointerEvent): void {
  if (connectionPointer?.pointerId === event.pointerId) {
    if (canvasElement.value?.hasPointerCapture(event.pointerId)) canvasElement.value.releasePointerCapture(event.pointerId);
    if (!connectionPointer.ended && event.type !== "pointercancel") {
      const releasePoint = pointerInWorld(event);
      const target = portAtWorld(releasePoint);
      const isNearOrigin = connectionDraftOrigin && Math.hypot(connectionDraftOrigin.point.x - releasePoint.x, connectionDraftOrigin.point.y - releasePoint.y) <= 12 / Math.max(props.viewport.zoom, 0.01);
      if (target && !isNearOrigin) emit("connectionEnd", target);
      else if (!isNearOrigin) emit("connectionWaypoint", { point: releasePoint, altKey: event.altKey });
    }
    if (event.type === "pointercancel") emit("connectionCancel");
    connectionPointer = null;
    hoveredConnectionTarget.value = null;
    event.preventDefault();
    return;
  }
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
  if (event.type === "pointercancel") panMoveCoalescer.cancel();
  else panMoveCoalescer.flush();
  if (canvasElement.value?.hasPointerCapture(event.pointerId)) canvasElement.value.releasePointerCapture(event.pointerId);
  panPointer = null;
  isPanning.value = false;
}

function onNodeClick(nodeId: string): void {
  if (props.interaction.connectionDraft) return;
  if (suppressNodeClick) {
    suppressNodeClick = false;
    return;
  }
  emit("selectComponent", nodeId);
}

function focusPortTarget(target: HTMLElement): ConnectionDraftPort | null {
  const nodeId = target.dataset.nodeId;
  const portId = target.dataset.portId;
  const node = props.scene.nodes.find((candidate) => candidate.id === nodeId);
  const port = node?.ports.find((candidate) => candidate.id === portId);
  return node && port ? connectionPort(node, port) : null;
}

function draftCursor(): { x: number; y: number } | null {
  const point = props.interaction.connectionDraft?.at(-1);
  return point ? { ...point } : null;
}

function onCanvasKeyboard(event: KeyboardEvent): void {
  if (isEditableKeyboardTarget(event.target)) return;
  if (event.key === " " && !props.interaction.connectionDraft) {
    spacePressed = true;
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const action = resolveCanvasKeyboardAction({
    key: event.key,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    hasDraft: Boolean(props.interaction.connectionDraft),
    targetIsEditable: false,
  });
  if (!action) return;
  const target = event.target instanceof Element ? event.target : canvasElement.value;
  const focusDataset = target instanceof HTMLElement || target instanceof SVGElement ? target.dataset : undefined;
  const port = target?.matches("[data-port-id]") && target instanceof HTMLElement ? focusPortTarget(target) : null;
  if (action.type === "open-menu") {
    if (!props.interaction.connectionDraft) {
      openComponentMenu(keyboardMenuAnchor(event.target), event.altKey);
    }
  } else if (action.type === "pan") {
    emit("viewportChange", panViewport(props.viewport, { x: action.dx * 48, y: action.dy * 48 }));
  } else if (action.type === "move-draft") {
    const cursor = draftCursor();
    if (cursor) {
      const next = { x: cursor.x + action.dx * 16 / Math.max(props.viewport.zoom, 0.01), y: cursor.y + action.dy * 16 / Math.max(props.viewport.zoom, 0.01) };
      if (action.waypoint) emit("connectionWaypoint", { point: next, altKey: event.altKey });
      else emit("connectionMove", { point: next, altKey: event.altKey });
    }
  } else if (action.type === "toggle-draft-axis") {
    emit("connectionAxisToggle");
  } else if (action.type === "remove-draft-waypoint") {
    emit("connectionWaypointRemove");
  } else if (action.type === "finish-draft") {
    if (port) emit("connectionEnd", port);
    else {
      const cursor = draftCursor();
      if (cursor) emit("connectionWaypoint", { point: cursor, altKey: event.altKey });
    }
  } else if (action.type === "next-focus") {
    if (event.key === "Tab") focusByOffset(action.delta);
    else focusByDirection(event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0, event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0);
  } else if (action.type === "select-focus") {
    if (port && !props.interaction.connectionDraft) {
      connectionDraftOrigin = port;
      allowSameDirectionDraftTarget = false;
      emit("connectionStart", port);
    }
    else if (focusDataset?.focusKind === "component") emit("selectComponent", focusDataset.focusId ?? "");
    else if (focusDataset?.focusKind === "connection") emit("selectConnection", focusDataset.focusId ?? "");
  } else if (action.type === "cancel") {
    if (props.interaction.connectionDraft) emit("connectionCancel");
    else if (props.interaction.routeEditPreview) emit("routeEditCancel");
    else if (props.interaction.draggingComponentId) emit("nodeDragCancel");
    else return;
  }
  event.preventDefault();
  event.stopPropagation();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === " ") {
    if (props.interaction.connectionDraft) {
      emit("connectionAxisToggle");
      event.preventDefault();
      return;
    }
    spacePressed = true;
    event.preventDefault();
  }
}

function onPortPointerDown(event: PointerEvent, node: CanvasNode, port: CanvasNode["ports"][number]): void {
  if (event.button !== 0 || spacePressed || props.interaction.pendingPlacement) return;
  const draftPort = connectionPort(node, port);
  if (resolveConnectionPortPointerAction(Boolean(props.interaction.connectionDraft)) === "finish") {
    hoveredConnectionTarget.value = null;
    emit("connectionEnd", draftPort);
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  connectionDraftOrigin = draftPort;
  allowSameDirectionDraftTarget = false;
  connectionPointer = { pointerId: event.pointerId, ended: false };
  canvasElement.value?.setPointerCapture(event.pointerId);
  emit("connectionStart", draftPort);
  emit("connectionMove", { point: pointerInWorld(event), altKey: event.altKey });
  event.preventDefault();
  event.stopPropagation();
}

function onPortPointerUp(event: PointerEvent, node: CanvasNode, port: CanvasNode["ports"][number]): void {
  if (!connectionPointer || connectionPointer.pointerId !== event.pointerId) return;
  const releasePoint = pointerInWorld(event);
  const target = portAtWorld(releasePoint);
  const originPoint = props.interaction.connectionDraft?.[0];
  const isNearOrigin = originPoint && Math.hypot(originPoint.x - releasePoint.x, originPoint.y - releasePoint.y) <= 12 / Math.max(props.viewport.zoom, 0.01);
  if (target && !isNearOrigin) {
    connectionPointer.ended = true;
    emit("connectionEnd", target);
  } else if (!isNearOrigin) {
    connectionPointer.ended = true;
    emit("connectionWaypoint", { point: releasePoint, altKey: event.altKey });
  } else {
    connectionPointer.ended = true;
    if (canvasElement.value?.hasPointerCapture(event.pointerId)) canvasElement.value.releasePointerCapture(event.pointerId);
    connectionPointer = null;
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  connectionPointer.ended = true;
  if (canvasElement.value?.hasPointerCapture(event.pointerId)) canvasElement.value.releasePointerCapture(event.pointerId);
  connectionPointer = null;
  event.preventDefault();
  event.stopPropagation();
}

function onPortClick(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
  // Port 的开始/完成意图都在 pointerdown 处理；click 只阻止节点选择冒泡。
}

/** 从悬空 Wire 的冻结端点发起修复草稿，保留原 Connection 的稳定身份。 */
function onDanglingEndpointPointerDown(event: PointerEvent, wire: CanvasWire, side: "source" | "target"): void {
  if (event.button !== 0 || spacePressed || props.interaction.pendingPlacement) return;
  connectionPointer = { pointerId: event.pointerId, ended: false };
  canvasElement.value?.setPointerCapture(event.pointerId);
  const endpoint = side === "source" ? wire.source : wire.target;
  const draftPort: ConnectionDraftPort = {
    componentId: endpoint.componentId,
    port: endpoint.port,
    direction: side === "source" ? "output" : "input",
    point: { ...endpoint.point },
    outward: side === "source" ? "right" : "left",
  };
  connectionDraftOrigin = draftPort;
  allowSameDirectionDraftTarget = true;
  emit("connectionStart", draftPort);
  emit("connectionMove", { point: pointerInWorld(event), altKey: event.altKey });
  event.preventDefault();
  event.stopPropagation();
}

function onKeyup(event: KeyboardEvent): void {
  if (event.key === " ") spacePressed = false;
}

function onCanvasKeydown(event: KeyboardEvent): void {
  onCanvasKeyboard(event);
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
  panMoveCoalescer.cancel();
  isPanning.value = false;
  resizeObserver?.disconnect();
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("keyup", onKeyup);
});

watch(() => props.interaction.connectionDraft, (draft) => {
  if (draft) return;
  connectionDraftOrigin = null;
  allowSameDirectionDraftTarget = false;
  hoveredConnectionTarget.value = null;
});
</script>

<template>
  <div class="editor-canvas-wrap">
    <div class="canvas-info"><span class="canvas-mode"><span class="mode-dot" aria-hidden="true"></span>场景模式</span><span>Delete 删除 · Ctrl/Cmd+D 复制 · Ctrl/Cmd+Z 撤销 · Esc 取消</span></div>
    <div ref="canvasElement" class="circuit-canvas" :class="{ 'circuit-canvas--dense': isDenseCanvasScene(scene), 'circuit-canvas--panning': isPanning, 'circuit-canvas--connecting': interaction.connectionDraft }" role="application" tabindex="0" aria-label="电路画布" @wheel="onWheel" @contextmenu="onContextMenu" @keydown="onCanvasKeydown" @dragover="onDragOver" @drop="onDrop" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp">
      <div class="canvas-grid" :style="gridStyle()" aria-hidden="true"></div>
      <div class="canvas-viewport" :style="viewportStyle()">
        <svg class="signal-map" aria-label="电路连接">
          <template v-for="wire in scene.wires" :key="wire.id">
            <path class="signal-wire-hit" :d="pathFor(wire.route)" role="button" tabindex="0" data-canvas-focus data-focus-kind="connection" :data-focus-id="wire.id" :class="{ 'signal-wire-hit--focused': interaction.focusedId === wire.id }" :aria-label="`${wire.danglingEndpoints.length > 0 ? '悬空' : '正常'}连线 ${wire.id}，信号 ${wire.signal}`" @focus="emit('focusChange', wire.id)" @click.stop="emit('selectConnection', wire.id)" />
            <template v-if="wire.selected" v-for="(_, segmentIndex) in wire.route.slice(0, -1)" :key="`${wire.id}-segment-${segmentIndex}`">
              <path v-if="segmentIndex > 0 && segmentIndex < wire.route.length - 2" class="route-segment-hit" :d="segmentPath(wire.route, segmentIndex)" :aria-label="`移动连线 ${wire.id} 线段 ${segmentIndex + 1}`" @pointerdown.stop="onRouteSegmentPointerDown($event, wire, segmentIndex)" />
            </template>
            <template v-if="wire.selected" v-for="(point, pointIndex) in wire.route.slice(1, -1)" :key="`${wire.id}-waypoint-${pointIndex}`">
              <circle class="route-waypoint-handle" :cx="point.x" :cy="point.y" r="7" role="button" tabindex="0" :aria-label="`编辑连线 ${wire.id} 折点 ${pointIndex + 1}`" @pointerdown.stop="onRouteWaypointPointerDown($event, wire, pointIndex + 1)" />
            </template>
            <path v-if="wire.selected" class="signal-wire-outline" :d="pathFor(wire.route)" aria-hidden="true" />
            <path :id="wirePathId(wire.id)" class="signal-wire" :class="[wireColorClass(wire.color), { 'signal-wire--dangling': wire.danglingEndpoints.length > 0 }]" :data-signal="wire.signal" :data-wire-color="wire.color ?? DEFAULT_WIRE_COLOR" :data-dangling="wire.danglingEndpoints.length > 0 ? 'true' : 'false'" :d="pathFor(wire.route)" />
            <template v-if="wire.danglingEndpoints.length === 0">
              <template v-if="!isDenseCanvasScene(scene)">
                <text v-for="phase in [0, 1, 2]" :key="`${wire.id}-signal-${phase}`" class="wire-signal-flow" :class="wireColorClass(wire.color)" aria-hidden="true">
                  <textPath :href="`#${wirePathId(wire.id)}`" startOffset="-10%"><animate attributeName="startOffset" from="-10%" to="110%" dur="5.1s" :begin="`${phase * -1.7}s`" repeatCount="indefinite" />{{ wire.signal }}</textPath>
                </text>
              </template>
              <text class="wire-signal-label" :class="[wireColorClass(wire.color), { 'wire-signal-label--dense': isDenseCanvasScene(scene) }]" aria-hidden="true"><textPath :href="`#${wirePathId(wire.id)}`" startOffset="50%">{{ wire.signal }}</textPath></text>
            </template>
            <circle v-if="wire.danglingEndpoints.includes('source')" class="dangling-endpoint" :cx="wire.source.point.x" :cy="wire.source.point.y" r="6" role="button" tabindex="0" :aria-label="`修复悬空连接 ${wire.id} 的来源端点`" @pointerdown.stop="onDanglingEndpointPointerDown($event, wire, 'source')" />
            <circle v-if="wire.danglingEndpoints.includes('target')" class="dangling-endpoint" :cx="wire.target.point.x" :cy="wire.target.point.y" r="6" role="button" tabindex="0" :aria-label="`修复悬空连接 ${wire.id} 的目标端点`" @pointerdown.stop="onDanglingEndpointPointerDown($event, wire, 'target')" />
          </template>
          <path v-if="interaction.connectionDraft" class="signal-wire signal-wire--draft" :d="pathFor(interaction.connectionDraft)" />
        </svg>
        <article v-for="node in scene.nodes" :key="node.id" class="circuit-node" :class="{ 'circuit-node--selected': node.selected, 'circuit-node--focused': interaction.focusedId === node.id, 'circuit-node--dragging': interaction.draggingComponentId === node.id }" :style="nodeStyle(node)" role="button" tabindex="0" data-canvas-focus data-focus-kind="component" :data-focus-id="node.id" :data-selected="node.selected ? 'true' : 'false'" :aria-label="`选择${node.kind.toUpperCase()} 元件`" @focus="emit('focusChange', node.id)" @pointerdown.stop="onNodePointerDown($event, node)" @click="onNodeClick(node.id)">
          <strong>{{ node.kind.toUpperCase() }}</strong>
          <span v-for="port in node.ports" :key="port.id" class="node-port" :class="[port.direction === 'input' ? 'node-port--left' : 'node-port--right', signalClass(port.signal), { 'node-port--dangling': port.dangling, 'node-port--connection-target': isHoveredConnectionTarget(node.id, port.id) }]" :style="{ top: `${port.offset.y}px` }" :data-port-id="port.id" :data-node-id="node.id" :data-signal="port.signal" :data-dangling="port.dangling ? 'true' : 'false'" :data-focus-id="`port:${node.id}:${port.id}`" data-focus-kind="port" data-canvas-focus role="button" tabindex="0" :aria-label="`${port.direction === 'input' ? '输入' : '输出'}端口 ${port.name}，信号 ${port.signal}${port.dangling ? '，悬空' : ''}`" @focus="emit('focusChange', `port:${node.id}:${port.id}`)" @pointerdown.stop="onPortPointerDown($event, node, port)" @pointerup.stop="onPortPointerUp($event, node, port)" @click.stop="onPortClick($event)"><span class="node-port__anchor" aria-hidden="true"></span><span class="node-port__label">{{ port.name }}</span></span>
        </article>
        <article v-if="interaction.pendingPlacement" class="circuit-node circuit-node--pending" :class="{ 'circuit-node--error': interaction.pendingPlacement.error }" :style="{ left: `${interaction.pendingPlacement.position.x}px`, top: `${interaction.pendingPlacement.position.y}px`, width: `${interaction.pendingPlacement.size.width}px`, height: `${interaction.pendingPlacement.size.height}px` }" role="status" :aria-label="`${interaction.pendingPlacement.error ? '放置失败' : '正在放置'} ${interaction.pendingPlacement.kind} 元件`">
          <span class="node-tag">{{ interaction.pendingPlacement.error ? '放置失败' : '待放置' }}</span><strong>{{ interaction.pendingPlacement.kind.toUpperCase() }}</strong>
          <span class="node-description">{{ interaction.pendingPlacement.error ?? '单击画布放置' }}</span>
          <span v-if="interaction.pendingPlacement.error" class="pending-placement-actions"><button type="button" @click.stop="emit('retryPlacement')">重试</button><button type="button" @click.stop="emit('cancelPlacement')">取消</button></span><span v-else class="node-description">Esc 取消</span>
        </article>
      </div>
      <div v-if="interaction.emptyState" class="canvas-empty-state"><span class="empty-orbit">＋</span><strong>{{ interaction.emptyState.title }}</strong><p>{{ interaction.emptyState.message }}</p></div>
      <div v-if="interaction.connectionDraftError" class="canvas-draft-error" role="alert">{{ interaction.connectionDraftError }}<span> · Esc 取消，或选择其他端口重试</span></div>
      <ComponentMenu
        v-if="componentMenu"
        :style="{ left: `${componentMenu.position.x}px`, top: `${componentMenu.position.y}px` }"
        :definitions="controller.componentDefinitions"
        :recent-kinds="controller.recentComponentKinds"
        @select="selectComponentFromMenu"
        @close="closeComponentMenu"
      />
      <div
        v-if="objectMenu"
        class="object-context-menu"
        role="menu"
        aria-label="对象操作"
        :style="{ left: `${objectMenu.position.x}px`, top: `${objectMenu.position.y}px` }"
        @pointerdown.stop
        @contextmenu.stop.prevent
        @wheel.stop
        @keydown="onObjectMenuKeydown"
      >
        <div v-if="objectMenuWireId()" class="object-context-menu__colors" role="group" aria-label="Wire 颜色">
          <span>线路颜色</span>
          <div class="wire-color-options">
            <button
              v-for="preset in WIRE_COLOR_PRESETS"
              :key="preset.id"
              class="wire-color-swatch"
              :class="[`wire-color--${preset.id}`, { 'wire-color-swatch--active': preset.id === objectMenuWireColor() }]"
              type="button"
              role="menuitemradio"
              :aria-checked="preset.id === objectMenuWireColor()"
              :aria-label="preset.label"
              :title="preset.label"
              @click="selectWireColor(preset.id)"
            ><span aria-hidden="true"></span></button>
          </div>
        </div>
        <button
          v-for="action in objectMenu.actions"
          :key="action.id"
          type="button"
          role="menuitem"
          :class="{ 'object-context-menu__item--destructive': action.destructive }"
          @click="selectObjectAction(action.id)"
        >{{ action.label }}</button>
      </div>
      <div class="canvas-crosshair canvas-crosshair--tl" aria-hidden="true"></div><div class="canvas-crosshair canvas-crosshair--br" aria-hidden="true"></div>
    </div>
    <div class="canvas-legend"><span><i class="legend-line legend-line--flow">1</i>文字沿输出流向输入</span><span><i class="legend-line legend-line--outline"></i>选中描边</span><span><i class="legend-line legend-line--dangling"></i>悬空无流动文字</span></div>
  </div>
</template>
