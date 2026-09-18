import type { Signal } from "@circuit-platform/protocol";
import type { ComponentDefinitionRegistry, CanvasNode, CanvasScene, CanvasWire } from "../canvas";
import type { EditorSelection } from "./index";

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
 * 第一版只有位宽，而它是列表里的第一项——ADR 0014 说过第一版不引入没有实际用例的可编辑
 * 属性，位宽是第一个真实例外。
 */
export interface InspectorAttribute {
  id: "width";
  label: string;
  /** 当前值。提交失败时这里仍是提交前的值，因为模型是从文档投影出来的。 */
  value: number;
  /** 这个属性作用在哪个端口上；提交时用它拼出整份端口清单。 */
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
  /** 可编辑属性；位宽是第一个。元件没有可编辑属性时为空数组。 */
  attributes: readonly InspectorAttribute[];
  /**
   * 结构提示：组件缺少能驱动它的连接时给出一行可展示的说明；没有问题时为 null。
   * 这是结构问题而不是错误，因此不进入 error 字段。
   */
  hint: string | null;
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
function widthAttributes(node: CanvasNode): InspectorAttribute[] {
  if (node.kind !== "input" && node.kind !== "output") return [];
  const port = node.ports[0];
  if (!port || node.ports.length !== 1) return [];
  return [{ id: "width", label: "位宽", value: port.width, portName: port.id }];
}

/**
 * 从 CanvasScene 生成检查器模型，不暴露 position、engine ID 或生命周期。
 * @param scene 当前场景，包含节点、Wire 和端口信号。
 * @param selection 当前单对象选择。
 * @param registry Component 展示定义注册表，用于提供类型和行为摘要。
 * @returns Component、Wire 或空选择的只读详情。
 */
export function createInspectorModel(scene: CanvasScene, selection: EditorSelection, registry: ComponentDefinitionRegistry): InspectorModel {
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
      attributes: widthAttributes(node),
      hint: structuralHint(ports),
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
