import type { PortSpec } from "@circuit-platform/protocol";
import type { ProjectFileData } from "./index.ts";

/** 层次性能基准使用的真实 Project 图及其规范化身份。 */
export interface HierarchyPerformanceFixture {
  rootIdentity: string;
  root: ProjectFileData;
  files: ReadonlyMap<string, ProjectFileData>;
}

const bit = (name: string, direction: PortSpec["direction"]): PortSpec => ({ name, direction, width: 1 });
const budgetInterfacePorts: readonly PortSpec[] = [bit("IN", "input"), bit("OUT", "output")];

/**
 * 创建三层、可被生产递归展平器读取的 500 Component / 1,000 Connection Project 夹具。
 *
 * 根 Project 使用 wrapper，wrapper 再使用 core；core 内含 498 个普通元件和 998 条内部线，
 * 两条跨层边界线补足目标规模。文件身份采用 POSIX 形式，浏览器基准显式使用同一平台语义。
 * @returns 根文件、子文件及其规范化身份；不执行文件系统读写。
 */
export function createHierarchyPerformanceFixture(): HierarchyPerformanceFixture {
  const rootIdentity = "/benchmark/budget-root.circuit.json";
  const wrapperIdentity = "/benchmark/budget-wrapper.circuit.json";
  const coreIdentity = "/benchmark/budget-core.circuit.json";
  const mergerPorts = Array.from({ length: 8 }, (_, index) => bit(`in${index}`, "input"));
  mergerPorts.push(bit("out", "output"));

  const core: ProjectFileData = {
    version: 1,
    circuit: {
      components: [
        { id: "source", kind: "input", displayName: "IN", position: { x: 0, y: 0 }, ports: [bit("out", "output")] },
        ...Array.from({ length: 373 }, (_, index) => ({
          id: `n${index}`,
          kind: "not" as const,
          displayName: `NOT ${index}`,
          position: { x: 120, y: index * 20 },
        })),
        ...Array.from({ length: 125 }, (_, index) => ({
          id: `m${index}`,
          kind: "merger" as const,
          displayName: `MERGE ${index}`,
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
              id: `wire-${index}`,
              source: { component: `n${index % 373}`, port: "out" },
              target: { component: `m${mergerIndex}`, port: `in${branchIndex}` },
            };
          }),
        ).flat().slice(0, 998),
        { id: "not-to-sink", source: { component: "n0", port: "out" }, target: { component: "sink", port: "in" } },
      ],
    },
  };

  const wrapper: ProjectFileData = {
    version: 1,
    circuit: {
      components: [
        { id: "source", kind: "input", displayName: "IN", position: { x: 0, y: 0 }, ports: [bit("out", "output")] },
        {
          id: "core",
          kind: "subcircuit",
          displayName: "budget-core.circuit.json",
          position: { x: 160, y: 0 },
          data: { reference: "./budget-core.circuit.json", cachedPorts: budgetInterfacePorts },
        },
        { id: "sink", kind: "output", displayName: "OUT", position: { x: 320, y: 0 }, ports: [bit("in", "input")] },
      ],
      connections: [
        { id: "source-to-core", source: { component: "source", port: "out" }, target: { component: "core", port: "IN" } },
        { id: "core-to-sink", source: { component: "core", port: "OUT" }, target: { component: "sink", port: "in" } },
      ],
    },
  };

  const root: ProjectFileData = {
    version: 1,
    circuit: {
      components: [
        { id: "source", kind: "input", displayName: "IN", position: { x: 0, y: 0 }, ports: [bit("out", "output")], data: { value: "1" } },
        {
          id: "wrapper",
          kind: "subcircuit",
          displayName: "budget-wrapper.circuit.json",
          position: { x: 160, y: 0 },
          data: { reference: "./budget-wrapper.circuit.json", cachedPorts: budgetInterfacePorts },
        },
        { id: "sink", kind: "output", displayName: "OUT", position: { x: 320, y: 0 }, ports: [bit("in", "input")] },
      ],
      connections: [
        { id: "source-to-wrapper", source: { component: "source", port: "out" }, target: { component: "wrapper", port: "IN" } },
        { id: "wrapper-to-sink", source: { component: "wrapper", port: "OUT" }, target: { component: "sink", port: "in" } },
      ],
    },
  };

  return {
    rootIdentity,
    root,
    files: new Map([
      [rootIdentity, root],
      [wrapperIdentity, wrapper],
      [coreIdentity, core],
    ]),
  };
}
