import type { Signal } from "@circuit-platform/protocol";
import type { ComponentDefinitionRegistry, CanvasNode, CanvasScene, CanvasWire } from "../canvas";
import type { EditorSelection } from "./index";

export interface InspectorPort {
  id: string;
  name: string;
  direction: "input" | "output";
  signal: Signal;
  connectionState: "connected" | "dangling" | "unconnected";
}

export interface ComponentInspector {
  kind: "component";
  id: string;
  displayName: string;
  type: string;
  behavior: string;
  signal: Signal;
  ports: readonly InspectorPort[];
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
 * 从 CanvasScene 生成只读检查器模型，不暴露 position、engine ID 或生命周期。
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
    return {
      kind: "component",
      id: node.id,
      displayName: node.displayName,
      type: definition?.displayName ?? node.kind,
      behavior: definition?.description ?? node.description,
      signal: componentSignal(node),
      ports: node.ports.map((port) => {
        const matches = wires.filter((wire) =>
          (wire.source.componentId === node.id && wire.source.port === port.id) ||
          (wire.target.componentId === node.id && wire.target.port === port.id),
        );
        return {
          id: port.id,
          name: port.name,
          direction: port.direction,
          signal: port.signal,
          connectionState: matches.length === 0
            ? "unconnected"
            : matches.some((wire) => wire.danglingEndpoints.length > 0) ? "dangling" : "connected",
        };
      }),
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
    status: wire.danglingEndpoints.length > 0 ? "dangling" : "normal",
    waypointCount: wire.waypoints?.length ?? Math.max(0, wire.route.length - 2),
  };
}

/** `createInspectorModel` 的短别名，便于调用方按领域语义阅读。 */
export const buildInspectorModel = createInspectorModel;
