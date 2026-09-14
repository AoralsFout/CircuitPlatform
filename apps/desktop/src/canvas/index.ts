import type { ComponentKindName, Signal } from "@circuit-platform/protocol";
import type {
  EditorComponent,
  EditorConnection,
  EditorEndpointSide,
  EditorSnapshot,
  Point,
} from "../editor";

export type PortDirection = "input" | "output";

export interface PortDefinition {
  id: string;
  name: string;
  direction: PortDirection;
  offset: Point;
}

export interface ComponentDefinition {
  kind: ComponentKindName;
  category: "input-output" | "logic" | "sequential";
  sortOrder: number;
  symbol: string;
  displayName: string;
  description: string;
  size: { width: number; height: number };
  ports: readonly PortDefinition[];
  available: boolean;
  disabledReason: string | null;
  searchAliases: readonly string[];
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
const port = (id: string, name: string, direction: PortDirection, x: number, y: number): PortDefinition => ({
  id,
  name,
  direction,
  offset: { x, y },
});

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
    ports: [port("out", "out", "output", size.width, size.height / 2)],
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
    ports: [port("in", "in", "input", 0, size.height / 2)],
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
    ports: [port("in1", "in1", "input", 0, 30), port("in2", "in2", "input", 0, 54), port("out", "out", "output", size.width, size.height / 2)],
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
    ports: [port("in1", "in1", "input", 0, 30), port("in2", "in2", "input", 0, 54), port("out", "out", "output", size.width, size.height / 2)],
    available: true,
    disabledReason: null,
    searchAliases: ["or", "或门"],
  },
  ...["nand", "nor", "xor", "xnor", "not"].map((kind, index): ComponentDefinition => {
    const binary = kind !== "not";
    return {
      kind: kind as ComponentKindName,
      category: "logic",
      sortOrder: 50 + index * 10,
      symbol: kind.toUpperCase(),
      displayName: `${kind.toUpperCase()} 门`,
      description: `${kind.toUpperCase()} 逻辑元件。`,
      size,
      ports: [
        ...(binary ? [port("in1", "in1", "input", 0, 30), port("in2", "in2", "input", 0, 54)] : [port("in", "in", "input", 0, size.height / 2)]),
        port("out", "out", "output", size.width, size.height / 2),
      ],
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
    description: "产生周期性时钟信号。",
    size,
    ports: [port("out", "out", "output", size.width, size.height / 2)],
    available: false,
    disabledReason: "时序仿真尚未启用。",
    searchAliases: ["clock", "时钟"],
  },
  {
    kind: "d_flip_flop",
    category: "sequential",
    sortOrder: 110,
    symbol: "D",
    displayName: "D Flip-Flop",
    description: "在时钟上升沿采样 D 输入。",
    size,
    ports: [port("d", "D", "input", 0, 30), port("clk", "CLK", "input", 0, 54), port("q", "Q", "output", size.width, 30)],
    available: false,
    disabledReason: "时序仿真尚未启用。",
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
  id: string;
  name: string;
  direction: PortDirection;
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
  signal: Signal;
  danglingEndpoints: readonly EditorEndpointSide[];
  selected: boolean;
}

export interface CanvasScene {
  nodes: readonly CanvasNode[];
  wires: readonly CanvasWire[];
  bounds: { min: Point; max: Point };
}

export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
  visibleRect: { width: number; height: number };
}

export interface InteractionState {
  focusedId: string | null;
  draggingNodeId: string | null;
  connectionDraft: readonly Point[] | null;
  emptyState?: { title: string; message: string };
}

function freezeDefinition(definition: ComponentDefinition): ComponentDefinition {
  return {
    ...definition,
    size: { ...definition.size },
    ports: definition.ports.map((item) => ({ ...item, offset: { ...item.offset } })),
    searchAliases: [...definition.searchAliases],
  };
}

function endpointKey(componentId: string, portId: string): string {
  return `${componentId}:${portId}`;
}

function routeFor(connection: EditorConnection): readonly Point[] {
  const explicit = (connection as EditorConnection & { route?: readonly Point[] }).route;
  if (explicit && explicit.length >= 2) return explicit.map((point) => ({ ...point }));
  const start = connection.source.point;
  const end = connection.target.point;
  const midpoint = start.x + (end.x - start.x) / 2;
  return [
    { ...start },
    { x: midpoint, y: start.y },
    { x: midpoint, y: end.y },
    { ...end },
  ];
}

function getSignal(snapshot: SimulationSnapshot, componentId: string, portId: string): Signal {
  return snapshot.signals[endpointKey(componentId, portId)] ?? "X";
}

function portPoint(component: EditorComponent, definition: ComponentDefinition, port: PortDefinition): Point {
  return {
    x: component.position.x + port.offset.x,
    y: component.position.y + port.offset.y,
  };
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
): CanvasScene {
  if (!editorSnapshot) return { nodes: [], wires: [], bounds: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } } };

  const selected = editorSnapshot.selection;
  const connectedPoints = new Map<string, Point>();
  for (const connection of editorSnapshot.document.connections) {
    connectedPoints.set(endpointKey(connection.source.componentId, connection.source.port), { ...connection.source.point });
    connectedPoints.set(endpointKey(connection.target.componentId, connection.target.port), { ...connection.target.point });
  }
  const nodes = editorSnapshot.document.components.map((component) => {
    const definition = registry.get(component.kind);
    if (!definition) return null;
    const danglingPorts = new Set<string>();
    for (const connection of editorSnapshot.document.connections) {
      for (const side of connection.danglingEndpoints) {
        const endpoint = side === "source" ? connection.source : connection.target;
        if (endpoint.componentId === component.id) danglingPorts.add(endpoint.port);
      }
    }
    return {
      id: component.id,
      kind: component.kind,
      displayName: component.displayName || definition.displayName,
      symbol: definition.symbol,
      description: definition.description,
      position: { ...component.position },
      size: { ...definition.size },
      ports: definition.ports.map((portDefinition) => ({
        id: portDefinition.id,
        name: portDefinition.name,
        direction: portDefinition.direction,
        point: connectedPoints.get(endpointKey(component.id, portDefinition.id)) ?? portPoint(component, definition, portDefinition),
        offset: { ...portDefinition.offset },
        signal: getSignal(simulationSnapshot, component.id, portDefinition.id),
        dangling: danglingPorts.has(portDefinition.id),
      })),
      selected: selected?.kind === "component" && selected.id === component.id,
    } satisfies CanvasNode;
  }).filter((node) => node !== null) as CanvasNode[];

  const wires = editorSnapshot.document.connections.map((connection) => ({
    id: connection.id,
    source: { ...connection.source, point: { ...connection.source.point } },
    target: { ...connection.target, point: { ...connection.target.point } },
    route: routeFor(connection),
    signal: getSignal(simulationSnapshot, connection.source.componentId, connection.source.port),
    danglingEndpoints: [...connection.danglingEndpoints],
    selected: selected?.kind === "connection" && selected.id === connection.id,
  } satisfies CanvasWire));

  return { nodes, wires, bounds: boundsFor(nodes, wires) };
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
