import type { PortSpec } from "@circuit-platform/protocol";
import type { ProjectFileCircuit, ProjectFileData } from "./index.ts";

/** 层次性能基准使用的完整内嵌 Project 与文件身份。 */
export interface HierarchyPerformanceFixture {
  rootIdentity: string;
  root: ProjectFileData;
  /** 兼容旧基准的读文件 seam；v2 展平仅使用 root.definitions。 */
  files: ReadonlyMap<string, ProjectFileData>;
}

const bit = (name: string, direction: PortSpec["direction"]): PortSpec => ({ name, direction, width: 1 });
const budgetInterfacePorts: readonly PortSpec[] = [bit("IN", "input"), bit("OUT", "output")];

/**
 * 创建三层、可被生产展平器读取的 500 Component / 1,000 Connection 内嵌定义夹具。
 * 根工程保存 wrapper 和 core 两份定义；文件读取器不参与展平。
 * @returns 自包含 v2 工程、身份和兼容旧基准的文件映射。
 */
export function createHierarchyPerformanceFixture(): HierarchyPerformanceFixture {
  const rootIdentity = "/benchmark/budget-root.circuit.json";
  const mergerPorts = Array.from({ length: 8 }, (_, index) => bit("in" + index, "input"));
  mergerPorts.push(bit("out", "output"));

  const core: ProjectFileCircuit = {
    components: [
      { id: "source", kind: "input", displayName: "IN", position: { x: 0, y: 0 }, ports: [bit("out", "output")] },
      ...Array.from({ length: 373 }, (_, index) => ({
        id: "n" + index,
        kind: "not" as const,
        displayName: "NOT " + index,
        position: { x: 120, y: index * 20 },
      })),
      ...Array.from({ length: 125 }, (_, index) => ({
        id: "m" + index,
        kind: "merger" as const,
        displayName: "MERGE " + index,
        position: { x: 360, y: index * 20 },
        ports: mergerPorts,
      })),
      { id: "sink", kind: "output", displayName: "OUT", position: { x: 600, y: 0 }, ports: [bit("in", "input")] },
    ],
    connections: [
      { id: "source-to-not", source: { component: "source", port: "out" }, target: { component: "n0", port: "in" } },
      ...Array.from({ length: 125 }, (_, mergerIndex) =>
        Array.from({ length: 8 }, (_, branchIndex) => {
          const index = mergerIndex * 8 + branchIndex;
          return {
            id: "wire-" + index,
            source: { component: "n" + index % 373, port: "out" },
            target: { component: "m" + mergerIndex, port: "in" + branchIndex },
          };
        }),
      ).flat().slice(0, 998),
      { id: "not-to-sink", source: { component: "n0", port: "out" }, target: { component: "sink", port: "in" } },
    ],
  };

  const wrapper: ProjectFileCircuit = {
    components: [
      { id: "source", kind: "input", displayName: "IN", position: { x: 0, y: 0 }, ports: [bit("out", "output")] },
      {
        id: "core", kind: "subcircuit", displayName: "budget-core.circuit.json", position: { x: 160, y: 0 },
        data: { definitionId: "core", cachedPorts: budgetInterfacePorts },
      },
      { id: "sink", kind: "output", displayName: "OUT", position: { x: 320, y: 0 }, ports: [bit("in", "input")] },
    ],
    connections: [
      { id: "source-to-core", source: { component: "source", port: "out" }, target: { component: "core", port: "IN" } },
      { id: "core-to-sink", source: { component: "core", port: "OUT" }, target: { component: "sink", port: "in" } },
    ],
  };

  const root: ProjectFileData = {
    version: 2,
    circuit: {
      components: [
        { id: "source", kind: "input", displayName: "IN", position: { x: 0, y: 0 }, ports: [bit("out", "output")], data: { value: "1" } },
        {
          id: "wrapper", kind: "subcircuit", displayName: "budget-wrapper.circuit.json", position: { x: 160, y: 0 },
          data: { definitionId: "wrapper", cachedPorts: budgetInterfacePorts },
        },
        { id: "sink", kind: "output", displayName: "OUT", position: { x: 320, y: 0 }, ports: [bit("in", "input")] },
      ],
      connections: [
        { id: "source-to-wrapper", source: { component: "source", port: "out" }, target: { component: "wrapper", port: "IN" } },
        { id: "wrapper-to-sink", source: { component: "wrapper", port: "OUT" }, target: { component: "sink", port: "in" } },
      ],
    },
    definitions: {
      wrapper: { displayName: "budget-wrapper.circuit.json", circuit: wrapper },
      core: { displayName: "budget-core.circuit.json", circuit: core },
    },
    libraryRoots: ["wrapper"],
  };

  return { rootIdentity, root, files: new Map([[rootIdentity, root]]) };
}
