import type { ComponentKindName } from "@circuit-platform/protocol";
import { positionFromPlacementCenter } from "./placement.ts";
import {
  createDefaultOrthogonalRoute,
  deleteRouteWaypoint,
  moveRouteSegment,
  moveRouteWaypoint,
  normalizeOrthogonalRoute,
  resetOrthogonalRoute,
  routeFromWaypoints,
} from "./route.ts";
export {
  EMPTY_CONNECTION_DRAFT,
  connectionDraftRoute,
  createConnectionDraft,
  normalizeConnectionEndpoints,
  reduceConnectionDraft,
  validateConnectionDraftTarget,
  type ConnectionDraftAction,
  type ConnectionDraftAxis,
  type ConnectionDraftError,
  type ConnectionDraftOptions,
  type ConnectionDraftPhase,
  type ConnectionDraftPort,
  type ConnectionDraftState,
} from "./connection-draft.ts";
import type { ConnectionDraftPort } from "./connection-draft.ts";
import { normalizeConnectionEndpoints, validateConnectionDraftTarget } from "./connection-draft.ts";

export {
  ROUTE_GRID_SIZE,
  ROUTE_TERMINAL_LENGTH,
  createDefaultOrthogonalRoute,
  deleteRouteWaypoint,
  insertRouteDetour,
  isOrthogonalRoute,
  moveRouteSegment,
  moveRouteWaypoint,
  normalizeOrthogonalRoute,
  resetOrthogonalRoute,
  routeFromWaypoints,
  snapRoutePoint,
  type PortOutwardDirection,
  type RouteAxis,
  type RouteOptions,
} from "./route.ts";

export {
  EDITOR_GRID_SIZE,
  positionFromPlacementCenter,
  snapWorldPoint,
  type ComponentPlacementIntent,
} from "./placement.ts";

export type EditorComponentId = string;
export type EditorConnectionId = string;
export type EngineComponentId = number;
export type EngineConnectionId = number;

export interface Point {
  x: number;
  y: number;
}

export interface EditorComponent {
  id: EditorComponentId;
  kind: ComponentKindName;
  displayName: string;
  position: Point;
  lifecycle: "active" | "deleted";
}

export type EditorEndpointSide = "source" | "target";

export interface EditorEndpoint {
  componentId: EditorComponentId;
  port: string;
  point: Point;
}

export interface EditorConnection {
  id: EditorConnectionId;
  source: EditorEndpoint;
  target: EditorEndpoint;
  lifecycle: "visible" | "hidden" | "deleted";
  danglingEndpoints: readonly EditorEndpointSide[];
  /** 可选的显式正交 Route；首尾点分别对应 source/target，旧文档可由投影层补齐。 */
  route?: readonly Point[];
  /** 可选的 Waypoint 语义投影；route 存在时 route 是渲染用的完整点列。 */
  waypoints?: readonly Point[];
  hiddenReason?: "pending-operation";
}

export interface EditorDocument {
  components: readonly EditorComponent[];
  connections: readonly EditorConnection[];
}

/** 初始编辑器文档和当前 C++ 运行时绑定；绑定只在模块内部使用。 */
export interface EditorInitialState {
  document: EditorDocument;
  bindings: EditorBindings;
}

export interface EditorBindings {
  components: Readonly<Partial<Record<EditorComponentId, EngineComponentId>>>;
  connections: Readonly<Partial<Record<EditorConnectionId, EngineConnectionId>>>;
}

export interface EngineError {
  code: string;
  message: string;
  retryable: boolean;
}

export type EngineResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: EngineError };

/** 编辑器只依赖这组窄操作，协议字段和 Electron 通道由 adapter 隐藏。 */
export interface CircuitEnginePort {
  addComponent(
    kind: ComponentKindName,
  ): Promise<EngineResult<{ componentId: EngineComponentId }>>;
  addConnection(input: {
    sourceComponentId: EngineComponentId;
    sourcePort: string;
    targetComponentId: EngineComponentId;
    targetPort: string;
  }): Promise<EngineResult<{ connectionId: EngineConnectionId }>>;
  removeComponent(
    componentId: EngineComponentId,
  ): Promise<EngineResult<{ componentId: EngineComponentId }>>;
  removeConnection(
    connectionId: EngineConnectionId,
  ): Promise<EngineResult<{ connectionId: EngineConnectionId }>>;
  /** 结构命令成功后可选地让仿真引擎重新稳定；失败不回滚合法结构。 */
  settle?(): Promise<EngineResult<{ status: "ok" }>>;
}

export type EditorSelection =
  | { kind: "component"; id: EditorComponentId }
  | { kind: "connection"; id: EditorConnectionId }
  | null;

export type EditorCommand =
  | { type: "select"; selection: EditorSelection }
  | { type: "move-component"; componentId: EditorComponentId; position: Point }
  | { type: "move-node"; nodeId: EditorComponentId; position: Point }
  | { type: "move-node"; componentId: EditorComponentId; position: Point }
  | { type: "edit-route"; connectionId: EditorConnectionId; route: readonly Point[]; altKey?: boolean }
  | { type: "move-route"; connectionId: EditorConnectionId; route: readonly Point[]; altKey?: boolean }
  | { type: "move-route-waypoint"; connectionId: EditorConnectionId; pointIndex: number; delta: Point; altKey?: boolean }
  | { type: "move-route-segment"; connectionId: EditorConnectionId; segmentIndex: number; offset: Point; altKey?: boolean }
  | { type: "delete-waypoint"; connectionId: EditorConnectionId; pointIndex: number }
  | { type: "reset-route"; connectionId: EditorConnectionId }
  | { type: "create-connection"; left: ConnectionDraftPort; right: ConnectionDraftPort; route?: readonly Point[]; waypoints?: readonly Point[] }
  | { type: "add-connection"; left: ConnectionDraftPort; right: ConnectionDraftPort; route?: readonly Point[]; waypoints?: readonly Point[] }
  | { type: "begin-placement"; kind: ComponentKindName; center?: Point; altKey?: boolean; continuous?: boolean }
  | { type: "start-placement"; kind: ComponentKindName; center?: Point; altKey?: boolean; continuous?: boolean }
  | { type: "update-placement"; center: Point; altKey?: boolean }
  | { type: "place-component"; kind?: ComponentKindName; center: Point; altKey?: boolean; continuous?: boolean }
  | { type: "commit-placement"; kind?: ComponentKindName; center: Point; altKey?: boolean; continuous?: boolean }
  | { type: "add-component"; kind: ComponentKindName; position: Point; altKey?: boolean }
  | { type: "delete-selected" }
  | { type: "delete-component"; componentId: EditorComponentId }
  | { type: "delete-connection"; connectionId: EditorConnectionId }
  | { type: "request-clear" }
  | { type: "confirm-clear" }
  | { type: "cancel-current-operation" }
  | { type: "retry-current-operation" }
  | { type: "retry-placement" }
  | { type: "undo" }
  | { type: "redo" };

export interface EditorConfirmation {
  type: "clear-document";
  componentCount: number;
  connectionCount: number;
}

export interface EditorSnapshot {
  document: EditorDocument;
  selection: EditorSelection;
  operation: "idle" | "busy" | "recovery-required";
  canUndo: boolean;
  canRedo: boolean;
  confirmation: EditorConfirmation | null;
  error: EngineError | null;
  /** 元件库点击后的临时放置状态；不会进入 EditorDocument 或历史。 */
  pendingPlacement?: PendingPlacement | null;
}

export interface PendingPlacement {
  kind: ComponentKindName;
  center: Point | null;
  altKey: boolean;
  continuous: boolean;
}

export type CommandResult =
  | { ok: true; snapshot: EditorSnapshot }
  | { ok: false; error: EngineError; snapshot: EditorSnapshot };

export interface EditorSession {
  /** 返回不包含任何 C++ engine ID 的编辑器快照。 */
  snapshot(): EditorSnapshot;
  /** 分发编辑器命令；清空需先请求确认，并发结构命令会以稳定 busy 错误拒绝。 */
  dispatch(command: EditorCommand): Promise<CommandResult>;
  /** 订阅快照变化，并返回取消订阅函数。 */
  subscribe(listener: (snapshot: EditorSnapshot) => void): () => void;
}

export interface EditorSessionOptions {
  /** 结构提交后发布仍然有效的运行时绑定；仅供工作区组合层同步仿真身份。 */
  onBindingsChanged?(bindings: EditorBindings): void;
}

interface MutableDocument {
  components: Map<EditorComponentId, EditorComponent>;
  connections: Map<EditorConnectionId, EditorConnection>;
}

interface DeleteComponentFrame {
  type: "delete-component";
  componentId: EditorComponentId;
  selectionBefore: EditorSelection;
  kind: ComponentKindName;
  danglingConnectionIds: EngineConnectionId[];
  connectionPlans: Array<{
    id: EditorConnectionId;
    source: EditorConnection["source"];
    target: EditorConnection["target"];
    route?: readonly Point[];
    waypoints?: readonly Point[];
  }>;
}

interface DeleteConnectionFrame {
  type: "delete-connection";
  connectionId: EditorConnectionId;
  selectionBefore: EditorSelection;
  source: EditorConnection["source"];
  target: EditorConnection["target"];
}

interface ClearDocumentFrame {
  type: "clear-document";
  selectionBefore: EditorSelection;
  components: Array<{
    id: EditorComponentId;
    kind: ComponentKindName;
  }>;
  connections: Array<{
    id: EditorConnectionId;
    source: EditorConnection["source"];
    target: EditorConnection["target"];
    wasLive: boolean;
  }>;
}

interface MoveComponentFrame {
  type: "move-component";
  componentId: EditorComponentId;
  positionBefore: Point;
  positionAfter: Point;
  selectionBefore: EditorSelection;
  connectionsBefore: Array<{
    id: EditorConnectionId;
    source: EditorConnection["source"];
    target: EditorConnection["target"];
    route?: readonly Point[];
    waypoints?: readonly Point[];
  }>;
  connectionsAfter: Array<{
    id: EditorConnectionId;
    source: EditorConnection["source"];
    target: EditorConnection["target"];
    route?: readonly Point[];
    waypoints?: readonly Point[];
  }>;
}
interface AddComponentFrame {
  type: "add-component";
  componentId: EditorComponentId;
  kind: ComponentKindName;
  displayName: string;
  position: Point;
}

interface CreateConnectionFrame {
  type: "create-connection";
  connectionId: EditorConnectionId;
  source: EditorConnection["source"];
  target: EditorConnection["target"];
  route: readonly Point[];
  waypoints: readonly Point[];
  selectionBefore: EditorSelection;
}

interface EditRouteFrame {
  type: "edit-route";
  connectionId: EditorConnectionId;
  routeBefore?: readonly Point[];
  routeAfter: readonly Point[];
  waypointsBefore?: readonly Point[];
  waypointsAfter?: readonly Point[];
  selectionBefore: EditorSelection;
}

type HistoryFrame = DeleteComponentFrame | DeleteConnectionFrame | ClearDocumentFrame | MoveComponentFrame | AddComponentFrame | CreateConnectionFrame | EditRouteFrame;

const busyError: EngineError = {
  code: "editor_busy",
  message: "编辑器正在处理上一个操作。",
  retryable: true,
};

const noSelectionError: EngineError = {
  code: "nothing_selected",
  message: "没有选中的元件或连接。",
  retryable: false,
};

const nothingToClearError: EngineError = {
  code: "nothing_to_clear",
  message: "画布已经是空的。",
  retryable: false,
};

const confirmationRequiredError: EngineError = {
  code: "confirmation_required",
  message: "清空画布前需要确认。",
  retryable: false,
};

const confirmationPendingError: EngineError = {
  code: "confirmation_pending",
  message: "请先确认或取消当前操作。",
  retryable: false,
};

const recoveryError = (message: string): EngineError => ({
  code: "editor_recovery_required",
  message,
  retryable: true,
});

function cloneVisibleDocument(document: MutableDocument): EditorDocument {
  const isAttached = (componentId: EditorComponentId): boolean =>
    document.components.get(componentId)?.lifecycle === "active";
  return {
    components: [...document.components.values()]
      .filter((component) => component.lifecycle === "active")
      .map((component) => ({ ...component, position: { ...component.position } })),
    connections: [...document.connections.values()]
      .filter((connection) => connection.lifecycle === "visible")
      .map((connection) => ({
        ...connection,
        source: { ...connection.source, point: { ...connection.source.point } },
        target: { ...connection.target, point: { ...connection.target.point } },
        ...(connection.route ? { route: connection.route.map((point) => ({ ...point })) } : {}),
        ...(connection.waypoints ? { waypoints: connection.waypoints.map((point) => ({ ...point })) } : {}),
        danglingEndpoints: [
          ...(!isAttached(connection.source.componentId) ? ["source" as const] : []),
          ...(!isAttached(connection.target.componentId) ? ["target" as const] : []),
        ],
      })),
  };
}

function toMutableDocument(document: EditorDocument): MutableDocument {
  return {
    components: new Map(
      document.components.map((component) => [
        component.id,
        { ...component, position: { ...component.position } },
      ]),
    ),
    connections: new Map(
      document.connections.map((connection) => [
        connection.id,
        {
          ...connection,
          source: { ...connection.source, point: { ...connection.source.point } },
          target: { ...connection.target, point: { ...connection.target.point } },
          ...(connection.route ? { route: connection.route.map((point) => ({ ...point })) } : {}),
          ...(connection.waypoints ? { waypoints: connection.waypoints.map((point) => ({ ...point })) } : {}),
          danglingEndpoints: [...connection.danglingEndpoints],
        },
      ]),
    ),
  };
}

function cloneBindings(bindings: EditorBindings): {
  components: Partial<Record<EditorComponentId, EngineComponentId>>;
  connections: Partial<Record<EditorConnectionId, EngineConnectionId>>;
} {
  return {
    components: { ...bindings.components },
    connections: { ...bindings.connections },
  };
}

function normalizeThrown(error: unknown): EngineError {
  if (typeof error === "object" && error !== null) {
    const candidate = error as Partial<EngineError>;
    if (typeof candidate.code === "string" && typeof candidate.message === "string") {
      return {
        code: candidate.code,
        message: candidate.message,
        retryable: candidate.retryable ?? true,
      };
    }
  }
  return {
    code: "engine_operation_failed",
    message: error instanceof Error ? error.message : "仿真引擎操作失败。",
    retryable: true,
  };
}

function failed<T>(error: EngineError): EngineResult<T> {
  return { ok: false, error };
}

function notify(listeners: Set<(snapshot: EditorSnapshot) => void>, snapshot: EditorSnapshot): void {
  for (const listener of listeners) listener(snapshot);
}

function isAlreadyAbsent(error: EngineError): boolean {
  return error.code === "component_not_found" || error.code === "connection_not_found";
}

/** 创建固定 AND 示例的稳定编辑器文档，返回不包含引擎身份的初始可见结构。 */
export function createAndDemoDocument(): EditorDocument {
  return {
    components: [
      { id: "input-a", kind: "input", displayName: "输入 A", position: { x: 110, y: 100 }, lifecycle: "active" },
      { id: "input-b", kind: "input", displayName: "输入 B", position: { x: 110, y: 340 }, lifecycle: "active" },
      { id: "and-gate", kind: "and", displayName: "AND 门", position: { x: 440, y: 220 }, lifecycle: "active" },
      { id: "output", kind: "output", displayName: "输出", position: { x: 800, y: 240 }, lifecycle: "active" },
    ],
    connections: [
      { id: "wire-a", source: { componentId: "input-a", port: "out", point: { x: 210, y: 150 } }, target: { componentId: "and-gate", port: "in1", point: { x: 435, y: 250 } }, route: [{ x: 210, y: 150 }, { x: 330, y: 150 }, { x: 330, y: 250 }, { x: 435, y: 250 }], lifecycle: "visible", danglingEndpoints: [] },
      { id: "wire-b", source: { componentId: "input-b", port: "out", point: { x: 210, y: 405 } }, target: { componentId: "and-gate", port: "in2", point: { x: 435, y: 290 } }, route: [{ x: 210, y: 405 }, { x: 330, y: 405 }, { x: 330, y: 290 }, { x: 435, y: 290 }], lifecycle: "visible", danglingEndpoints: [] },
      { id: "wire-output", source: { componentId: "and-gate", port: "out", point: { x: 585, y: 270 } }, target: { componentId: "output", port: "in", point: { x: 805, y: 270 } }, route: [{ x: 585, y: 270 }, { x: 805, y: 270 }], lifecycle: "visible", danglingEndpoints: [] },
    ],
  };
}

function visibleSnapshot(
  document: MutableDocument,
  selection: EditorSelection,
  operation: EditorSnapshot["operation"],
  undoStack: readonly HistoryFrame[],
  redoStack: readonly HistoryFrame[],
  confirmation: EditorConfirmation | null,
  error: EngineError | null,
  pendingPlacement: PendingPlacement | null,
): EditorSnapshot {
  return {
    document: cloneVisibleDocument(document),
    selection: selection ? { ...selection } : null,
    operation,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    confirmation: confirmation ? { ...confirmation } : null,
    error: error ? { ...error } : null,
    pendingPlacement: pendingPlacement
      ? { ...pendingPlacement, center: pendingPlacement.center ? { ...pendingPlacement.center } : null }
      : null,
  };
}

function setComponentDeleted(document: MutableDocument, id: EditorComponentId): void {
  const component = document.components.get(id);
  if (!component) return;
  component.lifecycle = "deleted";
}

function restoreComponent(document: MutableDocument, id: EditorComponentId): void {
  const component = document.components.get(id);
  if (!component) return;
  component.lifecycle = "active";
}

function cloneEndpoint(endpoint: EditorEndpoint): EditorEndpoint {
  return { ...endpoint, point: { ...endpoint.point } };
}

function cloneConnectionGeometry(connection: EditorConnection): {
  id: EditorConnectionId;
  source: EditorConnection["source"];
  target: EditorConnection["target"];
  route?: readonly Point[];
  waypoints?: readonly Point[];
} {
  return {
    id: connection.id,
    source: cloneEndpoint(connection.source),
    target: cloneEndpoint(connection.target),
    ...(connection.route ? { route: connection.route.map((point) => ({ ...point })) } : {}),
    ...(connection.waypoints ? { waypoints: connection.waypoints.map((point) => ({ ...point })) } : {}),
  };
}

function pointsEqual(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function updateMovedConnection(
  connection: EditorConnection,
  componentId: EditorComponentId,
  beforePosition: Point,
  afterPosition: Point,
): void {
  const moveEndpoint = (endpoint: EditorEndpoint): EditorEndpoint => {
    if (endpoint.componentId !== componentId) return cloneEndpoint(endpoint);
    return {
      ...endpoint,
      point: {
        x: afterPosition.x + endpoint.point.x - beforePosition.x,
        y: afterPosition.y + endpoint.point.y - beforePosition.y,
      },
    };
  };
  const source = moveEndpoint(connection.source);
  const target = moveEndpoint(connection.target);
  const oldRoute = connection.route;
  const waypoints = connection.waypoints ?? (oldRoute && oldRoute.length > 2 ? oldRoute.slice(1, -1) : []);
  connection.source = source;
  connection.target = target;
  connection.route = routeFromWaypoints(source.point, target.point, waypoints);
}

function restoreConnectionGeometry(
  document: MutableDocument,
  geometry: MoveComponentFrame["connectionsBefore"][number],
): void {
  const connection = document.connections.get(geometry.id);
  if (!connection) return;
  connection.source = cloneEndpoint(geometry.source);
  connection.target = cloneEndpoint(geometry.target);
  connection.route = geometry.route?.map((point) => ({ ...point }));
  connection.waypoints = geometry.waypoints?.map((point) => ({ ...point }));
}

/**
 * 创建编辑器深模块。
 * @param initial 固定示例或加载后的编辑器文档及初始引擎绑定。
 * @param engine 只负责元件/连接增删的异步引擎 seam。
 * @returns 只暴露稳定本地 ID 和编辑器命令的会话接口。
 */
export function createEditorSession(
  initial: EditorInitialState,
  engine: CircuitEnginePort,
  options: EditorSessionOptions = {},
): EditorSession {
  const document = toMutableDocument(initial.document);
  const bindings = cloneBindings(initial.bindings);
  const listeners = new Set<(snapshot: EditorSnapshot) => void>();
  const undoStack: HistoryFrame[] = [];
  const redoStack: HistoryFrame[] = [];
  let selection: EditorSelection = null;
  let confirmation: EditorConfirmation | null = null;
  let operation: EditorSnapshot["operation"] = "idle";
  let error: EngineError | null = null;
  let pendingPlacement: PendingPlacement | null = null;
  let pendingIdentity: { id: EditorComponentId; displayName: string } | null = null;
  let nextEditorComponentSequence = 1;
  let nextEditorConnectionSequence = 1;
  const componentNameSequences = new Map<ComponentKindName, number>();
  for (const component of document.components.values()) {
    const match = component.displayName.match(/(\d+)$/);
    const sequence = match ? Number(match[1]) : 0;
    const currentSequence = componentNameSequences.get(component.kind) ?? 0;
    componentNameSequences.set(component.kind, Math.max(currentSequence + 1, sequence));
    const editorSequence = component.id.match(/^component-(\d+)$/);
    if (editorSequence) nextEditorComponentSequence = Math.max(nextEditorComponentSequence, Number(editorSequence[1]) + 1);
  }
  for (const connection of document.connections.values()) {
    const editorSequence = connection.id.match(/^connection-(\d+)$/);
    if (editorSequence) nextEditorConnectionSequence = Math.max(nextEditorConnectionSequence, Number(editorSequence[1]) + 1);
  }

  function isLiveConnection(connection: EditorConnection): boolean {
    return connection.lifecycle === "visible" &&
      document.components.get(connection.source.componentId)?.lifecycle === "active" &&
      document.components.get(connection.target.componentId)?.lifecycle === "active";
  }

  function publishBindings(): void {
    options.onBindingsChanged?.({
      components: Object.fromEntries(
        [...document.components.values()]
          .filter((component) => component.lifecycle === "active")
          .flatMap((component) => {
            const engineId = bindings.components[component.id];
            return engineId === undefined ? [] : [[component.id, engineId]];
          }),
      ),
      connections: Object.fromEntries(
        [...document.connections.values()]
          .filter(isLiveConnection)
          .flatMap((connection) => {
            const engineId = bindings.connections[connection.id];
            return engineId === undefined ? [] : [[connection.id, engineId]];
          }),
      ),
    });
  }

  function currentSnapshot(): EditorSnapshot {
    return visibleSnapshot(document, selection, operation, undoStack, redoStack, confirmation, error, pendingPlacement);
  }

  function publish(): EditorSnapshot {
    const snapshot = currentSnapshot();
    notify(listeners, snapshot);
    return snapshot;
  }

  function fail(errorValue: EngineError): CommandResult {
    error = errorValue;
    operation = "idle";
    const snapshot = publish();
    return { ok: false, error: errorValue, snapshot };
  }

  function enterRecovery(errorValue: EngineError): CommandResult {
    error = errorValue;
    operation = "recovery-required";
    const snapshot = publish();
    return { ok: false, error: errorValue, snapshot };
  }

  function beginOperation(): boolean {
    if (operation !== "idle") return false;
    error = null;
    operation = "busy";
    publish();
    return true;
  }

  function finishOperation(): EditorSnapshot {
    operation = "idle";
    return publish();
  }

  function call<T>(action: () => Promise<EngineResult<T>>): Promise<EngineResult<T>> {
    return action().catch((thrown) => failed(normalizeThrown(thrown)));
  }

  function requireComponent(id: EditorComponentId): EditorComponent | null {
    const component = document.components.get(id);
    return component && component.lifecycle === "active" ? component : null;
  }

  function displayNameForKind(kind: ComponentKindName): string {
    const labels: Partial<Record<ComponentKindName, string>> = {
      input: "输入",
      output: "输出",
      and: "AND 门",
      or: "OR 门",
      nand: "NAND 门",
      nor: "NOR 门",
      xor: "XOR 门",
      xnor: "XNOR 门",
      not: "NOT 门",
      clock: "Clock",
      d_flip_flop: "D Flip-Flop",
    };
    return labels[kind] ?? kind;
  }

  function nextComponentIdentity(kind: ComponentKindName): { id: EditorComponentId; displayName: string } {
    const nextName = (componentNameSequences.get(kind) ?? 0) + 1;
    componentNameSequences.set(kind, nextName);
    return {
      id: `component-${nextEditorComponentSequence++}`,
      displayName: `${displayNameForKind(kind)} ${nextName}`,
    };
  }

  function componentPosition(center: Point, altKey: boolean): Point {
    return positionFromPlacementCenter(center, { width: 148, height: 84 }, altKey);
  }

  async function settleAfterStructure(): Promise<void> {
    if (!engine.settle) return;
    const settled = await call(() => engine.settle!());
    if (!settled.ok) {
      // 结构已经提交；仿真错误只作为可展示错误保留，不回滚 Component。
      error = settled.error;
    }
  }

  function makeDeleteComponentFrame(componentId: EditorComponentId): DeleteComponentFrame | null {
    const component = requireComponent(componentId);
    if (!component) return null;
    const connectionPlans = [...document.connections.values()]
      .filter(
        (connection) =>
          isLiveConnection(connection) &&
          (connection.source.componentId === componentId || connection.target.componentId === componentId),
      )
      .map((connection) => ({
        id: connection.id,
        source: { ...connection.source, point: { ...connection.source.point } },
        target: { ...connection.target, point: { ...connection.target.point } },
        ...(connection.route ? { route: connection.route.map((point) => ({ ...point })) } : {}),
      }));
    return {
      type: "delete-component",
      componentId,
      selectionBefore: selection ? { ...selection } : null,
      kind: component.kind,
      danglingConnectionIds: connectionPlans
        .map((connection) => bindings.connections[connection.id])
        .filter((id): id is EngineConnectionId => id !== undefined),
      connectionPlans,
    };
  }

  function makeClearDocumentFrame(): ClearDocumentFrame | null {
    const components = [...document.components.values()]
      .filter((component) => component.lifecycle === "active")
      .map((component) => ({ id: component.id, kind: component.kind }));
    const connections = [...document.connections.values()]
      .filter((connection) => connection.lifecycle === "visible")
      .map((connection) => ({
        id: connection.id,
        source: { ...connection.source, point: { ...connection.source.point } },
        target: { ...connection.target, point: { ...connection.target.point } },
        wasLive: isLiveConnection(connection),
      }));
    if (components.length === 0 && connections.length === 0) return null;
    return {
      type: "clear-document",
      selectionBefore: selection ? { ...selection } : null,
      components,
      connections,
    };
  }

  function hideClearDocument(frame: ClearDocumentFrame): void {
    for (const component of frame.components) setComponentDeleted(document, component.id);
    for (const connectionPlan of frame.connections) {
      const connection = document.connections.get(connectionPlan.id);
      if (!connection) continue;
      connection.lifecycle = "hidden";
      connection.hiddenReason = "pending-operation";
    }
  }

  function restoreClearDocument(frame: ClearDocumentFrame): void {
    for (const component of frame.components) restoreComponent(document, component.id);
    for (const connectionPlan of frame.connections) {
      const connection = document.connections.get(connectionPlan.id);
      if (!connection) continue;
      connection.lifecycle = "visible";
      delete connection.hiddenReason;
    }
  }

  async function compensateNewComponent(
    componentId: EngineComponentId,
    connectionIds: readonly EngineConnectionId[],
  ): Promise<EngineError | null> {
    for (const connectionId of [...connectionIds].reverse()) {
      const removed = await call(() => engine.removeConnection(connectionId));
      if (!removed.ok && !isAlreadyAbsent(removed.error)) return removed.error;
    }
    const removedComponent = await call(() => engine.removeComponent(componentId));
    return removedComponent.ok || isAlreadyAbsent(removedComponent.error)
      ? null
      : removedComponent.error;
  }

  async function compensateCreatedGraph(
    componentIds: readonly EngineComponentId[],
    connectionIds: readonly EngineConnectionId[],
  ): Promise<EngineError | null> {
    let firstError: EngineError | null = null;
    for (const connectionId of [...connectionIds].reverse()) {
      const removed = await call(() => engine.removeConnection(connectionId));
      if (!removed.ok && !isAlreadyAbsent(removed.error)) firstError ??= removed.error;
    }
    for (const componentId of [...componentIds].reverse()) {
      const removed = await call(() => engine.removeComponent(componentId));
      if (!removed.ok && !isAlreadyAbsent(removed.error)) firstError ??= removed.error;
    }
    return firstError;
  }

  async function compensateClearFailure(
    frame: ClearDocumentFrame,
    removedComponents: readonly ClearDocumentFrame["components"][number][],
    removedConnections: readonly ClearDocumentFrame["connections"][number][],
  ): Promise<EngineError | null> {
    for (const component of removedComponents) {
      const added = await call(() => engine.addComponent(component.kind));
      if (!added.ok) return added.error;
      bindings.components[component.id] = added.value.componentId;
    }
    for (const connection of removedConnections) {
      delete bindings.connections[connection.id];
      if (!connection.wasLive) continue;
      const sourceComponentId = bindings.components[connection.source.componentId];
      const targetComponentId = bindings.components[connection.target.componentId];
      if (sourceComponentId === undefined || targetComponentId === undefined) {
        return recoveryError("清空补偿所需的连接端点没有有效引擎绑定。");
      }
      const added = await call(() => engine.addConnection({
        sourceComponentId,
        sourcePort: connection.source.port,
        targetComponentId,
        targetPort: connection.target.port,
      }));
      if (!added.ok) return added.error;
      bindings.connections[connection.id] = added.value.connectionId;
    }
    restoreClearDocument(frame);
    selection = frame.selectionBefore;
    publishBindings();
    return null;
  }

  async function deleteComponent(frame: DeleteComponentFrame): Promise<CommandResult> {
    const componentEngineId = bindings.components[frame.componentId];
    if (componentEngineId === undefined) return fail(recoveryError("选中的元件没有有效引擎绑定。"));
    setComponentDeleted(document, frame.componentId);
    publish();

    const removed = await call(() => engine.removeComponent(componentEngineId));
    if (!removed.ok) {
      restoreComponent(document, frame.componentId);
      return fail(removed.error);
    }

    undoStack.push(frame);
    redoStack.length = 0;
    selection = null;
    publishBindings();
    return { ok: true, snapshot: finishOperation() };
  }

  /**
   * 通过统一 EditorSession 添加 Component；pending 仅属于交互投影，成功后才写入文档。
   * @param kind 元件类型。
   * @param center 目标世界坐标中心。
   * @param altKey 是否关闭 16 单位网格吸附。
   * @returns 添加成功后自动选中新元件的命令结果。
   */
  async function addComponentAt(kind: ComponentKindName, center: Point, altKey: boolean): Promise<CommandResult> {
    const continuePlacement = pendingPlacement?.continuous ?? false;
    const identity = pendingIdentity ?? nextComponentIdentity(kind);
    if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) {
      return fail({ code: "invalid_placement", message: "元件放置位置无效。", retryable: false });
    }
    const position = componentPosition(center, altKey);
    const component: EditorComponent = {
      id: identity.id,
      kind,
      displayName: identity.displayName,
      position,
      lifecycle: "active",
    };

    // 在请求发出前固定 pending 的身份和位置。pending 只属于交互投影，
    // 文档、绑定和历史仍要等引擎确认成功后一次性提交。
    pendingIdentity = identity;
    pendingPlacement = {
      kind,
      center: { ...center },
      altKey,
      continuous: continuePlacement,
    };
    publish();

    const added = await call(() => engine.addComponent(kind));
    if (!added.ok) {
      return fail(added.error);
    }

    // 只有引擎确认成功后才把正式节点写入 EditorDocument；等待期间仅显示 pending ghost。
    document.components.set(component.id, component);
    bindings.components[component.id] = added.value.componentId;
    await settleAfterStructure();
    undoStack.push({ type: "add-component", componentId: component.id, kind, displayName: component.displayName, position: { ...position } });
    redoStack.length = 0;
    selection = { kind: "component", id: component.id };
    pendingIdentity = null;
    pendingPlacement = continuePlacement
      ? { kind, center: null, altKey, continuous: true }
      : null;
    publishBindings();
    return { ok: true, snapshot: finishOperation() };
  }

  async function undoAddComponent(frame: AddComponentFrame): Promise<CommandResult> {
    const component = document.components.get(frame.componentId);
    if (!component || component.lifecycle !== "active") return fail(recoveryError("撤销所需的元件不存在。"));
    const engineId = bindings.components[frame.componentId];
    if (engineId === undefined) return fail(recoveryError("撤销所需的元件没有有效引擎绑定。"));
    component.lifecycle = "deleted";
    publish();
    const removed = await call(() => engine.removeComponent(engineId));
    if (!removed.ok) {
      component.lifecycle = "active";
      return fail(removed.error);
    }
    delete bindings.components[frame.componentId];
    selection = null;
    undoStack.pop();
    redoStack.push(frame);
    publishBindings();
    return { ok: true, snapshot: finishOperation() };
  }

  async function redoAddComponent(frame: AddComponentFrame): Promise<CommandResult> {
    const component = document.components.get(frame.componentId);
    if (!component) return fail(recoveryError("重做所需的元件不存在。"));
    const added = await call(() => engine.addComponent(frame.kind));
    if (!added.ok) return fail(added.error);
    component.lifecycle = "active";
    component.position = { ...frame.position };
    component.displayName = frame.displayName;
    bindings.components[frame.componentId] = added.value.componentId;
    await settleAfterStructure();
    undoStack.push(frame);
    redoStack.pop();
    selection = { kind: "component", id: frame.componentId };
    publishBindings();
    return { ok: true, snapshot: finishOperation() };
  }

  function connectionOccupied(target: ConnectionDraftPort): boolean {
    return [...document.connections.values()].some((connection) =>
      isLiveConnection(connection) &&
      connection.target.componentId === target.componentId &&
      connection.target.port === target.port,
    );
  }

  function nextConnectionIdentity(): EditorConnectionId {
    return `connection-${nextEditorConnectionSequence++}`;
  }

  function connectionFrame(
    left: ConnectionDraftPort,
    right: ConnectionDraftPort,
    route?: readonly Point[],
    waypoints?: readonly Point[],
  ): CreateConnectionFrame | EngineError {
    const targetError = validateConnectionDraftTarget(left, right, false);
    if (targetError) {
      return {
        code: targetError.code === "same-port" ? "same_port" : targetError.code === "same-direction" ? "same_direction" : targetError.code,
        message: targetError.message,
        retryable: false,
      };
    }
    const endpoints = normalizeConnectionEndpoints(left, right);
    const sourceComponent = requireComponent(endpoints.source.componentId);
    const targetComponent = requireComponent(endpoints.target.componentId);
    if (!sourceComponent || !targetComponent) {
      return { code: "component_not_found", message: "连接端点所属的元件不存在或已被删除。", retryable: false };
    }
    if (connectionOccupied(endpoints.target)) {
      return { code: "input_already_connected", message: "这个输入端口已经有有效连接。请选择空闲输入端口。", retryable: false };
    }
    const id = nextConnectionIdentity();
    const endpointSource = { componentId: endpoints.source.componentId, port: endpoints.source.port, point: { ...endpoints.source.point } };
    const endpointTarget = { componentId: endpoints.target.componentId, port: endpoints.target.port, point: { ...endpoints.target.point } };
    const suppliedRoute = route && route.length >= 2
      ? normalizeOrthogonalRoute(route)
      : createDefaultOrthogonalRoute(endpointSource.point, endpointTarget.point);
    const routeAfter = suppliedRoute.length >= 2 ? suppliedRoute : [endpointSource.point, endpointTarget.point];
    routeAfter[0] = { ...endpointSource.point };
    routeAfter[routeAfter.length - 1] = { ...endpointTarget.point };
    return {
      type: "create-connection",
      connectionId: id,
      source: endpointSource,
      target: endpointTarget,
      route: routeAfter.map((point) => ({ ...point })),
      waypoints: (waypoints ?? routeAfter.slice(1, -1)).map((point) => ({ ...point })),
      selectionBefore: selection ? { ...selection } : null,
    };
  }

  async function createConnection(frame: CreateConnectionFrame): Promise<CommandResult> {
    const sourceEngineId = bindings.components[frame.source.componentId];
    const targetEngineId = bindings.components[frame.target.componentId];
    if (sourceEngineId === undefined || targetEngineId === undefined) {
      return fail({ code: "component_not_found", message: "连接端点没有有效引擎绑定。", retryable: true });
    }
    const added = await call(() => engine.addConnection({
      sourceComponentId: sourceEngineId,
      sourcePort: frame.source.port,
      targetComponentId: targetEngineId,
      targetPort: frame.target.port,
    }));
    if (!added.ok) return fail(added.error);
    document.connections.set(frame.connectionId, {
      id: frame.connectionId,
      source: { ...frame.source, point: { ...frame.source.point } },
      target: { ...frame.target, point: { ...frame.target.point } },
      route: frame.route.map((point) => ({ ...point })),
      waypoints: frame.waypoints.map((point) => ({ ...point })),
      lifecycle: "visible",
      danglingEndpoints: [],
    });
    bindings.connections[frame.connectionId] = added.value.connectionId;
    await settleAfterStructure();
    undoStack.push(frame);
    redoStack.length = 0;
    selection = { kind: "connection", id: frame.connectionId };
    publishBindings();
    return { ok: true, snapshot: finishOperation() };
  }

  async function undoCreateConnection(frame: CreateConnectionFrame): Promise<CommandResult> {
    const connection = document.connections.get(frame.connectionId);
    const engineId = bindings.connections[frame.connectionId];
    if (!connection || connection.lifecycle !== "visible" || engineId === undefined) {
      return fail(recoveryError("撤销所需的连接不存在或没有有效引擎绑定。"));
    }
    connection.lifecycle = "hidden";
    connection.hiddenReason = "pending-operation";
    publish();
    const removed = await call(() => engine.removeConnection(engineId));
    if (!removed.ok) {
      connection.lifecycle = "visible";
      delete connection.hiddenReason;
      return fail(removed.error);
    }
    connection.lifecycle = "deleted";
    delete bindings.connections[frame.connectionId];
    selection = frame.selectionBefore;
    undoStack.pop();
    redoStack.push(frame);
    publishBindings();
    return { ok: true, snapshot: finishOperation() };
  }

  async function redoCreateConnection(frame: CreateConnectionFrame, remainingRedo: readonly HistoryFrame[]): Promise<CommandResult> {
    const connection = document.connections.get(frame.connectionId);
    if (!connection) return fail(recoveryError("重做所需的连接不存在。"));
    const sourceEngineId = bindings.components[frame.source.componentId];
    const targetEngineId = bindings.components[frame.target.componentId];
    if (sourceEngineId === undefined || targetEngineId === undefined) return fail(recoveryError("重做所需的连接端点没有有效引擎绑定。"));
    const added = await call(() => engine.addConnection({ sourceComponentId: sourceEngineId, sourcePort: frame.source.port, targetComponentId: targetEngineId, targetPort: frame.target.port }));
    if (!added.ok) return fail(added.error);
    connection.lifecycle = "visible";
    delete connection.hiddenReason;
    bindings.connections[frame.connectionId] = added.value.connectionId;
    undoStack.push(frame);
    redoStack.length = 0;
    redoStack.push(...remainingRedo);
    selection = { kind: "connection", id: frame.connectionId };
    publishBindings();
    return { ok: true, snapshot: finishOperation() };
  }

  async function deleteConnection(frame: DeleteConnectionFrame): Promise<CommandResult> {
    const connection = document.connections.get(frame.connectionId);
    if (!connection || connection.lifecycle === "deleted") return fail(noSelectionError);
    const connectionEngineId = bindings.connections[frame.connectionId];
    const wasLive = isLiveConnection(connection);
    connection.lifecycle = "hidden";
    connection.hiddenReason = "pending-operation";
    publish();

    if (connectionEngineId !== undefined) {
      const removed = await call(() => engine.removeConnection(connectionEngineId));
      if (!removed.ok) {
        connection.lifecycle = "visible";
        delete connection.hiddenReason;
        return fail(removed.error);
      }
      delete bindings.connections[frame.connectionId];
    } else if (wasLive) {
      connection.lifecycle = "visible";
      delete connection.hiddenReason;
      return fail(recoveryError("选中的有效连接没有引擎绑定。"));
    }

    connection.lifecycle = "deleted";
    delete connection.hiddenReason;
    undoStack.push(frame);
    redoStack.length = 0;
    selection = null;
    publishBindings();
    return { ok: true, snapshot: finishOperation() };
  }

  async function clearDocument(frame: ClearDocumentFrame): Promise<CommandResult> {
    for (const component of frame.components) {
      if (bindings.components[component.id] === undefined) {
        return fail(recoveryError("清空所需的元件没有有效引擎绑定。"));
      }
    }
    for (const connection of frame.connections) {
      if (connection.wasLive && bindings.connections[connection.id] === undefined) {
        return fail(recoveryError("清空所需的有效连接没有引擎绑定。"));
      }
    }

    hideClearDocument(frame);
    publish();
    const removedConnections: ClearDocumentFrame["connections"] = [];
    const removedComponents: ClearDocumentFrame["components"] = [];

    for (const connection of frame.connections) {
      if (!connection.wasLive) continue;
      const engineId = bindings.connections[connection.id];
      if (engineId === undefined) continue;
      const removed = await call(() => engine.removeConnection(engineId));
      if (!removed.ok && !isAlreadyAbsent(removed.error)) {
        const compensationError = await compensateClearFailure(frame, removedComponents, removedConnections);
        return compensationError
          ? enterRecovery(recoveryError(`清空失败且连接补偿未完成：${compensationError.message}`))
          : fail(removed.error);
      }
      removedConnections.push(connection);
      delete bindings.connections[connection.id];
    }

    for (const component of frame.components) {
      const engineId = bindings.components[component.id];
      if (engineId === undefined) {
        const compensationError = await compensateClearFailure(frame, removedComponents, removedConnections);
        return compensationError
          ? enterRecovery(recoveryError(`清空失败且元件补偿未完成：${compensationError.message}`))
          : fail(recoveryError("清空所需的元件绑定在操作期间丢失。"));
      }
      const removed = await call(() => engine.removeComponent(engineId));
      if (!removed.ok && !isAlreadyAbsent(removed.error)) {
        const compensationError = await compensateClearFailure(frame, removedComponents, removedConnections);
        return compensationError
          ? enterRecovery(recoveryError(`清空失败且元件补偿未完成：${compensationError.message}`))
          : fail(removed.error);
      }
      removedComponents.push(component);
      delete bindings.components[component.id];
    }

    for (const connectionPlan of frame.connections) {
      const connection = document.connections.get(connectionPlan.id);
      if (!connection) continue;
      connection.lifecycle = "deleted";
      delete connection.hiddenReason;
      if (connectionPlan.wasLive) delete bindings.connections[connection.id];
    }
    undoStack.push(frame);
    redoStack.length = 0;
    selection = null;
    publishBindings();
    return { ok: true, snapshot: finishOperation() };
  }

  async function undoDeleteComponent(frame: DeleteComponentFrame): Promise<CommandResult> {
    const addedComponent = await call(() => engine.addComponent(frame.kind));
    if (!addedComponent.ok) return fail(addedComponent.error);
    const newComponentId = addedComponent.value.componentId;
    const newConnectionIds: EngineConnectionId[] = [];

    for (const connection of frame.connectionPlans) {
      const sourceComponentId =
        connection.source.componentId === frame.componentId
          ? newComponentId
          : bindings.components[connection.source.componentId];
      const targetComponentId =
        connection.target.componentId === frame.componentId
          ? newComponentId
          : bindings.components[connection.target.componentId];
      if (sourceComponentId === undefined || targetComponentId === undefined) {
        const compensationError = await compensateNewComponent(newComponentId, newConnectionIds);
        return compensationError
          ? enterRecovery(compensationError)
          : fail(recoveryError("撤销所需的连接端点没有有效引擎绑定。"));
      }

      const addedConnection = await call(() =>
        engine.addConnection({
          sourceComponentId,
          sourcePort: connection.source.port,
          targetComponentId,
          targetPort: connection.target.port,
        }),
      );
      if (!addedConnection.ok) {
        const compensationError = await compensateNewComponent(newComponentId, newConnectionIds);
        return compensationError
          ? enterRecovery(compensationError)
          : fail(addedConnection.error);
      }
      newConnectionIds.push(addedConnection.value.connectionId);
    }

    let removedOldConnection = false;
    for (const oldConnectionId of frame.danglingConnectionIds) {
      const removed = await call(() => engine.removeConnection(oldConnectionId));
      if (!removed.ok && !isAlreadyAbsent(removed.error)) {
        const compensationError = await compensateNewComponent(newComponentId, newConnectionIds);
        if (compensationError) return enterRecovery(compensationError);
        return removedOldConnection
          ? enterRecovery(recoveryError("清理旧悬空连接时只完成了部分操作，需要重新加载编辑器。"))
          : fail(removed.error);
      }
      removedOldConnection = true;
    }

    bindings.components[frame.componentId] = newComponentId;
    frame.connectionPlans.forEach((connection, index) => {
      bindings.connections[connection.id] = newConnectionIds[index];
    });
    restoreComponent(document, frame.componentId);
    selection = frame.selectionBefore;
    undoStack.pop();
    redoStack.push(frame);
    publishBindings();
    return { ok: true, snapshot: finishOperation() };
  }

  async function undoDeleteConnection(frame: DeleteConnectionFrame): Promise<CommandResult> {
    const connection = document.connections.get(frame.connectionId);
    if (!connection) return fail(recoveryError("撤销所需的连接不存在。"));
    const sourceActive = document.components.get(frame.source.componentId)?.lifecycle === "active";
    const targetActive = document.components.get(frame.target.componentId)?.lifecycle === "active";
    if (!sourceActive || !targetActive) {
      connection.lifecycle = "visible";
      delete connection.hiddenReason;
      delete bindings.connections[frame.connectionId];
      selection = frame.selectionBefore;
      undoStack.pop();
      redoStack.push(frame);
      publishBindings();
      return { ok: true, snapshot: finishOperation() };
    }
    const sourceComponentId = bindings.components[frame.source.componentId];
    const targetComponentId = bindings.components[frame.target.componentId];
    if (sourceComponentId === undefined || targetComponentId === undefined) {
      return fail(recoveryError("撤销所需的连接端点没有有效引擎绑定。"));
    }
    const added = await call(() =>
      engine.addConnection({
        sourceComponentId,
        sourcePort: frame.source.port,
        targetComponentId,
        targetPort: frame.target.port,
      }),
    );
    if (!added.ok) return fail(added.error);
    bindings.connections[frame.connectionId] = added.value.connectionId;
    connection.lifecycle = "visible";
    delete connection.hiddenReason;
    selection = frame.selectionBefore;
    undoStack.pop();
    redoStack.push(frame);
    publishBindings();
    return { ok: true, snapshot: finishOperation() };
  }

  function makeMoveComponentFrame(
    componentId: EditorComponentId,
    position: Point,
  ): MoveComponentFrame | null {
    const component = requireComponent(componentId);
    if (!component) return null;
    const positionBefore = { ...component.position };
    const positionAfter = { ...position };
    const connectionsBefore = [...document.connections.values()]
      .filter((connection) =>
        connection.lifecycle === "visible" &&
        (connection.source.componentId === componentId || connection.target.componentId === componentId),
      )
      .map(cloneConnectionGeometry);
    for (const connection of connectionsBefore) {
      const current = document.connections.get(connection.id);
      if (current) updateMovedConnection(current, componentId, positionBefore, positionAfter);
    }
    component.position = positionAfter;
    const connectionsAfter = connectionsBefore
      .map(({ id }) => document.connections.get(id))
      .filter((connection): connection is EditorConnection => connection !== undefined)
      .map(cloneConnectionGeometry);
    for (const connection of connectionsBefore) restoreConnectionGeometry(document, connection);
    component.position = positionBefore;
    return {
      type: "move-component",
      componentId,
      positionBefore,
      positionAfter,
      selectionBefore: selection ? { ...selection } : null,
      connectionsBefore,
      connectionsAfter,
    };
  }

  function applyMoveFrame(frame: MoveComponentFrame, after: boolean): void {
    const component = document.components.get(frame.componentId);
    if (!component || component.lifecycle !== "active") return;
    component.position = { ...(after ? frame.positionAfter : frame.positionBefore) };
    for (const connection of after ? frame.connectionsAfter : frame.connectionsBefore) {
      restoreConnectionGeometry(document, connection);
    }
  }

  async function moveComponent(frame: MoveComponentFrame): Promise<CommandResult> {
    if (pointsEqual(frame.positionBefore, frame.positionAfter)) {
      selection = frame.selectionBefore;
      return { ok: true, snapshot: finishOperation() };
    }
    applyMoveFrame(frame, true);
    selection = { kind: "component", id: frame.componentId };
    undoStack.push(frame);
    redoStack.length = 0;
    return { ok: true, snapshot: finishOperation() };
  }

  async function undoMoveComponent(frame: MoveComponentFrame): Promise<CommandResult> {
    applyMoveFrame(frame, false);
    selection = frame.selectionBefore;
    undoStack.pop();
    redoStack.push(frame);
    return { ok: true, snapshot: finishOperation() };
  }

  async function redoMoveComponent(
    frame: MoveComponentFrame,
    remainingRedo: readonly HistoryFrame[],
  ): Promise<CommandResult> {
    applyMoveFrame(frame, true);
    selection = { kind: "component", id: frame.componentId };
    redoStack.length = 0;
    redoStack.push(...remainingRedo);
    undoStack.push(frame);
    return { ok: true, snapshot: finishOperation() };
  }

  function routePointsEqual(left: readonly Point[] | undefined, right: readonly Point[] | undefined): boolean {
    if (!left || !right) return !left && !right;
    return left.length === right.length && left.every((point, index) => pointsEqual(point, right[index]));
  }

  function clonePoints(points: readonly Point[] | undefined): readonly Point[] | undefined {
    return points?.map((point) => ({ ...point }));
  }

  function routeForConnection(connection: EditorConnection): Point[] {
    if (connection.route && connection.route.length >= 2) return connection.route.map((point) => ({ ...point }));
    return createDefaultOrthogonalRoute(connection.source.point, connection.target.point);
  }

  function routeWithEndpoints(connection: EditorConnection, route: readonly Point[]): Point[] {
    const points = route.length >= 2 ? route.map((point) => ({ ...point })) : routeForConnection(connection);
    points[0] = { ...connection.source.point };
    points[points.length - 1] = { ...connection.target.point };
    return normalizeOrthogonalRoute(points);
  }

  function makeEditRouteFrame(connection: EditorConnection, route: readonly Point[]): EditRouteFrame {
    const routeAfter = routeWithEndpoints(connection, route);
    return {
      type: "edit-route",
      connectionId: connection.id,
      routeBefore: clonePoints(connection.route),
      routeAfter,
      waypointsBefore: clonePoints(connection.waypoints),
      waypointsAfter: routeAfter.slice(1, -1).map((point) => ({ ...point })),
      selectionBefore: selection ? { ...selection } : null,
    };
  }

  function applyRouteFrame(frame: EditRouteFrame, after: boolean): void {
    const connection = document.connections.get(frame.connectionId);
    if (!connection || connection.lifecycle !== "visible") return;
    const route = after ? frame.routeAfter : frame.routeBefore;
    const waypoints = after ? frame.waypointsAfter : frame.waypointsBefore;
    if (route) connection.route = route.map((point) => ({ ...point }));
    else delete connection.route;
    if (waypoints) connection.waypoints = waypoints.map((point) => ({ ...point }));
    else delete connection.waypoints;
  }

  async function editRoute(frame: EditRouteFrame): Promise<CommandResult> {
    if (routePointsEqual(frame.routeBefore, frame.routeAfter) && routePointsEqual(frame.waypointsBefore, frame.waypointsAfter)) {
      selection = frame.selectionBefore;
      return { ok: true, snapshot: finishOperation() };
    }
    applyRouteFrame(frame, true);
    selection = { kind: "connection", id: frame.connectionId };
    undoStack.push(frame);
    redoStack.length = 0;
    return { ok: true, snapshot: finishOperation() };
  }

  async function undoEditRoute(frame: EditRouteFrame): Promise<CommandResult> {
    applyRouteFrame(frame, false);
    selection = frame.selectionBefore;
    undoStack.pop();
    redoStack.push(frame);
    return { ok: true, snapshot: finishOperation() };
  }

  async function redoEditRoute(frame: EditRouteFrame, remainingRedo: readonly HistoryFrame[]): Promise<CommandResult> {
    applyRouteFrame(frame, true);
    selection = { kind: "connection", id: frame.connectionId };
    redoStack.length = 0;
    redoStack.push(...remainingRedo);
    undoStack.push(frame);
    return { ok: true, snapshot: finishOperation() };
  }

  async function undoClearDocument(frame: ClearDocumentFrame): Promise<CommandResult> {
    const newComponentIds: EngineComponentId[] = [];
    const newConnectionIds: EngineConnectionId[] = [];
    const rollback = async (): Promise<EngineError | null> => {
      const compensationError = await compensateCreatedGraph(newComponentIds, newConnectionIds);
      if (!compensationError) {
        for (const component of frame.components) delete bindings.components[component.id];
        for (const connection of frame.connections) {
          if (connection.wasLive) delete bindings.connections[connection.id];
        }
      }
      return compensationError;
    };

    for (const component of frame.components) {
      const added = await call(() => engine.addComponent(component.kind));
      if (!added.ok) {
        const compensationError = await rollback();
        return compensationError
          ? enterRecovery(recoveryError(`撤销清空失败且补偿未完成：${compensationError.message}`))
          : fail(added.error);
      }
      bindings.components[component.id] = added.value.componentId;
      newComponentIds.push(added.value.componentId);
    }

    for (const connection of frame.connections) {
      if (!connection.wasLive) continue;
      delete bindings.connections[connection.id];
      const sourceComponentId = bindings.components[connection.source.componentId];
      const targetComponentId = bindings.components[connection.target.componentId];
      if (sourceComponentId === undefined || targetComponentId === undefined) {
        const compensationError = await rollback();
        return compensationError
          ? enterRecovery(recoveryError(`撤销清空失败且补偿未完成：${compensationError.message}`))
          : fail(recoveryError("撤销清空所需的连接端点没有有效引擎绑定。"));
      }
      const added = await call(() => engine.addConnection({
        sourceComponentId,
        sourcePort: connection.source.port,
        targetComponentId,
        targetPort: connection.target.port,
      }));
      if (!added.ok) {
        const compensationError = await rollback();
        return compensationError
          ? enterRecovery(recoveryError(`撤销清空失败且补偿未完成：${compensationError.message}`))
          : fail(added.error);
      }
      bindings.connections[connection.id] = added.value.connectionId;
      newConnectionIds.push(added.value.connectionId);
    }

    restoreClearDocument(frame);
    selection = frame.selectionBefore;
    undoStack.pop();
    redoStack.push(frame);
    publishBindings();
    return { ok: true, snapshot: finishOperation() };
  }

  async function undo(): Promise<CommandResult> {
    const frame = undoStack[undoStack.length - 1];
    if (!frame) return fail({ code: "nothing_to_undo", message: "没有可撤销的操作。", retryable: false });
    if (frame.type === "add-component") return undoAddComponent(frame);
    if (frame.type === "delete-component") return undoDeleteComponent(frame);
    if (frame.type === "clear-document") return undoClearDocument(frame);
    if (frame.type === "move-component") return undoMoveComponent(frame);
    if (frame.type === "create-connection") return undoCreateConnection(frame);
    if (frame.type === "edit-route") return undoEditRoute(frame);
    return undoDeleteConnection(frame);
  }

  async function redo(): Promise<CommandResult> {
    const frame = redoStack[redoStack.length - 1];
    if (!frame) return fail({ code: "nothing_to_redo", message: "没有可重做的操作。", retryable: false });
    const remainingRedo = redoStack.slice(0, -1);
    if (frame.type === "delete-component") {
      const refreshed = makeDeleteComponentFrame(frame.componentId);
      if (!refreshed) return fail(recoveryError("重做所需的元件不存在。"));
      const result = await deleteComponent(refreshed);
      if (result.ok) redoStack.push(...remainingRedo);
      return result;
    }
    if (frame.type === "add-component") return redoAddComponent(frame);
    if (frame.type === "clear-document") {
      const refreshed = makeClearDocumentFrame();
      if (!refreshed) return fail(recoveryError("重做清空所需的文档不存在。"));
      const result = await clearDocument(refreshed);
      if (result.ok) redoStack.push(...remainingRedo);
      return result;
    }
    if (frame.type === "move-component") return redoMoveComponent(frame, remainingRedo);
    if (frame.type === "create-connection") return redoCreateConnection(frame, remainingRedo);
    if (frame.type === "edit-route") return redoEditRoute(frame, remainingRedo);
    const connection = document.connections.get(frame.connectionId);
    if (!connection) return fail(recoveryError("重做所需的连接不存在。"));
    const result = await deleteConnection({
      ...frame,
      source: { ...connection.source },
      target: { ...connection.target },
    });
    if (result.ok) redoStack.push(...remainingRedo);
    return result;
  }

  async function dispatch(command: EditorCommand): Promise<CommandResult> {
    if (operation === "recovery-required") {
      const errorValue = error ?? recoveryError("编辑器需要重新加载后才能继续结构编辑。");
      return { ok: false, error: errorValue, snapshot: currentSnapshot() };
    }
    if (operation === "busy") {
      return { ok: false, error: busyError, snapshot: currentSnapshot() };
    }
    if (
      confirmation &&
      command.type !== "confirm-clear" &&
      command.type !== "cancel-current-operation"
    ) {
      error = confirmationPendingError;
      const snapshot = publish();
      return { ok: false, error: confirmationPendingError, snapshot };
    }

    if (command.type === "begin-placement" || command.type === "start-placement") {
      if (command.center && !Number.isFinite(command.center.x) || command.center && !Number.isFinite(command.center.y)) {
        return fail({ code: "invalid_placement", message: "元件放置位置无效。", retryable: false });
      }
      pendingPlacement = {
        kind: command.kind,
        center: command.center ? { ...command.center } : null,
        altKey: command.altKey ?? false,
        continuous: command.continuous ?? false,
      };
      pendingIdentity = null;
      error = null;
      return { ok: true, snapshot: publish() };
    }
    if (command.type === "update-placement") {
      if (!pendingPlacement) return fail({ code: "no_pending_placement", message: "当前没有待放置的元件。", retryable: false });
      if (!Number.isFinite(command.center.x) || !Number.isFinite(command.center.y)) {
        return fail({ code: "invalid_placement", message: "元件放置位置无效。", retryable: false });
      }
      pendingPlacement = { ...pendingPlacement, center: { ...command.center }, altKey: command.altKey ?? pendingPlacement.altKey };
      return { ok: true, snapshot: publish() };
    }

    if (command.type === "retry-current-operation" || command.type === "retry-placement") {
      if (!pendingPlacement?.center) {
        return fail({ code: "no_pending_placement", message: "当前没有可重试的元件放置。", retryable: false });
      }
      if (!beginOperation()) return { ok: false, error: busyError, snapshot: currentSnapshot() };
      return addComponentAt(pendingPlacement.kind, pendingPlacement.center, pendingPlacement.altKey);
    }

    if (!beginOperation()) return { ok: false, error: busyError, snapshot: currentSnapshot() };

    if (command.type === "select") {
      selection = command.selection;
      return { ok: true, snapshot: finishOperation() };
    }
    if (command.type === "move-component" || command.type === "move-node") {
      const componentId = command.type === "move-component"
        ? command.componentId
        : "nodeId" in command ? command.nodeId : command.componentId;
      const frame = makeMoveComponentFrame(componentId, command.position);
      if (!frame) return fail(noSelectionError);
      return moveComponent(frame);
    }
    if (
      command.type === "edit-route" ||
      command.type === "move-route" ||
      command.type === "move-route-waypoint" ||
      command.type === "move-route-segment" ||
      command.type === "delete-waypoint" ||
      command.type === "reset-route"
    ) {
      const connection = document.connections.get(command.connectionId);
      if (!connection || connection.lifecycle !== "visible") return fail(noSelectionError);
      const currentRoute = routeForConnection(connection);
      let nextRoute: readonly Point[];
      if (command.type === "edit-route" || command.type === "move-route") {
        nextRoute = command.route;
      } else if (command.type === "move-route-waypoint") {
        nextRoute = moveRouteWaypoint(currentRoute, command.pointIndex, command.delta, command.altKey);
      } else if (command.type === "move-route-segment") {
        nextRoute = moveRouteSegment(currentRoute, command.segmentIndex, command.offset, command.altKey);
      } else if (command.type === "delete-waypoint") {
        nextRoute = deleteRouteWaypoint(currentRoute, command.pointIndex);
      } else {
        nextRoute = resetOrthogonalRoute(connection.source.point, connection.target.point);
      }
      return editRoute(makeEditRouteFrame(connection, nextRoute));
    }
    if (command.type === "create-connection" || command.type === "add-connection") {
      const frame = connectionFrame(command.left, command.right, command.route, command.waypoints);
      if ("code" in frame) return fail(frame);
      return createConnection(frame);
    }
    if (command.type === "request-clear") {
      const frame = makeClearDocumentFrame();
      if (!frame) return fail(nothingToClearError);
      confirmation = {
        type: "clear-document",
        componentCount: frame.components.length,
        connectionCount: frame.connections.length,
      };
      return { ok: true, snapshot: finishOperation() };
    }
    if (command.type === "cancel-current-operation") {
      if (confirmation) confirmation = null;
      else if (pendingPlacement) {
        pendingPlacement = null;
        pendingIdentity = null;
        error = null;
      }
      else selection = null;
      return { ok: true, snapshot: finishOperation() };
    }
    if (command.type === "place-component" || command.type === "commit-placement" || command.type === "add-component") {
      const kind = command.type === "add-component" ? command.kind : command.kind ?? pendingPlacement?.kind;
      if (!kind) return fail({ code: "no_pending_placement", message: "当前没有待放置的元件。", retryable: false });
      const altKey = command.altKey ?? pendingPlacement?.altKey ?? false;
      const center = command.type === "add-component" ? command.position : command.center;
      const result = await addComponentAt(kind, center, altKey);
      return result;
    }
    if (command.type === "confirm-clear") {
      if (!confirmation) return fail(confirmationRequiredError);
      const frame = makeClearDocumentFrame();
      confirmation = null;
      if (!frame) return fail(nothingToClearError);
      return clearDocument(frame);
    }
    if (command.type === "undo") return undo();
    if (command.type === "redo") return redo();
    if (command.type === "delete-selected") {
      if (!selection) return fail(noSelectionError);
      if (selection.kind === "component") {
        const frame = makeDeleteComponentFrame(selection.id);
        if (!frame) return fail(noSelectionError);
        return deleteComponent(frame);
      }
      const connection = document.connections.get(selection.id);
      if (!connection) return fail(noSelectionError);
      return deleteConnection({
        type: "delete-connection",
        connectionId: selection.id,
        selectionBefore: { ...selection },
        source: { ...connection.source },
        target: { ...connection.target },
      });
    }
    if (command.type === "delete-component") {
      const frame = makeDeleteComponentFrame(command.componentId);
      if (!frame) return fail(noSelectionError);
      return deleteComponent(frame);
    }
    const connection = document.connections.get(command.connectionId);
    if (!connection) return fail(noSelectionError);
    return deleteConnection({
      type: "delete-connection",
      connectionId: command.connectionId,
      selectionBefore: selection ? { ...selection } : null,
      source: { ...connection.source },
      target: { ...connection.target },
    });
  }

  publishBindings();
  return {
    snapshot: currentSnapshot,
    dispatch,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
