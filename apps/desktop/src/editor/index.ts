import type { ComponentKindName, PortSpec } from "@circuit-platform/protocol";
import { componentGeometryFor, defaultComponentDefinitionRegistry } from "../canvas/registry.ts";
import { defaultPortsFor } from "./bus-ports.ts";
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
import type { WireColorId } from "./wire-appearance.ts";
export {
  type EditorComponentData,
  type EditorComponentKind,
  type SubcircuitComponentData,
  type SubcircuitDiagnostic,
  type SubcircuitStatus,
} from "./component.ts";
import type { EditorComponentData, EditorComponentKind } from "./component.ts";

export {
  DEFAULT_WIRE_COLOR,
  DEFAULT_WIRE_COLOR_STORAGE_KEY,
  WIRE_COLOR_PRESETS,
  isWireColorId,
  readDefaultWireColor,
  writeDefaultWireColor,
  type WireColorId,
} from "./wire-appearance.ts";

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

/** 一个顶层编辑器对象所拥有的扁平引擎 Component 身份。普通对象通常只有一个。 */
export type EngineComponentBinding = EngineComponentId | readonly EngineComponentId[];

/** 一个顶层编辑器连接所拥有的扁平引擎 Connection 身份。普通连接通常只有一个。 */
export type EngineConnectionBinding = EngineConnectionId | readonly EngineConnectionId[];

/** 扁平引擎中的端口身份；Subcircuit 的外部端口通过它投影回编辑器键空间。 */
export interface EnginePortRef {
  /** 已解析的引擎身份；局部 projection diff 也可只携带稳定 flatId。 */
  componentId?: EngineComponentId;
  /** 稳定扁平身份，由 EditorBindings.flatComponents 解析。 */
  flatId?: string;
  port: string;
}

/** 一个编辑器外部 Port 到扁平端点的来源映射。 */
export interface EditorPortSource {
  /** 外部输入 Port 展平后要驱动的全部内部目标端点。 */
  inputTargets?: readonly EnginePortRef[];
  /** 外部输出 Port 的首选内部来源端点。 */
  outputSource?: EnginePortRef;
  /** 展平器可产生多个来源；按顺序读取，等价于 readableRefs 的来源别名。 */
  outputSources?: readonly EnginePortRef[];
  /** 可读取的内部来源端点；多个来源时按顺序取第一个引擎快照中存在的值。 */
  readableRefs?: readonly EnginePortRef[];
}

export interface Point {
  x: number;
  y: number;
}

export interface EditorComponent {
  id: EditorComponentId;
  kind: EditorComponentKind;
  displayName: string;
  position: Point;
  lifecycle: "active" | "deleted";
  /** 类型扩展数据；Subcircuit 的解析元数据统一保存在这里。 */
  data?: EditorComponentData;
  /**
   * 该元件由引擎回传的端口清单，是端口名与位宽的唯一权威来源。
   *
   * 来源是 `component_added` / `port_width_set` 的响应（或推送电路时一并带回来的那一份），
   * 而不是展示定义——展示定义只描述几何与标签。省略表示引擎还没有告诉过我们这份清单：
   * 文档刚建立、尚未推送时就是这种情况，此时宁可画不出端口，也不内置一份无人校验的副本。
   */
  ports?: readonly PortSpec[];
}

/** 复制一份端口清单，避免调用方与文档共享同一个数组。 */
function clonePorts(ports: readonly PortSpec[] | undefined): readonly PortSpec[] {
  return (ports ?? []).map((port) => ({
    name: port.name,
    direction: port.direction,
    width: port.width,
    ...(port.bitRange ? { bitRange: { ...port.bitRange } } : {}),
  }));
}

function cloneComponentData(data: EditorComponentData | undefined): EditorComponentData | undefined {
  const subcircuit = data?.subcircuit;
  if (!subcircuit) return data;
  return {
    subcircuit: {
      ...subcircuit,
      cachedPorts: clonePorts(subcircuit.cachedPorts),
      ...(subcircuit.portOrder ? { portOrder: [...subcircuit.portOrder] } : {}),
      ...(subcircuit.diagnostic
        ? { diagnostic: { ...subcircuit.diagnostic, ...(subcircuit.diagnostic.chain ? { chain: [...subcircuit.diagnostic.chain] } : {}) } }
        : {}),
    },
  };
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
  /** 与信号值无关的用户外观预设；旧文档缺省时由投影层回退。 */
  color?: WireColorId;
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
  /** 可选的当前层次投影快照，用于首次替换的完整回滚与历史重做。 */
  projection?: EditorProjectionInput;
}

export interface EditorBindings {
  components: Readonly<Partial<Record<EditorComponentId, EngineComponentBinding>>>;
  connections: Readonly<Partial<Record<EditorConnectionId, EngineConnectionBinding>>>;
  /** 稳定扁平身份到当前引擎身份的映射；用于局部投影替换，不暴露给 Vue。 */
  flatComponents?: Readonly<Partial<Record<string, EngineComponentId>>>;
  flatConnections?: Readonly<Partial<Record<string, EngineConnectionId>>>;
  /** 顶层 Editor ID 所拥有的稳定扁平身份；缺省时普通对象可直接使用自身 ID。 */
  componentFlatIds?: Readonly<Partial<Record<EditorComponentId, readonly string[]>>>;
  connectionFlatIds?: Readonly<Partial<Record<EditorConnectionId, readonly string[]>>>;
  /** 用于通用仿真投影的类型元数据；不包含任何固定示例身份。 */
  componentKinds?: Readonly<Partial<Record<EditorComponentId, EditorComponentKind>>>;
  /** 每个元件的端口清单；运行时要读哪些端口由它推导，前端不再内置一份 kind → 端口名的副本。 */
  ports?: Readonly<Partial<Record<EditorComponentId, readonly PortSpec[]>>>;
  /** 顶层 Editor Component 的外部 Port 到扁平端点的来源映射。 */
  portSources?: Readonly<Partial<Record<EditorComponentId, Readonly<Partial<Record<string, EditorPortSource>>>>>>;
}

/** 展平器交给编辑器事务层的引擎平面；每个 id 都是稳定的扁平字符串身份。 */
export interface EditorFlatCircuit {
  components: readonly {
    id: string;
    kind: ComponentKindName;
    ports?: readonly PortSpec[];
  }[];
  connections: readonly {
    id: string;
    source: { componentId: string; port: string };
    target: { componentId: string; port: string };
  }[];
}

/** 一次层次投影替换的输入；源映射保持编辑器键与扁平身份解耦。 */
export interface EditorProjectionInput {
  document: EditorDocument;
  flatCircuit: EditorFlatCircuit;
  componentFlatIds: Readonly<Partial<Record<EditorComponentId, readonly string[]>>>;
  connectionFlatIds: Readonly<Partial<Record<EditorConnectionId, readonly string[]>>>;
  portSources?: Readonly<Partial<Record<EditorComponentId, Readonly<Partial<Record<string, EditorPortSource>>>>>>;
  /** 仅用于显式重载：强制替换该顶层 owner 所拥有的扁平对象。 */
  forceReplaceOwner?: EditorComponentId;
  /** 由组合层管理的不可解释版本；不参与编辑器文档序列化。 */
  revision?: string;
}

export interface EngineError {
  code: string;
  message: string;
  retryable: boolean;
  /** 错误来源；仿真失败不会使已提交的 Circuit 结构失效。 */
  category?: "structure" | "simulation";
}

export type EngineResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: EngineError };

/** 编辑器只依赖这组窄操作，协议字段和 Electron 通道由 adapter 隐藏。 */
export interface CircuitEnginePort {
  /** `ports` 省略时引擎回退到内置定义；响应带回该元件实际的端口清单。 */
  addComponent(
    kind: ComponentKindName,
    ports?: readonly PortSpec[],
  ): Promise<EngineResult<{ componentId: EngineComponentId; ports: readonly PortSpec[] }>>;
  /** 整体替换端口清单，并带回替换后的清单与因本次改宽而转为悬空的 Connection 身份。 */
  setPortWidth(
    componentId: EngineComponentId,
    ports: readonly PortSpec[],
  ): Promise<
    EngineResult<{
      ports: readonly PortSpec[];
      danglingConnectionIds: readonly EngineConnectionId[];
    }>
  >;
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
  | { type: "edit-route"; connectionId: EditorConnectionId; route: readonly Point[]; altKey?: boolean }
  | { type: "move-route-waypoint"; connectionId: EditorConnectionId; pointIndex: number; delta: Point; altKey?: boolean }
  | { type: "move-route-segment"; connectionId: EditorConnectionId; segmentIndex: number; offset: Point; altKey?: boolean }
  | { type: "delete-waypoint"; connectionId: EditorConnectionId; pointIndex: number }
  | { type: "reset-route"; connectionId: EditorConnectionId }
  | { type: "set-wire-color"; connectionId: EditorConnectionId; color: WireColorId }
  | { type: "create-connection"; left: ConnectionDraftPort; right: ConnectionDraftPort; route?: readonly Point[]; waypoints?: readonly Point[]; color?: WireColorId }
  /** 用同一个稳定 Editor Connection ID 替换连接端点，提交过程由会话补偿管理。 */
  | { type: "reconnect-connection"; connectionId: EditorConnectionId; left: ConnectionDraftPort; right: ConnectionDraftPort; route?: readonly Point[]; waypoints?: readonly Point[] }
  | { type: "begin-placement"; kind: ComponentKindName; center?: Point; altKey?: boolean; continuous?: boolean }
  | { type: "update-placement"; center: Point; altKey?: boolean }
  | { type: "place-component"; kind?: ComponentKindName; center: Point; altKey?: boolean; continuous?: boolean }
  | { type: "add-component"; kind: ComponentKindName; position: Point; altKey?: boolean; continuous?: boolean }
  /** 整份替换一个元件的端口清单；这是检查器里改位宽那条路径。 */
  | { type: "set-port-width"; componentId: EditorComponentId; ports: readonly PortSpec[] }
  | { type: "duplicate-component"; componentId: EditorComponentId }
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
  /** 最近一次自动稳定化的仿真错误；与结构事务错误分开保存。 */
  simulationError?: EngineError | null;
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
  /** 更新引擎可用性；只影响结构命令，不影响离线本地布局编辑。 */
  setEngineAvailability(available: boolean): void;
  /**
   * 用引擎重启后重建得到的绑定整体替换当前绑定；文档与撤销/重做历史原样保留。
   * 这是 `onBindingsChanged` 的反向：由组合层在「同一文档采纳新引擎」时把新绑定喂回
   * 既有会话，不重开会话，撤销栈因此不丢。它不触发 `onBindingsChanged`——新绑定此刻
   * 已经是工作区手里的那一份。
   */
  adoptBindings(bindings: EditorBindings): void;
  /** 原子替换层次展平投影；成功只提交一帧历史，失败不发布中间绑定。 */
  replaceProjection(input: EditorProjectionInput): Promise<CommandResult>;
  /** 当前层次投影快照；只读副本，不进入编辑器可见快照。 */
  projection(): EditorProjectionInput | null;
  /** 普通编辑命令已同步引擎后刷新当前投影元数据；不调用引擎、不新增历史。 */
  adoptProjection(input: EditorProjectionInput): void;
  /** Save As 后重写 Subcircuit 引用元数据；不触碰引擎、不新增历史帧。 */
  rewriteSubcircuitReferences(references: Readonly<Partial<Record<EditorComponentId, string>>>): boolean;
}

export interface EditorSessionOptions {
  /** 结构提交后发布仍然有效的运行时绑定；仅供工作区组合层同步仿真身份。 */
  onBindingsChanged?(bindings: EditorBindings): void;
  /** 返回当前引擎是否可接受 Circuit 结构事务；不进入 EditorSnapshot。 */
  isEngineAvailable?(): boolean;
  /** `engineAvailable` 是兼容性别名，便于组合层注入可用性 seam。 */
  engineAvailable?: boolean | (() => boolean);
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
  /** 捕获这批引擎 ID 时的引擎代数；代数变化后旧 ID 不再存在于当前引擎。 */
  engineGeneration: number;
  connectionPlans: Array<{
    id: EditorConnectionId;
    source: EditorConnection["source"];
    target: EditorConnection["target"];
    route?: readonly Point[];
    waypoints?: readonly Point[];
  }>;
  /** 重建这个元件时原样送回引擎的端口清单。 */
  ports?: readonly PortSpec[];
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
    ports?: readonly PortSpec[];
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
  /** 重建时原样送回引擎的端口清单：撤销再重做后端口必须与当初一模一样。 */
  ports?: readonly PortSpec[];
}

interface SetPortWidthFrame {
  type: "set-port-width";
  componentId: EditorComponentId;
  portsBefore: readonly PortSpec[];
  portsAfter: readonly PortSpec[];
  selectionBefore: EditorSelection;
}

interface CreateConnectionFrame {
  type: "create-connection";
  connectionId: EditorConnectionId;
  source: EditorConnection["source"];
  target: EditorConnection["target"];
  route: readonly Point[];
  waypoints: readonly Point[];
  color?: WireColorId;
  selectionBefore: EditorSelection;
}

interface ReconnectConnectionFrame {
  type: "reconnect-connection";
  connectionId: EditorConnectionId;
  oldSource: EditorConnection["source"];
  oldTarget: EditorConnection["target"];
  oldRoute?: readonly Point[];
  oldWaypoints?: readonly Point[];
  oldWasLive: boolean;
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

interface SetWireColorFrame {
  type: "set-wire-color";
  connectionId: EditorConnectionId;
  colorBefore?: WireColorId;
  colorAfter: WireColorId;
  selectionBefore: EditorSelection;
}

interface ReplaceProjectionFrame {
  type: "replace-projection";
  before: EditorProjectionInput;
  after: EditorProjectionInput;
  selectionBefore: EditorSelection;
}

type HistoryFrame = DeleteComponentFrame | DeleteConnectionFrame | ClearDocumentFrame | MoveComponentFrame | AddComponentFrame | SetPortWidthFrame | CreateConnectionFrame | ReconnectConnectionFrame | EditRouteFrame | SetWireColorFrame | ReplaceProjectionFrame;

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

const engineUnavailableError: EngineError = {
  code: "engine_unavailable",
  message: "仿真引擎当前不可用，请恢复连接后重试结构操作。",
  retryable: true,
  category: "structure",
};

/**
 * 传输层不可用的错误代码集合：请求没有得到协议响应（进程死亡、连接失败、超时）时
 * `CircuitEnginePort` 的实现会以这些代码报告失败。看到它们就冻结结构事务，直到可用性
 * 被显式恢复。组合层用同一份清单识别「结构事务因引擎不可用而失败」，据此发起恢复。
 */
export const ENGINE_TRANSPORT_ERROR_CODES: readonly string[] = [
  "engine_unavailable",
  "engine_offline",
  "engine_connection_failed",
];

function cloneVisibleDocument(document: MutableDocument): EditorDocument {
  const isAttached = (componentId: EditorComponentId): boolean =>
    document.components.get(componentId)?.lifecycle === "active";
  return {
    components: [...document.components.values()]
      .filter((component) => component.lifecycle === "active")
      .map((component) => ({ ...component, position: { ...component.position }, ...(component.data ? { data: cloneComponentData(component.data) } : {}) })),
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
        { ...component, position: { ...component.position }, ...(component.data ? { data: cloneComponentData(component.data) } : {}) },
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

function cloneEditorDocument(document: EditorDocument): EditorDocument {
  return {
    components: document.components.map((component) => ({
      ...component,
      position: { ...component.position },
      ...(component.data ? { data: cloneComponentData(component.data) } : {}),
      ...(component.ports ? { ports: clonePorts(component.ports) } : {}),
    })),
    connections: document.connections.map((connection) => ({
      ...connection,
      source: { ...connection.source, point: { ...connection.source.point } },
      target: { ...connection.target, point: { ...connection.target.point } },
      danglingEndpoints: [...connection.danglingEndpoints],
      ...(connection.route ? { route: connection.route.map((point) => ({ ...point })) } : {}),
      ...(connection.waypoints ? { waypoints: connection.waypoints.map((point) => ({ ...point })) } : {}),
    })),
  };
}

function cloneProjectionInput(input: EditorProjectionInput): EditorProjectionInput {
  return {
    document: cloneEditorDocument(input.document),
    flatCircuit: {
      components: input.flatCircuit.components.map((component) => ({
        ...component,
        ...(component.ports ? { ports: clonePorts(component.ports) } : {}),
      })),
      connections: input.flatCircuit.connections.map((connection) => ({
        ...connection,
        source: { ...connection.source },
        target: { ...connection.target },
      })),
    },
    componentFlatIds: Object.fromEntries(Object.entries(input.componentFlatIds).map(([id, flatIds]) => [id, flatIds ? [...flatIds] : flatIds])),
    connectionFlatIds: Object.fromEntries(Object.entries(input.connectionFlatIds).map(([id, flatIds]) => [id, flatIds ? [...flatIds] : flatIds])),
    ...(input.portSources ? { portSources: input.portSources } : {}),
    ...(input.forceReplaceOwner !== undefined ? { forceReplaceOwner: input.forceReplaceOwner } : {}),
    ...(input.revision !== undefined ? { revision: input.revision } : {}),
  };
}

/** 将顶层绑定展开为稳定、去重的扁平引擎身份。 */
export function engineComponentIds(binding: EngineComponentBinding | undefined): readonly EngineComponentId[] {
  if (binding === undefined) return [];
  return typeof binding === "number" ? [binding] : [...new Set(binding)];
}

/** 将顶层连接绑定展开为稳定、去重的扁平引擎身份。 */
export function engineConnectionIds(binding: EngineConnectionBinding | undefined): readonly EngineConnectionId[] {
  if (binding === undefined) return [];
  return typeof binding === "number" ? [binding] : [...new Set(binding)];
}

/** 普通电路操作只接受一个引擎身份；组绑定由投影层处理。 */
export function singleEngineComponentId(binding: EngineComponentBinding | undefined): EngineComponentId | undefined {
  const ids = engineComponentIds(binding);
  return ids.length === 1 ? ids[0] : undefined;
}

/** 普通电路操作只接受一个引擎身份；组绑定由投影层处理。 */
export function singleEngineConnectionId(binding: EngineConnectionBinding | undefined): EngineConnectionId | undefined {
  const ids = engineConnectionIds(binding);
  return ids.length === 1 ? ids[0] : undefined;
}

/** 历史/协议路径只接受可直接放置的普通 ComponentKindName。 */
function protocolKind(kind: EditorComponentKind): ComponentKindName {
  return kind as ComponentKindName;
}

function cloneBindings(bindings: EditorBindings): EditorBindings {
  const clonePortSources = bindings.portSources && Object.fromEntries(
    Object.entries(bindings.portSources).map(([componentId, ports]) => [
      componentId,
      ports && Object.fromEntries(Object.entries(ports).map(([port, source]) => [
        port,
        source && {
          ...(source.inputTargets ? { inputTargets: source.inputTargets.map((ref) => ({ ...ref })) } : {}),
          ...(source.outputSource ? { outputSource: { ...source.outputSource } } : {}),
          ...(source.outputSources ? { outputSources: source.outputSources.map((ref) => ({ ...ref })) } : {}),
          ...(source.readableRefs ? { readableRefs: source.readableRefs.map((ref) => ({ ...ref })) } : {}),
        },
      ])),
    ]),
  );
  return {
    components: { ...bindings.components },
    connections: { ...bindings.connections },
    ...(bindings.flatComponents ? { flatComponents: { ...bindings.flatComponents } } : {}),
    ...(bindings.flatConnections ? { flatConnections: { ...bindings.flatConnections } } : {}),
    ...(bindings.componentFlatIds ? { componentFlatIds: Object.fromEntries(Object.entries(bindings.componentFlatIds).map(([id, flatIds]) => [id, flatIds ? [...flatIds] : flatIds])) } : {}),
    ...(bindings.connectionFlatIds ? { connectionFlatIds: Object.fromEntries(Object.entries(bindings.connectionFlatIds).map(([id, flatIds]) => [id, flatIds ? [...flatIds] : flatIds])) } : {}),
    ...(bindings.componentKinds ? { componentKinds: { ...bindings.componentKinds } } : {}),
    ...(bindings.ports ? { ports: Object.fromEntries(Object.entries(bindings.ports).map(([id, ports]) => [id, ports ? clonePorts(ports) : ports])) } : {}),
    ...(clonePortSources ? { portSources: clonePortSources } : {}),
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

/**
 * 创建启动示例的编辑器文档；返回不包含引擎身份的初始可见结构。
 * 这只是普通的文档数据：它由工作区按通用路径推送到引擎，没有任何专用仿真投影。
 */
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
  simulationError: EngineError | null,
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
    simulationError: simulationError ? { ...simulationError } : null,
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
  // 历史命令只覆盖普通平面元件；层次组绑定由 Workspace 投影层消费。
  // 这里保留完整绑定形状，避免普通命令路径被迫了解层次投影的内部身份。
  const bindings: any = cloneBindings(initial.bindings);
  let lastProjection: EditorProjectionInput | null = initial.projection ? cloneProjectionInput(initial.projection) : null;
  /**
   * 引擎代数：每次整体采纳新绑定（引擎进程被更换）时递增。
   * 历史帧里保存的引擎 ID 只在它被捕获时的那一代引擎上有意义；代数不同的帧不得再按旧 ID
   * 操作当前引擎——新进程的身份从 1 重新计数，旧 ID 会恰好撞上新身份。
   */
  let engineGeneration = 0;
  // 文档自己带了端口清单就用它；否则用推送电路时 `component_added` 回传的那一份。
  // 两条路径合起来，编辑器文档里的每个元件在开始投影之前都有一份来自引擎的清单。
  for (const component of document.components.values()) {
    if (component.ports !== undefined) continue;
    const known = bindings.ports?.[component.id];
    // 只在确实拿到清单时才写下这个字段：写一个 undefined 会在文档里留下一处「有这个键但不知道值」
    // 的痕迹，而「还没有清单」与「清单是空的」本来就是两件事。
    if (known !== undefined) component.ports = known;
  }
  const listeners = new Set<(snapshot: EditorSnapshot) => void>();
  const undoStack: HistoryFrame[] = [];
  const redoStack: HistoryFrame[] = [];
  let selection: EditorSelection = null;
  let confirmation: EditorConfirmation | null = null;
  let operation: EditorSnapshot["operation"] = "idle";
  let error: EngineError | null = null;
  let simulationError: EngineError | null = null;
  let pendingPlacement: PendingPlacement | null = null;
  let pendingIdentity: { id: EditorComponentId; displayName: string } | null = null;
  let engineAvailabilityOverride: boolean | null = null;
  let nextEditorComponentSequence = 1;
  let nextEditorConnectionSequence = 1;
  const componentNameSequences = new Map<ComponentKindName, number>();

  /** 把外部采用的文档身份纳入本地分配器，避免投影替换后新增对象覆盖既有稳定 ID。 */
  function observeDocumentIdentities(): void {
    const observedKindCounts = new Map<ComponentKindName, number>();
    for (const component of document.components.values()) {
      const match = component.displayName.match(/(\d+)$/);
      const sequence = match ? Number(match[1]) : 0;
      if (component.kind !== "subcircuit") {
        const observedCount = (observedKindCounts.get(component.kind) ?? 0) + 1;
        observedKindCounts.set(component.kind, observedCount);
        const currentSequence = componentNameSequences.get(component.kind) ?? 0;
        componentNameSequences.set(component.kind, Math.max(currentSequence, observedCount, sequence));
      }
      const editorSequence = component.id.match(/^component-(\d+)$/);
      if (editorSequence) nextEditorComponentSequence = Math.max(nextEditorComponentSequence, Number(editorSequence[1]) + 1);
    }
    for (const connection of document.connections.values()) {
      const editorSequence = connection.id.match(/^connection-(\d+)$/);
      if (editorSequence) nextEditorConnectionSequence = Math.max(nextEditorConnectionSequence, Number(editorSequence[1]) + 1);
    }
  }

  observeDocumentIdentities();

  function isLiveConnection(connection: EditorConnection): boolean {
    return connection.lifecycle === "visible" &&
      document.components.get(connection.source.componentId)?.lifecycle === "active" &&
      document.components.get(connection.target.componentId)?.lifecycle === "active";
  }

  function publishBindings(): void {
    const nextBindings: EditorBindings = {
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
    };
    // 只在确实有元件带着端口清单时才发布这个字段：一个空的映射与「还不知道」在运行时
    // 是同一种情况，而留一个空对象会让绑定的形状多出一个没有信息量的键。
    const knownPorts = Object.fromEntries(
      [...document.components.values()]
        .filter((component) => component.lifecycle === "active" && component.ports !== undefined)
        .map((component) => [component.id, component.ports!]),
    );
    if (Object.keys(knownPorts).length > 0) nextBindings.ports = knownPorts;
    if (bindings.flatComponents) nextBindings.flatComponents = { ...bindings.flatComponents };
    if (bindings.flatConnections) nextBindings.flatConnections = { ...bindings.flatConnections };
    if (bindings.componentFlatIds) nextBindings.componentFlatIds = { ...bindings.componentFlatIds };
    if (bindings.connectionFlatIds) nextBindings.connectionFlatIds = { ...bindings.connectionFlatIds };
    if (bindings.portSources) nextBindings.portSources = bindings.portSources;
    Object.defineProperty(nextBindings, "componentKinds", {
      value: Object.fromEntries([...document.components.values()].map((component) => [component.id, component.kind])),
      enumerable: false,
    });
    options.onBindingsChanged?.(nextBindings);
  }

  /** 整体采用一份绑定状态；用于投影提交与补偿后引擎身份发生变化的恢复。 */
  function adoptBindingState(nextBindings: EditorBindings): void {
    bindings.components = nextBindings.components;
    bindings.connections = nextBindings.connections;
    bindings.flatComponents = nextBindings.flatComponents;
    bindings.flatConnections = nextBindings.flatConnections;
    bindings.componentFlatIds = nextBindings.componentFlatIds;
    bindings.connectionFlatIds = nextBindings.connectionFlatIds;
    bindings.componentKinds = nextBindings.componentKinds;
    bindings.ports = nextBindings.ports;
    bindings.portSources = nextBindings.portSources;
  }

  function projectionForCurrentDocument(): EditorProjectionInput {
    if (lastProjection) return cloneProjectionInput(lastProjection);
    const componentFlatIds: Record<string, readonly string[]> = {};
    const flatComponents: EditorFlatCircuit["components"] = [...document.components.values()]
      .filter((component) => component.lifecycle === "active")
      .flatMap((component) => {
        const ids: readonly string[] = bindings.componentFlatIds?.[component.id] ?? [component.id];
        componentFlatIds[component.id] = [...ids];
        return ids.map((id) => ({ id, kind: protocolKind(component.kind), ...(component.ports ? { ports: clonePorts(component.ports) } : {}) }));
      });
    const connectionFlatIds: Record<string, readonly string[]> = {};
    const flatConnections: EditorFlatCircuit["connections"] = [...document.connections.values()]
      .filter(isLiveConnection)
      .flatMap((connection) => {
        const ids: readonly string[] = bindings.connectionFlatIds?.[connection.id] ?? [connection.id];
        connectionFlatIds[connection.id] = [...ids];
        return ids.map((id) => ({
          id,
          source: { componentId: connection.source.componentId, port: connection.source.port },
          target: { componentId: connection.target.componentId, port: connection.target.port },
        }));
      });
    return {
      document: cloneEditorDocument(cloneVisibleDocument(document)),
      flatCircuit: { components: flatComponents, connections: flatConnections },
      componentFlatIds,
      connectionFlatIds,
      ...(bindings.portSources ? { portSources: bindings.portSources } : {}),
    };
  }

  function projectionBindings(
    input: EditorProjectionInput,
    flatComponents: Readonly<Record<string, EngineComponentId>>,
    flatConnections: Readonly<Record<string, EngineConnectionId>>,
  ): EditorBindings {
    const components: Record<string, EngineComponentBinding> = {};
    const connections: Record<string, EngineConnectionBinding> = {};
    for (const [editorId, flatIds] of Object.entries(input.componentFlatIds)) {
      const ids = (flatIds ?? []).map((flatId) => flatComponents[flatId]).filter((id): id is number => id !== undefined);
      if (ids.length > 0) components[editorId] = ids.length === 1 ? ids[0]! : [...new Set(ids)];
    }
    for (const [editorId, flatIds] of Object.entries(input.connectionFlatIds)) {
      const ids = (flatIds ?? []).map((flatId) => flatConnections[flatId]).filter((id): id is number => id !== undefined);
      if (ids.length > 0) connections[editorId] = ids.length === 1 ? ids[0]! : [...new Set(ids)];
    }
    const componentKinds = Object.fromEntries(input.document.components.map((component) => [component.id, component.kind]));
    const ports = Object.fromEntries(input.document.components
      .filter((component) => component.ports !== undefined)
      .map((component) => [component.id, component.ports!]));
    return {
      components,
      connections,
      flatComponents,
      flatConnections,
      componentFlatIds: input.componentFlatIds,
      connectionFlatIds: input.connectionFlatIds,
      componentKinds,
      ...(Object.keys(ports).length > 0 ? { ports } : {}),
      ...(input.portSources ? { portSources: input.portSources } : {}),
    };
  }

  async function replaceProjectionOnEngine(
    target: EditorProjectionInput,
  ): Promise<{ error: EngineError | null; rollbackError: EngineError | null }> {
    const before = lastProjection ?? projectionForCurrentDocument();
    const oldComponents = new Map((before.flatCircuit.components).map((component) => [component.id, component]));
    const newComponents = new Map(target.flatCircuit.components.map((component) => [component.id, component]));
    const oldConnections = new Map(before.flatCircuit.connections.map((connection) => [connection.id, connection]));
    const newConnections = new Map(target.flatCircuit.connections.map((connection) => [connection.id, connection]));
    const oldComponentIds: Record<string, number> = { ...(bindings.flatComponents ?? {}) };
    for (const [editorId, flatIds] of Object.entries(before.componentFlatIds)) {
      for (const [index, flatId] of (flatIds ?? []).entries()) {
        const id = (bindings.components[editorId] !== undefined ? engineComponentIds(bindings.components[editorId])[index] : undefined);
        if (id !== undefined) oldComponentIds[flatId] = id;
      }
    }
    const oldConnectionIds: Record<string, number> = { ...(bindings.flatConnections ?? {}) };
    for (const [editorId, flatIds] of Object.entries(before.connectionFlatIds)) {
      for (const [index, flatId] of (flatIds ?? []).entries()) {
        const id = (bindings.connections[editorId] !== undefined ? engineConnectionIds(bindings.connections[editorId])[index] : undefined);
        if (id !== undefined) oldConnectionIds[flatId] = id;
      }
    }
    const forced = new Set(target.forceReplaceOwner ? target.componentFlatIds[target.forceReplaceOwner] ?? [] : []);
    const replacedComponents = new Set<string>(forced);
    const sameConnection = (left: EditorFlatCircuit["connections"][number], right: EditorFlatCircuit["connections"][number]) =>
      left.source.componentId === right.source.componentId && left.source.port === right.source.port &&
      left.target.componentId === right.target.componentId && left.target.port === right.target.port;
    const removedConnectionIds = [...oldConnections.values()]
      .filter((connection) => !newConnections.has(connection.id) ||
        replacedComponents.has(connection.source.componentId) || replacedComponents.has(connection.target.componentId) ||
        (newConnections.has(connection.id) && !sameConnection(connection, newConnections.get(connection.id)!)));
    const addedConnectionIds = [...newConnections.values()]
      .filter((connection) => !oldConnections.has(connection.id) || removedConnectionIds.some((old) => old.id === connection.id));
    const removedComponentValues = [...oldComponents.values()].filter((component) => !newComponents.has(component.id) || forced.has(component.id));
    const addedComponentValues = [...newComponents.values()].filter((component) => !oldComponents.has(component.id) || forced.has(component.id));
    const nextComponents: Record<string, number> = { ...oldComponentIds };
    const nextConnections: Record<string, number> = { ...oldConnectionIds };
    const createdComponents: number[] = [];
    const createdConnections: number[] = [];
    const removedComponents: EditorFlatCircuit["components"][number][] = [];
    const removedConnections: EditorFlatCircuit["connections"][number][] = [];
    const rollback = async (): Promise<EngineError | null> => {
      for (const id of [...createdConnections].reverse()) {
        const result = await call(() => engine.removeConnection(id));
        if (!result.ok && !isAlreadyAbsent(result.error)) return result.error;
      }
      for (const id of [...createdComponents].reverse()) {
        const result = await call(() => engine.removeComponent(id));
        if (!result.ok && !isAlreadyAbsent(result.error)) return result.error;
      }
      for (const component of removedComponents) {
        const result = await call(() => engine.addComponent(component.kind, component.ports));
        if (!result.ok) return result.error;
        nextComponents[component.id] = result.value.componentId;
      }
      for (const connection of removedConnections) {
        const sourceComponentId = nextComponents[connection.source.componentId];
        const targetComponentId = nextComponents[connection.target.componentId];
        if (sourceComponentId === undefined || targetComponentId === undefined) return recoveryError(`回滚连接 ${connection.id} 的端点没有有效引擎身份。`);
        const result = await call(() => engine.addConnection({ sourceComponentId, sourcePort: connection.source.port, targetComponentId, targetPort: connection.target.port }));
        if (!result.ok) return result.error;
        nextConnections[connection.id] = result.value.connectionId;
      }
      if (removedComponents.length > 0 || removedConnections.length > 0) {
        // 补偿重建会得到新的数字身份；可见文档保持旧投影，但内部绑定必须同步切换，
        // 否则下一条命令会拿已删除的旧 ID 操作引擎。这里只发布绑定，不发布中间文档快照。
        adoptBindingState(projectionBindings(before, nextComponents, nextConnections));
        publishBindings();
      }
      return null;
    };
    for (const connection of [...removedConnectionIds].reverse()) {
      const id = oldConnectionIds[connection.id];
      if (id === undefined) continue;
      const result = await call(() => engine.removeConnection(id));
      if (!result.ok && !isAlreadyAbsent(result.error)) {
        const compensation = await rollback();
        return { error: result.error, rollbackError: compensation };
      }
      delete nextConnections[connection.id];
      removedConnections.push(connection);
    }
    for (const component of [...removedComponentValues].reverse()) {
      const id = oldComponentIds[component.id];
      if (id === undefined) continue;
      const result = await call(() => engine.removeComponent(id));
      if (!result.ok && !isAlreadyAbsent(result.error)) {
        const compensation = await rollback();
        return { error: result.error, rollbackError: compensation };
      }
      delete nextComponents[component.id];
      removedComponents.push(component);
    }
    for (const component of addedComponentValues) {
      const result = await call(() => engine.addComponent(component.kind, component.ports));
      if (!result.ok) {
        const compensation = await rollback();
        return { error: result.error, rollbackError: compensation };
      }
      nextComponents[component.id] = result.value.componentId;
      createdComponents.push(result.value.componentId);
    }
    for (const connection of addedConnectionIds) {
      const sourceComponentId = nextComponents[connection.source.componentId];
      const targetComponentId = nextComponents[connection.target.componentId];
      if (sourceComponentId === undefined || targetComponentId === undefined) {
        const compensation = await rollback();
        return { error: recoveryError(`扁平连接 ${connection.id} 的端点没有有效引擎身份。`), rollbackError: compensation };
      }
      const result = await call(() => engine.addConnection({ sourceComponentId, sourcePort: connection.source.port, targetComponentId, targetPort: connection.target.port }));
      if (!result.ok) {
        const compensation = await rollback();
        return { error: result.error, rollbackError: compensation };
      }
      nextConnections[connection.id] = result.value.connectionId;
      createdConnections.push(result.value.connectionId);
    }
    // 到这里引擎已完成新投影；旧文档、绑定和历史仍未发布。
    document.components.clear();
    for (const component of toMutableDocument(target.document).components.values()) document.components.set(component.id, component);
    document.connections.clear();
    for (const connection of toMutableDocument(target.document).connections.values()) document.connections.set(connection.id, connection);
    observeDocumentIdentities();
    const nextBindings = projectionBindings(target, nextComponents, nextConnections);
    adoptBindingState(nextBindings);
    lastProjection = cloneProjectionInput(target);
    return { error: null, rollbackError: null };
  }

  async function replaceProjectionTransaction(input: EditorProjectionInput): Promise<CommandResult> {
    const target = cloneProjectionInput(input);
    const result = await replaceProjectionOnEngine(target);
    if (result.error !== null) {
      return result.rollbackError
        ? enterRecovery(recoveryError(`替换层次投影失败且回滚未完成：${result.rollbackError.message}`))
        : fail(result.error);
    }
    await settleAfterStructure();
    publishBindings();
    return { ok: true, snapshot: finishOperation() };
  }

  async function replaceProjection(input: EditorProjectionInput): Promise<CommandResult> {
    if (operation === "recovery-required") {
      return { ok: false, error: error ?? recoveryError("编辑器需要恢复后才能替换层次投影。"), snapshot: currentSnapshot() };
    }
    if (operation === "busy") return { ok: false, error: busyError, snapshot: currentSnapshot() };
    if (!isEngineAvailable()) return structureUnavailable();
    if (!beginOperation()) return { ok: false, error: busyError, snapshot: currentSnapshot() };
    const before = cloneProjectionInput(lastProjection ?? projectionForCurrentDocument());
    const result = await replaceProjectionTransaction(input);
    if (result.ok) {
      // 强制 owner 替换时，撤销也必须重新建立该 owner 的身份；旧引擎身份不可复用。
      const historyBefore = input.forceReplaceOwner === undefined
        ? before
        : { ...before, forceReplaceOwner: input.forceReplaceOwner };
      undoStack.push({ type: "replace-projection", before: historyBefore, after: cloneProjectionInput(input), selectionBefore: selection ? { ...selection } : null });
      redoStack.length = 0;
      return { ok: true, snapshot: publish() };
    }
    return result;
  }

  async function undoReplaceProjection(frame: ReplaceProjectionFrame): Promise<CommandResult> {
    const result = await replaceProjectionTransaction(frame.before);
    if (!result.ok) return result;
    selection = frame.selectionBefore;
    undoStack.pop();
    redoStack.push(frame);
    return { ok: true, snapshot: publish() };
  }

  async function redoReplaceProjection(frame: ReplaceProjectionFrame, remainingRedo: readonly HistoryFrame[]): Promise<CommandResult> {
    const result = await replaceProjectionTransaction(frame.after);
    if (!result.ok) return result;
    redoStack.length = 0;
    redoStack.push(...remainingRedo);
    undoStack.push(frame);
    return { ok: true, snapshot: publish() };
  }

  function rewriteProjectionReferences(input: EditorProjectionInput, references: Readonly<Partial<Record<EditorComponentId, string>>>): void {
    for (const [componentId, reference] of Object.entries(references)) {
      if (reference === undefined) continue;
      const component = input.document.components.find((candidate) => candidate.id === componentId);
      if (!component || component.kind !== "subcircuit" || component.data?.subcircuit === undefined) continue;
      component.data = {
        ...component.data,
        subcircuit: { ...component.data.subcircuit, reference },
      };
    }
  }

  function rewriteSubcircuitReferences(
    references: Readonly<Partial<Record<EditorComponentId, string>>>,
  ): boolean {
    const entries = Object.entries(references).filter((entry): entry is [string, string] => entry[1] !== undefined);
    for (const [componentId] of entries) {
      const component = document.components.get(componentId);
      if (!component || component.kind !== "subcircuit" || component.data?.subcircuit === undefined) return false;
    }
    if (entries.length === 0) return true;
    for (const [componentId, reference] of entries) {
      const component = document.components.get(componentId)!;
      component.data = {
        ...component.data,
        subcircuit: { ...component.data!.subcircuit!, reference },
      };
    }
    if (lastProjection) rewriteProjectionReferences(lastProjection, references);
    for (const frame of [...undoStack, ...redoStack]) {
      if (frame.type !== "replace-projection") continue;
      rewriteProjectionReferences(frame.before, references);
      rewriteProjectionReferences(frame.after, references);
    }
    publish();
    return true;
  }

  function currentSnapshot(): EditorSnapshot {
    return visibleSnapshot(document, selection, operation, undoStack, redoStack, confirmation, error, simulationError, pendingPlacement);
  }

  function publish(): EditorSnapshot {
    const snapshot = currentSnapshot();
    notify(listeners, snapshot);
    return snapshot;
  }

  function fail(errorValue: EngineError): CommandResult {
    const structureError = { ...errorValue, category: errorValue.category ?? "structure" as const };
    error = structureError;
    operation = "idle";
    const snapshot = publish();
    return { ok: false, error: structureError, snapshot };
  }

  function enterRecovery(errorValue: EngineError): CommandResult {
    const recovery = { ...errorValue, category: errorValue.category ?? "structure" as const };
    error = recovery;
    operation = "recovery-required";
    const snapshot = publish();
    return { ok: false, error: recovery, snapshot };
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
    return action()
      .catch((thrown): EngineResult<T> => failed<T>(normalizeThrown(thrown)))
      .then((result) => {
        // 传输/进程故障会冻结后续 Circuit 事务；协议业务拒绝仍可直接重试。
        if (!result.ok && ENGINE_TRANSPORT_ERROR_CODES.includes(result.error.code)) {
          engineAvailabilityOverride = false;
        }
        return result;
      });
  }

  function isEngineAvailable(): boolean {
    if (engineAvailabilityOverride !== null) return engineAvailabilityOverride;
    if (options.isEngineAvailable) return options.isEngineAvailable();
    if (typeof options.engineAvailable === "function") return options.engineAvailable();
    if (typeof options.engineAvailable === "boolean") return options.engineAvailable;
    return true;
  }

  function structureUnavailable(): CommandResult {
    return fail({ ...engineUnavailableError });
  }

  function isCircuitHistoryFrame(frame: HistoryFrame | undefined): boolean {
    return frame !== undefined && frame.type !== "move-component" && frame.type !== "edit-route" && frame.type !== "set-wire-color";
  }

  /** 仅阻止会改变 C++ Circuit 的命令，离线时仍可编辑本地几何和视口。 */
  function changesCircuit(command: EditorCommand): boolean {
    if (["add-component", "place-component", "duplicate-component", "delete-component", "delete-connection", "create-connection", "reconnect-connection", "set-port-width", "confirm-clear", "retry-placement", "retry-current-operation"].includes(command.type)) return true;
    if (command.type === "delete-selected") return selection !== null;
    if (command.type === "undo" || command.type === "redo") {
      return operation === "recovery-required" || isCircuitHistoryFrame(command.type === "undo" ? undoStack.at(-1) : redoStack.at(-1));
    }
    return false;
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
      splitter: "拆线器",
      merger: "合线器",
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

  /**
   * 放置位置由展示定义里的尺寸推出，而不是一个写死的 148 × 84。
   *
   * 端口数量由数据决定的元件（拆线器、合线器）高度按端口数增长，写死的尺寸会让「点在哪、
   * 元件落在哪」差出半个高度，而且与放置预览画出的那个盒子对不上。
   *
   * 正常路径上尺寸一律来自 `componentGeometryFor`；兜底的那个 148 × 84 只在展示定义查不到时
   * 生效——那意味着调用方绕过了注册表，画布本来也画不出这个元件，这里只是让位置仍然算得出来。
   */
  function componentPosition(
    kind: ComponentKindName,
    center: Point,
    ports: readonly PortSpec[],
    altKey: boolean,
  ): Point {
    const definition = defaultComponentDefinitionRegistry.get(kind);
    const size = definition
      ? componentGeometryFor(definition, ports).size
      : { width: 148, height: 84 };
    return positionFromPlacementCenter(center, size, altKey);
  }

  async function settleAfterStructure(): Promise<void> {
    if (!engine.settle) {
      simulationError = null;
      return;
    }
    const settled = await call(() => engine.settle!());
    if (!settled.ok) {
      // 结构已经提交；仿真错误只作为可展示错误保留，不回滚 Circuit。
      simulationError = { ...settled.error, category: "simulation" };
      return;
    }
    simulationError = null;
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
        ...(connection.waypoints ? { waypoints: connection.waypoints.map((point) => ({ ...point })) } : {}),
      }));
    return {
      type: "delete-component",
      componentId,
      selectionBefore: selection ? { ...selection } : null,
      kind: protocolKind(component.kind),
      ports: clonePorts(component.ports),
      danglingConnectionIds: connectionPlans
        .flatMap((connection) => engineConnectionIds(bindings.connections[connection.id])),
      engineGeneration,
      connectionPlans,
    };
  }

  function makeClearDocumentFrame(): ClearDocumentFrame | null {
    const components = [...document.components.values()]
      .filter((component) => component.lifecycle === "active")
      .map((component) => ({ id: component.id, kind: protocolKind(component.kind), ports: clonePorts(component.ports) }));
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
      const added = await call(() => engine.addComponent(protocolKind(component.kind), component.ports));
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
    await settleAfterStructure();
    return { ok: true, snapshot: finishOperation() };
  }

  /**
   * 通过统一 EditorSession 添加 Component；pending 仅属于交互投影，成功后才写入文档。
   * @param kind 元件类型。
   * @param center 目标世界坐标中心。
   * @param altKey 是否关闭 16 单位网格吸附。
   * @returns 添加成功后自动选中新元件的命令结果。
   */
  async function addComponentAt(
    kind: ComponentKindName,
    center: Point,
    altKey: boolean,
    continuousOverride?: boolean,
  ): Promise<CommandResult> {
    const continuePlacement = continuousOverride ?? pendingPlacement?.continuous ?? false;
    const identity = pendingIdentity ?? nextComponentIdentity(kind);
    if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) {
      return fail({ code: "invalid_placement", message: "元件放置位置无效。", retryable: false });
    }
    // 拆线器与合线器的端口清单由前端生成并随请求发出——引擎没有它们的形状可回退。默认是
    // 8 位宿主总线拆成八条 1 位分支，因此放下即可用；内置类型仍然省略清单，由引擎回退。
    const ports = defaultPortsFor(kind);
    const position = componentPosition(kind, center, ports ?? [], altKey);
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

    const added = await call(() =>
      ports === null ? engine.addComponent(kind) : engine.addComponent(kind, ports),
    );
    if (!added.ok) {
      return fail(added.error);
    }

    // 只有引擎确认成功后才把正式节点写入 EditorDocument；等待期间仅显示 pending ghost。
    // 端口清单来自响应，前端因此不需要为内置元件预先写一份。
    component.ports = clonePorts(added.value.ports);
    document.components.set(component.id, component);
    bindings.components[component.id] = added.value.componentId;
    await settleAfterStructure();
    undoStack.push({ type: "add-component", componentId: component.id, kind, displayName: component.displayName, position: { ...position }, ports: clonePorts(component.ports) });
    redoStack.length = 0;
    selection = { kind: "component", id: component.id };
    pendingIdentity = null;
    pendingPlacement = continuePlacement
      ? { kind, center: null, altKey, continuous: true }
      : null;
    publishBindings();
    return { ok: true, snapshot: finishOperation() };
  }

  /**
   * 用一份新清单整体替换元件的端口清单；检查器里改位宽走的就是这条路径。
   *
   * 这是一次可撤销的结构提交，`engine.setPortWidth` 排在共享的引擎调用队列里，因此不会与
   * 推进交错。提交失败时保留原端口清单并给出可展示的原因；成功时代入引擎回传的清单——
   * 引擎可能对清单做了规范化，调用方不必自己猜结果。
   * @param componentId 要改端口清单的稳定编辑器元件 ID。
   * @param ports 替换后的整份端口清单。
   * @returns 成功后自动选中该元件的命令结果。
   */
  async function setPortWidth(
    componentId: EditorComponentId,
    ports: readonly PortSpec[],
  ): Promise<CommandResult> {
    const component = requireComponent(componentId);
    if (!component) return fail(noSelectionError);
    const engineId = bindings.components[componentId];
    if (engineId === undefined) return fail(recoveryError("改位宽所需的元件没有有效引擎绑定。"));

    const portsBefore = clonePorts(component.ports);
    const updated = await call(() => engine.setPortWidth(engineId, ports));
    if (!updated.ok) return fail(updated.error);

    component.ports = clonePorts(updated.value.ports);
    await settleAfterStructure();
    undoStack.push({
      type: "set-port-width",
      componentId,
      portsBefore,
      portsAfter: clonePorts(component.ports),
      selectionBefore: selection ? { ...selection } : null,
    });
    redoStack.length = 0;
    selection = { kind: "component", id: componentId };
    publishBindings();
    return { ok: true, snapshot: finishOperation() };
  }

  /** 把端口清单写回文档并同步引擎；撤销与重做共用这一段，两边因此不会各自实现一遍。 */
  async function applyPortWidthFrame(frame: SetPortWidthFrame, useAfter: boolean): Promise<CommandResult> {
    const component = document.components.get(frame.componentId);
    if (!component) return fail(recoveryError("改位宽所需的元件不存在。"));
    const engineId = bindings.components[frame.componentId];
    if (engineId === undefined) return fail(recoveryError("改位宽所需的元件没有有效引擎绑定。"));

    const target = useAfter ? frame.portsAfter : frame.portsBefore;
    const updated = await call(() => engine.setPortWidth(engineId, target));
    if (!updated.ok) return fail(updated.error);
    component.ports = clonePorts(updated.value.ports);
    return { ok: true, snapshot: currentSnapshot() };
  }

  async function undoSetPortWidth(frame: SetPortWidthFrame): Promise<CommandResult> {
    const applied = await applyPortWidthFrame(frame, false);
    if (!applied.ok) return applied;
    selection = frame.selectionBefore;
    undoStack.pop();
    redoStack.push(frame);
    await settleAfterStructure();
    publishBindings();
    return { ok: true, snapshot: finishOperation() };
  }

  async function redoSetPortWidth(
    frame: SetPortWidthFrame,
    remainingRedo: readonly HistoryFrame[],
  ): Promise<CommandResult> {
    const applied = await applyPortWidthFrame(frame, true);
    if (!applied.ok) return applied;
    selection = { kind: "component", id: frame.componentId };
    redoStack.length = 0;
    redoStack.push(...remainingRedo);
    undoStack.push(frame);
    await settleAfterStructure();
    publishBindings();
    return { ok: true, snapshot: finishOperation() };
  }

  /**
   * 复制一个 CircuitNode 的结构身份，不复制连接、路线、选择或信号状态。
   * @param componentId 要复制的稳定编辑器元件 ID。
   * @returns 创建成功后选中新副本的命令结果；引擎失败时保留原文档和历史。
   */
  async function duplicateComponent(componentId: EditorComponentId): Promise<CommandResult> {
    const source = requireComponent(componentId);
    if (!source) return fail(noSelectionError);
    const identity = nextComponentIdentity(protocolKind(source.kind));
    const position = { x: source.position.x + 32, y: source.position.y + 32 };
    const added = await call(() => engine.addComponent(protocolKind(source.kind), source.ports));
    if (!added.ok) return fail(added.error);

    const component: EditorComponent = {
      id: identity.id,
      kind: protocolKind(source.kind),
      displayName: identity.displayName,
      position,
      lifecycle: "active",
      ports: clonePorts(added.value.ports),
    };
    document.components.set(component.id, component);
    bindings.components[component.id] = added.value.componentId;
    await settleAfterStructure();
    undoStack.push({
      type: "add-component",
      componentId: component.id,
      kind: protocolKind(component.kind),
      displayName: component.displayName,
      position: { ...position },
      ports: clonePorts(component.ports),
    });
    redoStack.length = 0;
    selection = { kind: "component", id: component.id };
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
    await settleAfterStructure();
    return { ok: true, snapshot: finishOperation() };
  }

  async function redoAddComponent(frame: AddComponentFrame): Promise<CommandResult> {
    const component = document.components.get(frame.componentId);
    if (!component) return fail(recoveryError("重做所需的元件不存在。"));
    const added = await call(() => engine.addComponent(frame.kind, frame.ports));
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
    color?: WireColorId,
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
      color,
      selectionBefore: selection ? { ...selection } : null,
    };
  }

  function reconnectFrame(
    connectionId: EditorConnectionId,
    left: ConnectionDraftPort,
    right: ConnectionDraftPort,
    route?: readonly Point[],
    waypoints?: readonly Point[],
  ): ReconnectConnectionFrame | EngineError {
    const connection = document.connections.get(connectionId);
    if (!connection || connection.lifecycle === "deleted") {
      return { code: "connection_not_found", message: "要重接的连接不存在。", retryable: false };
    }
    const oldSource = cloneEndpoint(connection.source);
    const oldTarget = cloneEndpoint(connection.target);
    const oldDangling = new Set<EditorEndpointSide>();
    if (!requireComponent(oldSource.componentId)) oldDangling.add("source");
    if (!requireComponent(oldTarget.componentId)) oldDangling.add("target");
    const leftIsActive = requireComponent(left.componentId) !== null;
    const rightIsActive = requireComponent(right.componentId) !== null;
    const endpoints = normalizeConnectionEndpoints(left, right);
    let source = { componentId: endpoints.source.componentId, port: endpoints.source.port, point: { ...endpoints.source.point } };
    let target = { componentId: endpoints.target.componentId, port: endpoints.target.port, point: { ...endpoints.target.point } };

    // 拖动冻结的 source/target 端点时，两端方向相同；新端点只替换对应悬空侧，另一侧继续沿用旧连接。
    if (oldDangling.has("source") && left.direction === "output" && right.direction === "output") {
      const replacement = leftIsActive ? left : rightIsActive ? right : null;
      if (!replacement) return { code: "component_not_found", message: "修复连接需要一个仍然存在的输出端口。", retryable: false };
      source = { componentId: replacement.componentId, port: replacement.port, point: { ...replacement.point } };
      target = cloneEndpoint(oldTarget);
    } else if (oldDangling.has("target") && left.direction === "input" && right.direction === "input") {
      const replacement = leftIsActive ? left : rightIsActive ? right : null;
      if (!replacement) return { code: "component_not_found", message: "修复连接需要一个仍然存在的输入端口。", retryable: false };
      source = cloneEndpoint(oldSource);
      target = { componentId: replacement.componentId, port: replacement.port, point: { ...replacement.point } };
    } else {
      const targetError = validateConnectionDraftTarget(left, right, false);
      if (targetError) {
        return { code: targetError.code === "same-port" ? "same_port" : targetError.code === "same-direction" ? "same_direction" : targetError.code, message: targetError.message, retryable: false };
      }
      if (!leftIsActive || !rightIsActive) {
        return { code: "component_not_found", message: "重接端点所属的元件不存在或已被删除。", retryable: false };
      }
      // 允许把一个 live 连接的输入端重新接到新的来源；旧连接本身不计入占用判断。
      if ([...document.connections.values()].some((candidate) => candidate.id !== connectionId && isLiveConnection(candidate) && candidate.target.componentId === endpoints.target.componentId && candidate.target.port === endpoints.target.port)) {
        return { code: "input_already_connected", message: "目标输入端口已被另一条有效连接占用。", retryable: false };
      }
    }
    if (!requireComponent(source.componentId) || !requireComponent(target.componentId)) {
      return { code: "component_not_found", message: "重接端点所属的元件不存在或已被删除。", retryable: false };
    }
    const normalizedRoute = route && route.length >= 2 ? normalizeOrthogonalRoute(route) : createDefaultOrthogonalRoute(source.point, target.point);
    const routeAfter = (normalizedRoute.length >= 2 ? normalizedRoute : [source.point, target.point]).map((point) => ({ ...point }));
    routeAfter[0] = { ...source.point };
    routeAfter[routeAfter.length - 1] = { ...target.point };
    return {
      type: "reconnect-connection",
      connectionId,
      oldSource,
      oldTarget,
      oldRoute: connection.route?.map((point) => ({ ...point })),
      oldWaypoints: connection.waypoints?.map((point) => ({ ...point })),
      oldWasLive: isLiveConnection(connection),
      source,
      target,
      route: routeAfter,
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
      ...(frame.color ? { color: frame.color } : {}),
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

  function applyReconnectGeometry(frame: ReconnectConnectionFrame, useNew: boolean): void {
    const connection = document.connections.get(frame.connectionId);
    if (!connection) return;
    const source = useNew ? frame.source : frame.oldSource;
    const target = useNew ? frame.target : frame.oldTarget;
    connection.source = cloneEndpoint(source);
    connection.target = cloneEndpoint(target);
    const route = useNew ? frame.route : frame.oldRoute;
    const waypoints = useNew ? frame.waypoints : frame.oldWaypoints;
    if (route) connection.route = route.map((point) => ({ ...point }));
    else delete connection.route;
    if (waypoints) connection.waypoints = waypoints.map((point) => ({ ...point }));
    else delete connection.waypoints;
    connection.lifecycle = "visible";
    delete connection.hiddenReason;
  }

  /**
   * 以补偿事务替换一条 Connection 的端点；旧 Wire 在整个异步事务期间保持可见。
   * @param frame 重接前后的编辑器几何与稳定连接身份。
   * @param redo 是否按重做方向执行（当前连接已是旧几何）。
   * @returns 成功后的结果；补偿失败时进入 recovery-required。
   */
  async function reconnectConnection(frame: ReconnectConnectionFrame, undoDirection = false, redoHistory = false): Promise<CommandResult> {
    const connection = document.connections.get(frame.connectionId);
    if (!connection) return fail(recoveryError("重接所需的连接不存在。"));
    const currentIsNew = undoDirection;
    const currentWasLive = currentIsNew || frame.oldWasLive;
    const currentSource = currentIsNew ? frame.source : frame.oldSource;
    const currentTarget = currentIsNew ? frame.target : frame.oldTarget;
    const currentEngineId = bindings.connections[frame.connectionId];
    const currentSourceId = bindings.components[currentSource.componentId];
    const currentTargetId = bindings.components[currentTarget.componentId];
    const desiredSource = currentIsNew ? frame.oldSource : frame.source;
    const desiredTarget = currentIsNew ? frame.oldTarget : frame.target;
    const desiredSourceId = bindings.components[desiredSource.componentId];
    const desiredTargetId = bindings.components[desiredTarget.componentId];
    const oldBinding = currentEngineId;

    // 当前有效连接必须先解绑，才能满足引擎的单输入规则；Wire 的编辑器投影不隐藏。
    if (currentWasLive && currentEngineId !== undefined) {
      const removed = await call(() => engine.removeConnection(currentEngineId));
      if (!removed.ok && !isAlreadyAbsent(removed.error)) return fail(removed.error);
      delete bindings.connections[frame.connectionId];
    } else if (currentWasLive && currentEngineId === undefined) {
      return fail(recoveryError("重接所需的有效连接没有引擎绑定。"));
    }

    const desiredWasLive = undoDirection ? frame.oldWasLive : true;
    const desiredCanExist = desiredSourceId !== undefined && desiredTargetId !== undefined;
    let added: EngineResult<{ connectionId: EngineConnectionId }> | null = null;
    if (desiredWasLive && desiredCanExist) {
      added = await call(() => engine.addConnection({
        sourceComponentId: desiredSourceId!,
        sourcePort: desiredSource.port,
        targetComponentId: desiredTargetId!,
        targetPort: desiredTarget.port,
      }));
    }
    if (desiredWasLive && (!added || !added.ok)) {
      // 新连接失败时恢复旧有效连接；悬空旧连接则仍保留本地投影和原有绑定。
      if (currentWasLive && currentSourceId !== undefined && currentTargetId !== undefined) {
        const restored = await call(() => engine.addConnection({
          sourceComponentId: currentSourceId,
          sourcePort: currentSource.port,
          targetComponentId: currentTargetId,
          targetPort: currentTarget.port,
        }));
        if (!restored.ok) return enterRecovery(recoveryError(`重接失败且旧连接补偿未完成：${restored.error.message}`));
        bindings.connections[frame.connectionId] = restored.value.connectionId;
      } else if (oldBinding !== undefined && !currentWasLive) {
        bindings.connections[frame.connectionId] = oldBinding;
      }
      return fail(added?.error ?? recoveryError("重接端点没有有效引擎绑定。"));
    }

    const newEngineId = added?.ok ? added.value.connectionId : undefined;
    if (!currentWasLive && currentEngineId !== undefined) {
      if (newEngineId === undefined) return enterRecovery(recoveryError("重接补偿缺少新连接身份。"));
      const removed = await call(() => engine.removeConnection(currentEngineId));
      if (!removed.ok && !isAlreadyAbsent(removed.error)) {
        const compensated = await call(() => engine.removeConnection(newEngineId));
        if (!compensated.ok && !isAlreadyAbsent(compensated.error)) return enterRecovery(recoveryError(`重接完成后清理旧悬空连接失败，且新连接补偿未完成：${compensated.error.message}`));
        bindings.connections[frame.connectionId] = oldBinding!;
        return fail(removed.error);
      }
    }
    if (newEngineId === undefined) delete bindings.connections[frame.connectionId];
    else bindings.connections[frame.connectionId] = newEngineId;
    applyReconnectGeometry(frame, !undoDirection);
    selection = { kind: "connection", id: frame.connectionId };
    if (!undoDirection && !redoHistory) {
      undoStack.push(frame);
      redoStack.length = 0;
    }
    await settleAfterStructure();
    publishBindings();
    return { ok: true, snapshot: finishOperation() };
  }

  async function undoReconnectConnection(frame: ReconnectConnectionFrame): Promise<CommandResult> {
    const result = await reconnectConnection(frame, true);
    if (!result.ok) return result;
    // 撤销方向可能无法在引擎重建原 dangling 端点，因此仅恢复本地悬空投影。
    applyReconnectGeometry(frame, false);
    selection = frame.selectionBefore;
    undoStack.pop();
    redoStack.push(frame);
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
    await settleAfterStructure();
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
    await settleAfterStructure();
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
    await settleAfterStructure();
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
    await settleAfterStructure();
    return { ok: true, snapshot: finishOperation() };
  }

  async function undoDeleteComponent(frame: DeleteComponentFrame): Promise<CommandResult> {
    const addedComponent = await call(() => engine.addComponent(frame.kind, frame.ports));
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
      // 代数不同说明这批引擎 ID 属于已被更换的引擎进程：整份重建后旧悬空连接从未进入当前
      // 引擎，而新进程的连接身份从 1 重新计数，按旧 ID 删除会恰好误删刚重建的连接。
      if (frame.engineGeneration !== engineGeneration) break;
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
    await settleAfterStructure();
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
      await settleAfterStructure();
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
    await settleAfterStructure();
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

  function applyWireColorFrame(frame: SetWireColorFrame, after: boolean): void {
    const connection = document.connections.get(frame.connectionId);
    if (!connection || connection.lifecycle !== "visible") return;
    const color = after ? frame.colorAfter : frame.colorBefore;
    if (color) connection.color = color;
    else delete connection.color;
  }

  async function setWireColor(frame: SetWireColorFrame): Promise<CommandResult> {
    if (frame.colorBefore === frame.colorAfter) {
      selection = { kind: "connection", id: frame.connectionId };
      return { ok: true, snapshot: finishOperation() };
    }
    applyWireColorFrame(frame, true);
    selection = { kind: "connection", id: frame.connectionId };
    undoStack.push(frame);
    redoStack.length = 0;
    return { ok: true, snapshot: finishOperation() };
  }

  async function undoSetWireColor(frame: SetWireColorFrame): Promise<CommandResult> {
    applyWireColorFrame(frame, false);
    selection = frame.selectionBefore;
    undoStack.pop();
    redoStack.push(frame);
    return { ok: true, snapshot: finishOperation() };
  }

  async function redoSetWireColor(frame: SetWireColorFrame, remainingRedo: readonly HistoryFrame[]): Promise<CommandResult> {
    applyWireColorFrame(frame, true);
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
      const added = await call(() => engine.addComponent(protocolKind(component.kind), component.ports));
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
    await settleAfterStructure();
    publishBindings();
    return { ok: true, snapshot: finishOperation() };
  }

  async function undo(): Promise<CommandResult> {
    const frame = undoStack[undoStack.length - 1];
    if (!frame) return fail({ code: "nothing_to_undo", message: "没有可撤销的操作。", retryable: false });
    if (frame.type === "add-component") return undoAddComponent(frame);
    if (frame.type === "set-port-width") return undoSetPortWidth(frame);
    if (frame.type === "delete-component") return undoDeleteComponent(frame);
    if (frame.type === "clear-document") return undoClearDocument(frame);
    if (frame.type === "move-component") return undoMoveComponent(frame);
    if (frame.type === "create-connection") return undoCreateConnection(frame);
    if (frame.type === "reconnect-connection") return undoReconnectConnection(frame);
    if (frame.type === "edit-route") return undoEditRoute(frame);
    if (frame.type === "set-wire-color") return undoSetWireColor(frame);
    if (frame.type === "replace-projection") return undoReplaceProjection(frame);
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
    if (frame.type === "set-port-width") return redoSetPortWidth(frame, remainingRedo);
    if (frame.type === "clear-document") {
      const refreshed = makeClearDocumentFrame();
      if (!refreshed) return fail(recoveryError("重做清空所需的文档不存在。"));
      const result = await clearDocument(refreshed);
      if (result.ok) redoStack.push(...remainingRedo);
      return result;
    }
    if (frame.type === "move-component") return redoMoveComponent(frame, remainingRedo);
    if (frame.type === "create-connection") return redoCreateConnection(frame, remainingRedo);
    if (frame.type === "reconnect-connection") {
      const result = await reconnectConnection(frame, false, true);
      if (result.ok) {
        redoStack.length = 0;
        redoStack.push(...remainingRedo);
      }
      return result;
    }
    if (frame.type === "edit-route") return redoEditRoute(frame, remainingRedo);
    if (frame.type === "set-wire-color") return redoSetWireColor(frame, remainingRedo);
    if (frame.type === "replace-projection") return redoReplaceProjection(frame, remainingRedo);
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
    const changesCircuitState = changesCircuit(command);
    if (changesCircuitState && operation === "recovery-required") {
      const errorValue = error ?? recoveryError("编辑器需要重新加载后才能继续结构编辑。");
      return { ok: false, error: errorValue, snapshot: currentSnapshot() };
    }
    if (changesCircuitState && operation === "busy") {
      return { ok: false, error: busyError, snapshot: currentSnapshot() };
    }
    if (changesCircuitState && !isEngineAvailable()) {
      return structureUnavailable();
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

    if (command.type === "begin-placement") {
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
    if (command.type === "move-component") {
      const frame = makeMoveComponentFrame(command.componentId, command.position);
      if (!frame) return fail(noSelectionError);
      return moveComponent(frame);
    }
    if (command.type === "set-port-width") return setPortWidth(command.componentId, command.ports);
    if (command.type === "set-wire-color") {
      const connection = document.connections.get(command.connectionId);
      if (!connection || connection.lifecycle !== "visible") return fail(noSelectionError);
      return setWireColor({
        type: "set-wire-color",
        connectionId: connection.id,
        colorBefore: connection.color,
        colorAfter: command.color,
        selectionBefore: selection ? { ...selection } : null,
      });
    }
    if (
      command.type === "edit-route" ||
      command.type === "move-route-waypoint" ||
      command.type === "move-route-segment" ||
      command.type === "delete-waypoint" ||
      command.type === "reset-route"
    ) {
      const connection = document.connections.get(command.connectionId);
      if (!connection || connection.lifecycle !== "visible") return fail(noSelectionError);
      const currentRoute = routeForConnection(connection);
      let nextRoute: readonly Point[];
      if (command.type === "edit-route") {
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
    if (command.type === "reconnect-connection") {
      const frame = reconnectFrame(command.connectionId, command.left, command.right, command.route, command.waypoints);
      if ("code" in frame) return fail(frame);
      return reconnectConnection(frame);
    }
    if (command.type === "create-connection") {
      const frame = connectionFrame(command.left, command.right, command.route, command.waypoints, command.color);
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
    if (command.type === "place-component" || command.type === "add-component") {
      const kind = command.type === "add-component" ? command.kind : command.kind ?? pendingPlacement?.kind;
      if (!kind) return fail({ code: "no_pending_placement", message: "当前没有待放置的元件。", retryable: false });
      const altKey = command.altKey ?? pendingPlacement?.altKey ?? false;
      const center = command.type === "add-component" ? command.position : command.center;
      const result = await addComponentAt(kind, center, altKey, command.continuous);
      return result;
    }
    if (command.type === "duplicate-component") {
      return duplicateComponent(command.componentId);
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
    setEngineAvailability(available) {
      engineAvailabilityOverride = available;
      if (available && error?.code === engineUnavailableError.code) error = null;
      publish();
    },
    adoptBindings(next) {
      // 引擎身份映射整体替换：旧进程的引擎 ID 全部作废。历史帧里的结构数据以编辑器 ID 表达、
      // 撤销/重做时按当时绑定重新解析，因此历史不需要改写；但帧里捕获的引擎 ID（悬空连接
      // 清理清单）只在捕获时的引擎代数上有意义，代数计数随之递增。
      engineGeneration += 1;
      const adopted = cloneBindings(next);
      bindings.components = adopted.components;
      bindings.connections = adopted.connections;
      bindings.flatComponents = adopted.flatComponents;
      bindings.flatConnections = adopted.flatConnections;
      bindings.componentFlatIds = adopted.componentFlatIds;
      bindings.connectionFlatIds = adopted.connectionFlatIds;
      bindings.componentKinds = adopted.componentKinds;
      bindings.ports = adopted.ports;
      bindings.portSources = adopted.portSources;
      // 端口清单以引擎回传为权威（ADR 0020）：重建后的清单随绑定刷新到文档上。
      for (const component of document.components.values()) {
        if (component.lifecycle !== "active") continue;
        const known = bindings.ports?.[component.id];
        if (known !== undefined) component.ports = clonePorts(known);
      }
      publish();
    },
    replaceProjection,
    projection() {
      return lastProjection ? cloneProjectionInput(lastProjection) : null;
    },
    adoptProjection(input) {
      lastProjection = cloneProjectionInput(input);
    },
    rewriteSubcircuitReferences,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
