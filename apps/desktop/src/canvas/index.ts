import type { ComponentKindName, PortSpec, Signal } from "@circuit-platform/protocol";
import type {
  EditorComponent,
  EditorConnection,
  EditorEndpointSide,
  EditorSnapshot,
  Point,
} from "../editor";
import { createDefaultOrthogonalRoute, routeFromWaypoints } from "../editor/route.ts";
import { isProjectedDangling } from "../editor/port-width.ts";
import { DEFAULT_WIRE_COLOR, isWireColorId, type WireColorId } from "../editor/wire-appearance.ts";

export type PortDirection = "input" | "output";

/**
 * 一个端口的展示几何：画在哪、显示成什么。
 *
 * 它只描述展示，**不声明端口是否存在**——端口清单与位宽由引擎回传，这里不保留第二份。
 */
export interface PortLayout {
  /** 端口标签；省略时直接用引擎的端口名。 */
  label?: string;
  /** 锚点相对元件左上角的偏移。 */
  offset: Point;
}

/** 同一方向上相邻端口的纵向间距；与既有元件的端口间距一致。 */
export const PORT_LAYOUT_PITCH = 24;

export interface ComponentDefinition {
  kind: ComponentKindName;
  category: "input-output" | "logic" | "sequential";
  sortOrder: number;
  symbol: string;
  displayName: string;
  description: string;
  size: { width: number; height: number };
  /**
   * 按引擎端口名索引的展示布局。
   *
   * 通用排布规则（同向端口在元件垂直中线上按 `PORT_LAYOUT_PITCH` 均分、输入贴左、输出贴右）
   * 复现了既有元件的全部端口坐标，因此这里只列规则复现不了的那几项：D Flip-Flop 的 `q` 与
   * `d` 对齐而不是垂直居中，它的三个端口显示的也不是端口名。
   *
   * 没有条目的端口一律走规则，所以数据驱动的元件（拆线器、合线器）不需要在这里登记——
   * 展示定义不是端口清单，端口从哪来、有多宽都由引擎说了算。
   */
  portLayout: Readonly<Record<string, PortLayout>>;
  available: boolean;
  disabledReason: string | null;
  searchAliases: readonly string[];
}

/**
 * 解析一个端口在画布上的展示几何。
 *
 * 先看展示定义里有没有为这个端口名登记的布局，没有就回退到通用规则：同方向的端口在元件
 * 垂直中线上等距排开，输入贴左边、输出贴右边。规则给出的坐标与既有元件逐个吻合，因此
 * 回退不是「降级」，而是这些元件本来就没有需要特别登记的形状。
 * @param definition 元件展示定义。
 * @param portName 引擎端口名。
 * @param direction 端口方向，决定它贴哪一边。
 * @param sideIndex 同一方向上这一项的下标。
 * @param sideCount 同一方向上的端口总数。
 * @returns 该端口的标签与偏移。
 */
export function portLayoutFor(
  definition: ComponentDefinition,
  portName: string,
  direction: PortDirection,
  sideIndex: number,
  sideCount: number,
): PortLayout {
  const explicit = definition.portLayout[portName];
  const centered = definition.size.height / 2 + (sideIndex - (sideCount - 1) / 2) * PORT_LAYOUT_PITCH;
  return {
    label: explicit?.label ?? portName,
    offset: explicit?.offset ?? {
      x: direction === "input" ? 0 : definition.size.width,
      y: centered,
    },
  };
}

/**
 * 端口标签上的文本：带位区间或位宽大于 1 时写成 `out[7:0]`，否则就是端口名本身。
 *
 * 位宽为 1 且没有位区间的端口因此与引入位宽之前显示得一模一样——这是「既有 1 位电路外观不变」
 * 在端口标注上的落点。
 * @param label 端口的展示标签（通常是端口名）。
 * @param port 引擎回传的端口声明。
 * @returns 画布与检查器共用的端口标注文本。
 */
export function circuitPortLabel(label: string, port: Pick<PortSpec, "width" | "bitRange">): string {
  if (port.bitRange) return `${label}[${port.bitRange.msb}:${port.bitRange.lsb}]`;
  return port.width > 1 ? `${label}[${port.width - 1}:0]` : label;
}

/**
 * 元件展示定义的唯一读取入口；它只描述画布展示，不承担电路合法性校验。
 * @param definitions 可选的项目元件定义；同一 kind 重复时后者覆盖前者。
 * @returns 提供排序、查找和搜索能力的不可变定义注册表。
 */
export class ComponentDefinitionRegistry {
  private readonly definitions: ReadonlyMap<ComponentKindName, ComponentDefinition>;

  public constructor(definitions: readonly ComponentDefinition[]) {
    this.definitions = new Map(definitions.map((definition) => [definition.kind, freezeDefinition(definition)]));
  }

  /** 返回一种元件的展示定义；未知类型由调用者决定如何降级。 */
  public get(kind: ComponentKindName): ComponentDefinition | undefined {
    return this.definitions.get(kind);
  }

  /** 返回按分类顺序排列的全部元件定义。 */
  public list(): readonly ComponentDefinition[] {
    return [...this.definitions.values()].sort((left, right) => left.sortOrder - right.sortOrder);
  }

  /** 按显示名称、类型和搜索别名查找元件，搜索不区分大小写。 */
  public search(query: string): readonly ComponentDefinition[] {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return this.list();
    return this.list().filter((definition) => [
      definition.kind,
      definition.displayName,
      ...definition.searchAliases,
    ].some((value) => value.toLocaleLowerCase().includes(normalized)));
  }
}

const size = { width: 148, height: 84 } as const;

/** 没有条目的端口走通用规则；`{}` 因此是一个完整而正确的展示布局。 */
const noPortLayout: Readonly<Record<string, PortLayout>> = {};

/** 默认支持的元件展示定义，供画布、元件库和检查器共享。 */
export const DEFAULT_COMPONENT_DEFINITIONS: readonly ComponentDefinition[] = [
  {
    kind: "input",
    category: "input-output",
    sortOrder: 10,
    symbol: "→",
    displayName: "输入",
    description: "产生 0 或 1 的数字输入。",
    size,
    portLayout: noPortLayout,
    available: true,
    disabledReason: null,
    searchAliases: ["source", "input", "输入端"],
  },
  {
    kind: "output",
    category: "input-output",
    sortOrder: 20,
    symbol: "◉",
    displayName: "输出",
    description: "显示一个输入信号。",
    size,
    portLayout: noPortLayout,
    available: true,
    disabledReason: null,
    searchAliases: ["monitor", "output", "输出端"],
  },
  {
    kind: "and",
    category: "logic",
    sortOrder: 30,
    symbol: "&",
    displayName: "AND 门",
    description: "所有输入为 1 时输出 1。",
    size,
    portLayout: noPortLayout,
    available: true,
    disabledReason: null,
    searchAliases: ["and", "与门"],
  },
  {
    kind: "or",
    category: "logic",
    sortOrder: 40,
    symbol: "≥1",
    displayName: "OR 门",
    description: "任一输入为 1 时输出 1。",
    size,
    portLayout: noPortLayout,
    available: true,
    disabledReason: null,
    searchAliases: ["or", "或门"],
  },
  ...["nand", "nor", "xor", "xnor", "not"].map((kind, index): ComponentDefinition => {
    return {
      kind: kind as ComponentKindName,
      category: "logic",
      sortOrder: 50 + index * 10,
      symbol: kind.toUpperCase(),
      displayName: `${kind.toUpperCase()} 门`,
      description: `${kind.toUpperCase()} 逻辑元件。`,
      size,
      portLayout: noPortLayout,
      available: true,
      disabledReason: null,
      searchAliases: [kind],
    };
  }),
  {
    kind: "clock",
    category: "sequential",
    sortOrder: 100,
    symbol: "CLK",
    displayName: "Clock",
    description: "初值为 0，每推进一次在 0 与 1 之间翻转一次。",
    size,
    portLayout: noPortLayout,
    available: true,
    disabledReason: null,
    searchAliases: ["clock", "时钟"],
  },
  {
    kind: "d_flip_flop",
    category: "sequential",
    sortOrder: 110,
    symbol: "D",
    displayName: "D Flip-Flop",
    description: "在 clock 端口的上升沿把 D 采样进 Q，其余推进保持不变；第一次有效上升沿之前 Q 为 X。",
    size,
    // 端口名原样发给引擎，因此时钟端口必须叫 `clock`（领域语言），`CLK` 只作为显示标签。
    // 通用规则会把唯一的输出端口摆在垂直中线上，而这个元件把 `q` 与 `d` 对齐，所以单独登记。
    portLayout: {
      d: { label: "D", offset: { x: 0, y: 30 } },
      clock: { label: "CLK", offset: { x: 0, y: 54 } },
      q: { label: "Q", offset: { x: size.width, y: 30 } },
    },
    available: true,
    disabledReason: null,
    searchAliases: ["dff", "flip flop", "触发器"],
  },
];

/** 创建默认元件定义注册表。返回新实例以避免调用方共享可变集合。 */
export function createComponentDefinitionRegistry(
  definitions: readonly ComponentDefinition[] = DEFAULT_COMPONENT_DEFINITIONS,
): ComponentDefinitionRegistry {
  return new ComponentDefinitionRegistry(definitions);
}

/** 默认的共享展示定义，适合只读使用；需要自定义定义时请创建新的注册表实例。 */
export const defaultComponentDefinitionRegistry = createComponentDefinitionRegistry();

export interface SimulationSnapshot {
  /** key 为 `${editorComponentId}:${portId}`；未提供的信号按 X 展示。 */
  signals: Readonly<Record<string, Signal>>;
}

export interface CanvasPort {
  /** 引擎端口名；信号键与连接端点都用它。 */
  id: string;
  /** 展示标签，通常与端口名相同；D Flip-Flop 的 `CLK` 这类仅展示的名字在这里。 */
  name: string;
  direction: PortDirection;
  /** 位宽；来自引擎回传的端口清单。 */
  width: number;
  /** 可选的位区间；只有落在某条宿主总线某一段上的端口会带上它。 */
  bitRange?: { msb: number; lsb: number };
  /** 端口标签上显示的文本，带位区间时形如 `out[7:0]`。 */
  label: string;
  point: Point;
  offset: Point;
  signal: Signal;
  dangling: boolean;
}

export interface CanvasNode {
  id: string;
  kind: ComponentKindName;
  displayName: string;
  symbol: string;
  description: string;
  position: Point;
  size: { width: number; height: number };
  ports: readonly CanvasPort[];
  selected: boolean;
}

export interface CanvasWireEndpoint {
  componentId: string;
  port: string;
  point: Point;
}

export interface CanvasWire {
  id: string;
  source: CanvasWireEndpoint;
  target: CanvasWireEndpoint;
  route: readonly Point[];
  /** 用户可见的有序折点；默认 Route 的派生折线不重复计入。 */
  waypoints?: readonly Point[];
  signal: Signal;
  /** 与信号状态无关的线路外观预设。 */
  color?: WireColorId;
  /** 端点缺失的边；位宽不匹配只让整条线悬空，不会给某一侧单独定性。 */
  danglingEndpoints: readonly EditorEndpointSide[];
  /**
   * 整条连接是否悬空：端点缺失，或两端位宽不再相同。
   * 悬空只有一种表达，因此画布的外观与读数只认这一个布尔量。
   */
  dangling: boolean;
  selected: boolean;
}

export interface CanvasScene {
  nodes: readonly CanvasNode[];
  wires: readonly CanvasWire[];
  bounds: { min: Point; max: Point };
}

/** 判断是否应启用大场景降级视觉效果；只影响光晕、动画和次级网格。 */
export function isDenseCanvasScene(scene: CanvasScene): boolean {
  return scene.nodes.length > 500 || scene.wires.length > 1000;
}

export interface InteractionState {
  focusedId: string | null;
  draggingComponentId: string | null;
  /** 拖动期间的临时世界坐标；只存在于交互层，不写入 EditorSnapshot。 */
  dragPreview?: { componentId: string; position: Point } | null;
  connectionDraft: readonly Point[] | null;
  /** 草稿提交失败时的持久错误提示，Esc 或换目标前不会自动丢失。 */
  connectionDraftError?: string | null;
  /** Wire Route 拖动时的临时预览；释放后才进入 EditorSession 历史。 */
  routeEditPreview?: { connectionId: string; route: readonly Point[] } | null;
  pendingPlacement?: { kind: ComponentKindName; position: Point; size: { width: number; height: number }; error?: string | null } | null;
  emptyState?: { title: string; message: string };
}

function freezeDefinition(definition: ComponentDefinition): ComponentDefinition {
  return {
    ...definition,
    size: { ...definition.size },
    portLayout: Object.fromEntries(
      Object.entries(definition.portLayout).map(([name, layout]) => [
        name,
        { ...layout, offset: { ...layout.offset } },
      ]),
    ),
    searchAliases: [...definition.searchAliases],
  };
}

function endpointKey(componentId: string, portId: string): string {
  return `${componentId}:${portId}`;
}

function getSignal(snapshot: SimulationSnapshot, componentId: string, portId: string): Signal {
  return snapshot.signals[endpointKey(componentId, portId)] ?? "X";
}

function defaultPortSignal(component: EditorComponent, port: PortSpec): Signal {
  // 新建 Input 的输出从 0 开始；其它端口在首次求值前保持未知。长度按端口自己的位宽构造，
  // 因此宽端口不会拿到一个长度对不上的兜底值。
  if (component.kind === "input" && port.direction === "output") return "0".repeat(port.width);
  return "X".repeat(port.width);
}

/**
 * 在元件的端口清单里找出某个端口的展示偏移。
 *
 * 已连接端点的几何必须由当前元件位置与端口偏移推导，不能沿用持久化的端点坐标；而偏移来自
 * 展示定义按端口名登记的布局，或通用排布规则。端口不在清单里时返回空值，调用方据此保留
 * 冻结的端点位置。
 * @param component 端点所属的编辑器元件。
 * @param definition 该元件的展示定义。
 * @param portName 要解析的引擎端口名。
 * @returns 该端口的展示布局；端口不在清单里时返回 undefined。
 */
function portLayoutOf(
  component: EditorComponent,
  definition: ComponentDefinition,
  portName: string,
): PortLayout | undefined {
  const ports = component.ports ?? [];
  const port = ports.find((candidate) => candidate.name === portName);
  if (!port) return undefined;
  const sameSide = ports.filter((candidate) => candidate.direction === port.direction);
  return portLayoutFor(definition, port.name, port.direction, sameSide.indexOf(port), sameSide.length);
}

function routeFor(connection: EditorConnection): readonly Point[] {
  const explicit = (connection as EditorConnection & { route?: readonly Point[] }).route;
  if (explicit && explicit.length >= 2) return explicit.map((point) => ({ ...point }));
  return createDefaultOrthogonalRoute(connection.source.point, connection.target.point);
}

function routeBetween(start: Point, end: Point, waypoints: readonly Point[] = []): Point[] {
  return waypoints.length === 0
    ? createDefaultOrthogonalRoute(start, end)
    : routeFromWaypoints(start, end, waypoints);
}

function previewEndpoint(
  endpoint: EditorConnection["source"],
  components: ReadonlyMap<string, EditorComponent>,
  registry: ComponentDefinitionRegistry,
  dangling: boolean,
  previewPositions: Readonly<Record<string, Point>> | undefined,
): Point {
  // 持久 endpoint.point 只代表 DanglingConnection 的冻结位置。已连接端点
  // 必须由当前 Component 位置和它自己那份端口清单推导，避免移动元件后
  // 旧坐标继续成为第二个几何事实源。
  if (dangling) return { ...endpoint.point };
  const component = components.get(endpoint.componentId);
  const definition = component ? registry.get(component.kind) : undefined;
  const layout = component && definition ? portLayoutOf(component, definition, endpoint.port) : undefined;
  if (!component || !layout) return { ...endpoint.point };
  const position = previewPositions?.[component.id] ?? component.position;
  return { x: position.x + layout.offset.x, y: position.y + layout.offset.y };
}

function boundsFor(nodes: readonly CanvasNode[], wires: readonly CanvasWire[]): CanvasScene["bounds"] {
  const points: Point[] = [];
  for (const node of nodes) {
    points.push(node.position, { x: node.position.x + node.size.width, y: node.position.y + node.size.height });
    points.push(...node.ports.map((port) => port.point));
  }
  for (const wire of wires) points.push(...wire.route);
  if (points.length === 0) return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
  return {
    min: { x: Math.min(...points.map((point) => point.x)), y: Math.min(...points.map((point) => point.y)) },
    max: { x: Math.max(...points.map((point) => point.x)), y: Math.max(...points.map((point) => point.y)) },
  };
}

/**
 * 把一个元件的端口清单投影为画布端口。
 *
 * 端口的存在与位宽来自编辑器文档里的引擎清单；偏移来自展示定义按端口名登记的布局，缺省时
 * 走通用排布规则。两件事分开，是因为几何不是端口定义的第二个权威来源——端口名换了，这里
 * 只会换个位置画，不会凭空多出或少掉一个端口。
 */
function projectPorts(
  component: EditorComponent,
  definition: ComponentDefinition,
  nodePosition: Point,
  connectedPoints: ReadonlyMap<string, Point>,
  danglingPorts: ReadonlySet<string>,
  simulationSnapshot: SimulationSnapshot,
): CanvasPort[] {
  const ports = component.ports ?? [];
  const sideCounts: Record<PortDirection, number> = { input: 0, output: 0 };
  for (const port of ports) sideCounts[port.direction] += 1;

  const sideIndexes: Record<PortDirection, number> = { input: 0, output: 0 };
  return ports.map((port) => {
    const layout = portLayoutFor(
      definition,
      port.name,
      port.direction,
      sideIndexes[port.direction]++,
      sideCounts[port.direction],
    );
    const key = endpointKey(component.id, port.name);
    return {
      id: port.name,
      name: layout.label ?? port.name,
      direction: port.direction,
      width: port.width,
      ...(port.bitRange ? { bitRange: { ...port.bitRange } } : {}),
      label: circuitPortLabel(layout.label ?? port.name, port),
      point: connectedPoints.get(key) ?? {
        x: nodePosition.x + layout.offset.x,
        y: nodePosition.y + layout.offset.y,
      },
      offset: { ...layout.offset },
      // 未提供仿真快照时，新 Input 的默认驱动值为 0，其余端口保持未知 X。
      signal: simulationSnapshot.signals[key] ?? defaultPortSignal(component, port),
      dangling: danglingPorts.has(port.name),
    } satisfies CanvasPort;
  });
}

/**
 * 将编辑器、仿真和展示定义投影为纯 CanvasScene；不会修改任何输入快照。
 * @param editorSnapshot 当前编辑器快照；传入 null 时返回空场景。
 * @param simulationSnapshot 按 editor ID/Port 提供的信号状态。
 * @param registry Component 展示定义注册表。
 * @returns 可直接供 DOM/SVG 分层画布渲染的节点、端口、Wire 和边界。
 */
export function projectCanvasScene(
  editorSnapshot: EditorSnapshot | null,
  simulationSnapshot: SimulationSnapshot,
  registry: ComponentDefinitionRegistry,
  previewPositions?: Readonly<Record<string, Point>>,
  previewRoutes?: Readonly<Record<string, readonly Point[]>>,
): CanvasScene {
  if (!editorSnapshot) return { nodes: [], wires: [], bounds: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } } };

  const selected = editorSnapshot.selection;
  const componentsById = new Map(editorSnapshot.document.components.map((component) => [component.id, component]));
  const danglingPortsByComponent = new Map<string, Set<string>>();
  for (const connection of editorSnapshot.document.connections) {
    for (const side of connection.danglingEndpoints) {
      const endpoint = side === "source" ? connection.source : connection.target;
      const ports = danglingPortsByComponent.get(endpoint.componentId) ?? new Set<string>();
      ports.add(endpoint.port);
      danglingPortsByComponent.set(endpoint.componentId, ports);
    }
  }
  const connectedPoints = new Map<string, Point>();
  for (const connection of editorSnapshot.document.connections) {
    connectedPoints.set(endpointKey(connection.source.componentId, connection.source.port), previewEndpoint(connection.source, componentsById, registry, connection.danglingEndpoints.includes("source"), previewPositions));
    connectedPoints.set(endpointKey(connection.target.componentId, connection.target.port), previewEndpoint(connection.target, componentsById, registry, connection.danglingEndpoints.includes("target"), previewPositions));
  }
  const nodes = editorSnapshot.document.components.map((component) => {
    const definition = registry.get(component.kind);
    if (!definition) return null;
    const danglingPorts = danglingPortsByComponent.get(component.id) ?? new Set<string>();
    const nodePosition = previewPositions?.[component.id] ?? component.position;
    return {
      id: component.id,
      kind: component.kind,
      displayName: component.displayName || definition.displayName,
      symbol: definition.symbol,
      description: definition.description,
      position: { ...nodePosition },
      size: { ...definition.size },
      // 端口清单来自编辑器文档，也就是引擎回传的那一份；展示定义只决定画在哪、显示成什么。
      ports: projectPorts(component, definition, nodePosition, connectedPoints, danglingPorts, simulationSnapshot),
      selected: selected?.kind === "component" && selected.id === component.id,
    } satisfies CanvasNode;
  }).filter((node) => node !== null) as CanvasNode[];

  const wires = editorSnapshot.document.connections.map((connection) => {
    const sourcePoint = previewEndpoint(connection.source, componentsById, registry, connection.danglingEndpoints.includes("source"), previewPositions);
    const targetPoint = previewEndpoint(connection.target, componentsById, registry, connection.danglingEndpoints.includes("target"), previewPositions);
    const previewRoute = previewRoutes?.[connection.id];
    const waypoints = connection.waypoints
      ? connection.waypoints.map((point) => ({ ...point }))
      : connection.route && connection.route.length > 2
        ? connection.route.slice(1, -1).map((point) => ({ ...point }))
        : [];
    const route = previewRoute
      ? previewRoute.map((point) => ({ ...point }))
      : connection.route
      ? routeBetween(sourcePoint, targetPoint, connection.route.length > 2 ? connection.route.slice(1, -1) : [])
      : connection.waypoints
        ? routeBetween(sourcePoint, targetPoint, connection.waypoints)
      : routeBetween(sourcePoint, targetPoint);
    return {
    id: connection.id,
    source: { ...connection.source, point: sourcePoint },
    target: { ...connection.target, point: targetPoint },
    route,
    waypoints,
    signal: getSignal(simulationSnapshot, connection.source.componentId, connection.source.port),
    color: isWireColorId(connection.color) ? connection.color : DEFAULT_WIRE_COLOR,
    danglingEndpoints: [...connection.danglingEndpoints],
    dangling: isProjectedDangling(connection, componentsById),
    selected: selected?.kind === "connection" && selected.id === connection.id,
    } satisfies CanvasWire;
  });

  return { nodes, wires, bounds: boundsFor(nodes, wires) };
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function samePointList(left: readonly Point[] | undefined, right: readonly Point[] | undefined): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((point, index) => samePoint(point, right[index]!));
}

function sameValueList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** 逐字段比较，保证复用只发生在渲染结果完全相同的情况下。 */
function sameWireContent(left: CanvasWire, right: CanvasWire): boolean {
  return left.id === right.id
    && left.signal === right.signal
    && left.color === right.color
    && left.selected === right.selected
    && left.source.componentId === right.source.componentId
    && left.source.port === right.source.port
    && samePoint(left.source.point, right.source.point)
    && left.target.componentId === right.target.componentId
    && left.target.port === right.target.port
    && samePoint(left.target.point, right.target.point)
    && samePointList(left.route, right.route)
    && samePointList(left.waypoints, right.waypoints)
    && sameValueList(left.danglingEndpoints, right.danglingEndpoints)
    && left.dangling === right.dangling;
}

function sameNodeContent(left: CanvasNode, right: CanvasNode): boolean {
  return left.id === right.id
    && left.kind === right.kind
    && left.selected === right.selected
    && left.displayName === right.displayName
    && left.symbol === right.symbol
    && left.description === right.description
    && samePoint(left.position, right.position)
    && left.size.width === right.size.width
    && left.size.height === right.size.height
    && left.ports.length === right.ports.length
    && left.ports.every((port, index) => {
      const other = right.ports[index]!;
      return port.id === other.id
        && port.name === other.name
        && port.direction === other.direction
        && port.signal === other.signal
        && port.dangling === other.dangling
        && port.width === other.width
        && port.label === other.label
        && port.bitRange?.msb === other.bitRange?.msb
        && port.bitRange?.lsb === other.bitRange?.lsb
        && samePoint(port.point, other.point)
        && samePoint(port.offset, other.offset);
    });
}

/**
 * 保留内容未变化的节点与连线对象身份，使下游能按引用跳过重建与 DOM patch。
 * 拖动一个 Component 时只有它和与之相连的少量 Wire 会变化，其余可以直接复用；
 * 全部未变时连场景容器本身也复用，让依赖场景引用的观察者保持静默。
 */
function reuseUnchangedEntities(previous: CanvasScene | null, next: CanvasScene): CanvasScene {
  if (!previous) return next;
  const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]));
  const previousWires = new Map(previous.wires.map((wire) => [wire.id, wire]));
  let reusedEverything = previous.nodes.length === next.nodes.length && previous.wires.length === next.wires.length;
  const nodes = next.nodes.map((node) => {
    const before = previousNodes.get(node.id);
    if (before && sameNodeContent(before, node)) return before;
    reusedEverything = false;
    return node;
  });
  const wires = next.wires.map((wire) => {
    const before = previousWires.get(wire.id);
    if (before && sameWireContent(before, wire)) return before;
    reusedEverything = false;
    return wire;
  });
  return reusedEverything ? previous : { nodes, wires, bounds: next.bounds };
}

function applySimulationSignals(scene: CanvasScene, simulationSnapshot: SimulationSnapshot): CanvasScene {
  return {
    ...scene,
    nodes: scene.nodes.map((node) => ({
      ...node,
      ports: node.ports.map((port) => ({
        ...port,
        signal: simulationSnapshot.signals[endpointKey(node.id, port.id)] ?? port.signal,
      })),
    })),
    wires: scene.wires.map((wire) => ({
      ...wire,
      signal: getSignal(simulationSnapshot, wire.source.componentId, wire.source.port),
    })),
  };
}

/**
 * 创建可复用的 CanvasScene 投影器。
 * 相同编辑器快照和交互预览只重用几何结构，信号更新不重新计算 Route。
 * @param registry 元件展示定义注册表。
 * @returns 可按工作区快照变化调用的场景投影器。
 */
export function createCanvasSceneProjector(registry: ComponentDefinitionRegistry = defaultComponentDefinitionRegistry) {
  let cachedSnapshot: EditorSnapshot | null | undefined;
  let cachedPositions: Readonly<Record<string, Point>> | undefined;
  let cachedRoutes: Readonly<Record<string, readonly Point[]>> | undefined;
  let cachedStructure: CanvasScene | null = null;
  let lastScene: CanvasScene | null = null;

  return {
    /** 投影信号并复用上一次的节点/连线几何。 */
    project(
      editorSnapshot: EditorSnapshot | null,
      simulationSnapshot: SimulationSnapshot,
      previewPositions?: Readonly<Record<string, Point>>,
      previewRoutes?: Readonly<Record<string, readonly Point[]>>,
    ): CanvasScene {
      if (
        cachedStructure === null ||
        cachedSnapshot !== editorSnapshot ||
        cachedPositions !== previewPositions ||
        cachedRoutes !== previewRoutes
      ) {
        cachedSnapshot = editorSnapshot;
        cachedPositions = previewPositions;
        cachedRoutes = previewRoutes;
        cachedStructure = projectCanvasScene(editorSnapshot, { signals: {} }, registry, previewPositions, previewRoutes);
      }
      lastScene = reuseUnchangedEntities(lastScene, applySimulationSignals(cachedStructure, simulationSnapshot));
      return lastScene;
    },
  };
}

/** `projectCanvasScene` 的语义别名，供组合层以“创建场景”命名调用。 */
export function createCanvasScene(
  editorSnapshot: EditorSnapshot | null,
  simulationSnapshot: SimulationSnapshot,
  registry: ComponentDefinitionRegistry = defaultComponentDefinitionRegistry,
): CanvasScene {
  return projectCanvasScene(editorSnapshot, simulationSnapshot, registry);
}

/** 生成可共享的编辑器空场景，便于组件在引擎/文档尚未就绪时渲染。 */
export function emptyCanvasScene(): CanvasScene {
  return { nodes: [], wires: [], bounds: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } } };
}

export {
  DEFAULT_VIEWPORT_PADDING,
  DEFAULT_VIEWPORT_ZOOM,
  MAX_VIEWPORT_ZOOM,
  MIN_VIEWPORT_ZOOM,
  applyWheelViewport,
  applyViewportWheel,
  clampViewportZoom,
  createViewportState,
  fitViewportToBounds,
  fitToWindow,
  isViewportPanPointer,
  normalizeWheelDelta,
  panViewport,
  resizeViewport,
  screenToWorld,
  setViewportZoomAt,
  worldToScreen,
  zoomAt,
  zoomViewportAt,
  zoomViewportAtCenter,
  type ViewportBounds,
  type ViewportSize,
  type ViewportState,
  type ViewportTransform,
} from "./viewport.ts";

export {
  NODE_GRID_SIZE,
  createNodeDragController,
  snapNodePosition,
  type NodeDragController,
  type NodeDragControllerOptions,
  type NodeDragPreview,
} from "./drag.ts";

export {
  createRouteEditController,
  type RouteEditController,
  type RouteEditControllerOptions,
  type RouteEditPreview,
  type RouteEditTarget,
} from "./route-edit.ts";

export {
  hitTestCanvas,
  hitTest,
  type CanvasHitTarget,
  type HitTestOptions,
} from "./hit-testing.ts";

export {
  createFrameCoalescer,
  type FrameCoalescer,
} from "./frame.ts";
