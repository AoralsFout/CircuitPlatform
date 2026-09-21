import type { Signal } from "@circuit-platform/protocol";
import type { ComponentDefinitionRegistry, CanvasNode, CanvasScene, CanvasWire, SubcircuitCanvasState } from "../canvas";
import { branchBitRanges, formatBitRangeList } from "./bus-ports.ts";
import type { EditorSelection, InternalComponentDescriptor } from "./index";

export interface InspectorPort {
  id: string;
  /** 展示标签，通常与端口名相同。 */
  name: string;
  /** 端口行显示的文本，带位区间时形如 `out[7:0]`。 */
  label: string;
  direction: "input" | "output";
  width: number;
  signal: Signal;
  connectionState: "connected" | "dangling" | "unconnected";
}

/**
 * 检查器里的一条可编辑属性。
 *
 * ADR 0014 说过第一版不引入没有实际用例的可编辑属性，位宽是第一个真实例外，位区间列表是
 * 第二个——它们都是「编辑一份端口清单」这件事的入口。
 */
export type InspectorAttribute = WidthAttribute | BitRangeAttribute;

export interface WidthAttribute {
  id: "width";
  label: string;
  /** 当前值。提交失败时这里仍是提交前的值，因为模型是从文档投影出来的。 */
  value: number;
  /** 这个属性作用在哪个端口上；提交时用它拼出整份端口清单。 */
  portName: string;
}

/**
 * 拆线器与合线器的位区间列表。
 *
 * 一整份列表编辑一次而不是逐条改：分支数量与各分支覆盖的范围是同一份清单的两个方面，而一次
 * 合法的整体变更（改成两条 4 位分支以后宿主总线的每一位仍然被盖满）用「改其中一条」的形状
 * 表达不出来。
 */
export interface BitRangeAttribute {
  id: "bit-ranges";
  label: string;
  /** 文本形式，形如 `7:7, 6:6, …, 0:0`。提交失败时这里仍是提交前的值。 */
  value: string;
  /** 宿主总线端口名；提交时用它认出哪一条端口是宿主。 */
  portName: string;
}

export interface ComponentInspector {
  kind: "component";
  id: string;
  displayName: string;
  type: string;
  behavior: string;
  signal: Signal;
  ports: readonly InspectorPort[];
  /** 可编辑属性；位宽在前，拆线器与合线器的位区间列表跟在后面。元件没有可编辑属性时为空数组。 */
  attributes: readonly InspectorAttribute[];
  /**
   * 结构提示：组件缺少能驱动它的连接时给出一行可展示的说明；没有问题时为 null。
   * 这是结构问题而不是错误，因此不进入 error 字段。
   */
  hint: string | null;
  /** 子电路的引用与解析状态；不展开内部对象。 */
  subcircuit?: SubcircuitCanvasState;
  /** 已解析 Subcircuit 使用处的只读内部信号投影；普通元件与未解析实例没有此字段。 */
  internalTable?: SubcircuitSignalTable;
}

export interface InternalSignalPort {
  id: string;
  name: string;
  label: string;
  direction: "input" | "output";
  width: number;
  signal: Signal;
}

export interface InternalSignalComponent {
  id: string;
  displayName: string;
  kind: string;
  path: readonly string[];
  ports: readonly InternalSignalPort[];
}

export interface SubcircuitSignalTable {
  ownerId: string;
  components: readonly InternalSignalComponent[];
  diagnostic: string | null;
}

export interface SubcircuitSignalProjection {
  descriptors: readonly InternalComponentDescriptor[];
  signals: Readonly<Record<string, Signal>>;
  diagnostic?: string | null;
}

/**
 * 从层次描述与父文档的 stable flat 快照生成只读表格。
 * 该函数不触发 IO，也不接受 Engine ID；缺失读数保持 `X`，便于首次显示和
 * 引擎故障时保留表格结构。
 */
export function createSubcircuitSignalTable(
  ownerId: string,
  projection: SubcircuitSignalProjection | null,
): SubcircuitSignalTable | null {
  if (projection === null) return null;
  const descriptors = projection.descriptors.filter((descriptor) => descriptor.ownerId === ownerId);
  return {
    ownerId,
    components: descriptors.map((descriptor) => ({
      id: descriptor.flatId,
      displayName: descriptor.displayName,
      kind: descriptor.kind,
      path: [...descriptor.path],
      ports: descriptor.ports.map((port) => ({
        id: `${descriptor.flatId}:${port.name}`,
        name: port.name,
        label: port.bitRange ? `${port.name}[${port.bitRange.msb}:${port.bitRange.lsb}]` : port.name,
        direction: port.direction,
        width: port.width,
        signal: projection.signals[`${descriptor.flatId}:${port.name}`] ?? "X",
      })),
    })),
    diagnostic: projection.diagnostic ?? null,
  };
}

export interface WireInspector {
  kind: "wire";
  id: string;
  source: { componentId: string; port: string };
  target: { componentId: string; port: string };
  signal: Signal;
  status: "normal" | "dangling";
  waypointCount: number;
}

export type InspectorModel = ComponentInspector | WireInspector | null;

function componentSignal(node: CanvasNode): Signal {
  return node.ports.find((port) => port.direction === "output")?.signal ?? node.ports[0]?.signal ?? "X";
}

/**
 * 未连接的 `clock` 端口意味着元件永远等不到上升沿，因此每一步都不会更新。
 * 按端口判定而不是按元件类型判定：展平 Subcircuit 后时钟同样落在普通输入端口上。
 */
function structuralHint(ports: readonly InspectorPort[]): string | null {
  const clockPort = ports.find((port) => port.direction === "input" && port.id === "clock");
  return clockPort?.connectionState === "unconnected"
    ? "clock 端口未连接，每次推进都不会更新。"
    : null;
}

/**
 * 位宽是检查器里第一个可编辑属性。
 *
 * 第一版只给 Input / Output 元件开这个口子：它们各只有一个端口，改它的位宽就是改「这个元件
 * 有多宽」。逻辑门、Clock 与 D Flip-Flop 固定按 1 位工作，不随输入变宽，因此不给它们开——
 * 需要更宽的值由用户显式用合线器构造。
 */
function widthAttributes(node: CanvasNode): WidthAttribute[] {
  if (node.kind !== "input" && node.kind !== "output") return [];
  const port = node.ports[0];
  if (!port || node.ports.length !== 1) return [];
  return [{ id: "width", label: "位宽", value: port.width, portName: port.id }];
}

/**
 * 位区间列表是拆线器与合线器的可编辑属性。
 *
 * 只给这两个数据驱动的元件开这个口子：它们的分支数量与每条分支覆盖的范围都由数据决定，
 * 而内置元件（逻辑门、Clock、D Flip-Flop）的端口形状是固定的，不随输入变宽。
 *
 * 宿主总线端口只用来标识「这笔提交改的是哪个元件的清单」，它的位宽不在这一条里改：改位区间
 * 不改变总线有多宽，而覆盖规则要求两者同时自洽。
 */
function bitRangeAttributes(node: CanvasNode): BitRangeAttribute[] {
  if (node.kind !== "splitter" && node.kind !== "merger") return [];
  const host = node.ports.find((port) => !port.bitRange);
  const branches = branchBitRanges(node.ports);
  if (!host || branches.length === 0) return [];
  return [{
    id: "bit-ranges",
    label: "位区间",
    value: formatBitRangeList(branches),
    portName: host.id,
  }];
}

/**
 * 从 CanvasScene 生成检查器模型，不暴露 position、engine ID 或生命周期。
 * @param scene 当前场景，包含节点、Wire 和端口信号。
 * @param selection 当前单对象选择。
 * @param registry Component 展示定义注册表，用于提供类型和行为摘要。
 * @returns Component、Wire 或空选择的只读详情。
 */
export function createInspectorModel(
  scene: CanvasScene,
  selection: EditorSelection,
  registry: ComponentDefinitionRegistry,
  subcircuitProjection: SubcircuitSignalProjection | null = null,
): InspectorModel {
  if (!selection) return null;
  if (selection.kind === "component") {
    const node = scene.nodes.find((candidate) => candidate.id === selection.id);
    if (!node) return null;
    const definition = registry.get(node.kind);
    const wires = scene.wires;
    const ports: InspectorPort[] = node.ports.map((port) => {
      const matches = wires.filter((wire) =>
        (wire.source.componentId === node.id && wire.source.port === port.id) ||
        (wire.target.componentId === node.id && wire.target.port === port.id),
      );
      // 位宽不再匹配的连接与端点缺失的连接都是悬空，检查器因此只报一种状态。
      const connectionState: InspectorPort["connectionState"] = matches.length === 0
        ? "unconnected"
        : matches.some((wire) => wire.dangling) ? "dangling" : "connected";
      return {
        id: port.id,
        name: port.name,
        label: port.label,
        direction: port.direction,
        width: port.width,
        signal: port.signal,
        connectionState,
      };
    });
    return {
      kind: "component",
      id: node.id,
      displayName: node.displayName,
      type: definition?.displayName ?? node.kind,
      behavior: definition?.description ?? node.description,
      signal: componentSignal(node),
      ports,
      attributes: [...widthAttributes(node), ...bitRangeAttributes(node)],
      hint: structuralHint(ports),
      ...(node.subcircuit ? { subcircuit: { ...node.subcircuit } } : {}),
      ...(node.subcircuit?.status === "resolved"
        ? { internalTable: createSubcircuitSignalTable(node.id, subcircuitProjection) ?? undefined }
        : {}),
    };
  }
  const wire = scene.wires.find((candidate) => candidate.id === selection.id);
  return wire ? wireInspector(wire) : null;
}

function wireInspector(wire: CanvasWire): WireInspector {
  return {
    kind: "wire",
    id: wire.id,
    source: { componentId: wire.source.componentId, port: wire.source.port },
    target: { componentId: wire.target.componentId, port: wire.target.port },
    signal: wire.signal,
    status: wire.dangling ? "dangling" : "normal",
    waypointCount: wire.waypoints?.length ?? Math.max(0, wire.route.length - 2),
  };
}

/** `createInspectorModel` 的短别名，便于调用方按领域语义阅读。 */
export const buildInspectorModel = createInspectorModel;
