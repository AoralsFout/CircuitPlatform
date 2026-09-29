import type { PortSpec } from "@circuit-platform/protocol";
import type { ProjectFileData } from "../../src/project-file/index.ts";

const inputPorts: readonly PortSpec[] = [{ name: "out", direction: "output", width: 1 }];
const outputPorts: readonly PortSpec[] = [{ name: "in", direction: "input", width: 1 }];
const childPorts = [
  { name: "d", direction: "input", width: 1 },
  { name: "clock", direction: "input", width: 1 },
  { name: "q", direction: "output", width: 1 },
  { name: "nq", direction: "output", width: 1 },
] as const;

/** 返回供真实 Electron/JSON Lines/C++ 场景共用的一位 DFF 子电路。 */
export function multiDocumentChildProject(): ProjectFileData {
  return {
    version: 2,
    circuit: {
      components: [
        { id: "boundary-d", kind: "input", displayName: "d", position: { x: 0, y: 0 }, ports: inputPorts },
        { id: "boundary-clock", kind: "input", displayName: "clock", position: { x: 0, y: 80 }, ports: inputPorts },
        { id: "ff", kind: "d_flip_flop", displayName: "FF", position: { x: 180, y: 40 } },
        { id: "invert-q", kind: "not", displayName: "NOT Q", position: { x: 300, y: 110 } },
        { id: "boundary-q", kind: "output", displayName: "q", position: { x: 420, y: 40 }, ports: outputPorts },
        { id: "boundary-nq", kind: "output", displayName: "nq", position: { x: 420, y: 120 }, ports: outputPorts },
      ],
      connections: [
        { id: "d-to-ff", source: { component: "boundary-d", port: "out" }, target: { component: "ff", port: "d" } },
        { id: "clock-to-ff", source: { component: "boundary-clock", port: "out" }, target: { component: "ff", port: "clock" } },
        { id: "ff-to-q", source: { component: "ff", port: "q" }, target: { component: "boundary-q", port: "in" } },
        { id: "ff-to-not", source: { component: "ff", port: "q" }, target: { component: "invert-q", port: "in" } },
        { id: "not-to-nq", source: { component: "invert-q", port: "out" }, target: { component: "boundary-nq", port: "in" } },
      ],
    },
    definitions: {},
    libraryRoots: [],
  };
}

/** 返回两个 occurrence 共用的父 Project；所有稳定 ID 刻意保持可读且可断言。 */
export function multiDocumentParentProject(): ProjectFileData {
  const wrapperData = { definitionId: "child", cachedPorts: childPorts } as const;
  return {
    version: 2,
    circuit: {
      components: [
        { id: "data-1", kind: "input", displayName: "Data 1", position: { x: 0, y: 0 }, ports: inputPorts, data: { value: "0" } },
        { id: "clock-1", kind: "input", displayName: "Clock 1", position: { x: 0, y: 80 }, ports: inputPorts, data: { value: "0" } },
        { id: "data-2", kind: "input", displayName: "Data 2", position: { x: 0, y: 240 }, ports: inputPorts, data: { value: "0" } },
        { id: "clock-2", kind: "input", displayName: "Clock 2", position: { x: 0, y: 320 }, ports: inputPorts, data: { value: "0" } },
        { id: "u1", kind: "subcircuit", displayName: "child.circuit.json (1)", position: { x: 260, y: 40 }, data: wrapperData },
        { id: "u2", kind: "subcircuit", displayName: "child.circuit.json (2)", position: { x: 260, y: 240 }, data: wrapperData },
        { id: "out-1", kind: "output", displayName: "Q 1", position: { x: 540, y: 40 }, ports: outputPorts },
        { id: "out-nq-1", kind: "output", displayName: "NQ 1", position: { x: 540, y: 100 }, ports: outputPorts },
        { id: "out-2", kind: "output", displayName: "Q 2", position: { x: 540, y: 240 }, ports: outputPorts },
        { id: "out-nq-2", kind: "output", displayName: "NQ 2", position: { x: 540, y: 300 }, ports: outputPorts },
      ],
      connections: [
        { id: "u1-d", source: { component: "data-1", port: "out" }, target: { component: "u1", port: "d" } },
        { id: "u1-clock", source: { component: "clock-1", port: "out" }, target: { component: "u1", port: "clock" } },
        { id: "u1-q", source: { component: "u1", port: "q" }, target: { component: "out-1", port: "in" } },
        { id: "u1-nq", source: { component: "u1", port: "nq" }, target: { component: "out-nq-1", port: "in" } },
        { id: "u2-d", source: { component: "data-2", port: "out" }, target: { component: "u2", port: "d" } },
        { id: "u2-clock", source: { component: "clock-2", port: "out" }, target: { component: "u2", port: "clock" } },
        { id: "u2-q", source: { component: "u2", port: "q" }, target: { component: "out-2", port: "in" } },
        { id: "u2-nq", source: { component: "u2", port: "nq" }, target: { component: "out-nq-2", port: "in" } },
      ],
    },
    definitions: { child: { displayName: "child.circuit.json", circuit: multiDocumentChildProject().circuit } },
    libraryRoots: ["child"],
  };
}

/** Peer 使用与父文档相同的 Editor ID，验证运行时键而不是 ID 能隔离仿真状态。 */
export function multiDocumentPeerProject(): ProjectFileData {
  return {
    version: 2,
    circuit: {
      components: [
        { id: "clock", kind: "clock", displayName: "Clock", position: { x: 0, y: 0 } },
        { id: "data", kind: "input", displayName: "Data", position: { x: 0, y: 80 }, ports: inputPorts, data: { value: "1" } },
        { id: "flop", kind: "d_flip_flop", displayName: "Peer FF", position: { x: 180, y: 40 } },
        { id: "probe", kind: "output", displayName: "Probe", position: { x: 360, y: 40 }, ports: outputPorts },
      ],
      connections: [
        { id: "clock-wire", source: { component: "clock", port: "out" }, target: { component: "flop", port: "clock" } },
        { id: "data-wire", source: { component: "data", port: "out" }, target: { component: "flop", port: "d" } },
        { id: "probe-wire", source: { component: "flop", port: "q" }, target: { component: "probe", port: "in" } },
      ],
    },
    definitions: {},
    libraryRoots: [],
  };
}

/** 修改源文件的端口；父工程仍应使用已保存的内嵌定义。 */
export function incompatibleMultiDocumentChildProject(): ProjectFileData {
  const changed = multiDocumentChildProject();
  return {
    version: changed.version,
    circuit: {
      components: changed.circuit.components.filter((component) => component.id !== "boundary-nq"),
      connections: changed.circuit.connections.filter((connection) => connection.id !== "not-to-nq"),
    },
    definitions: {},
    libraryRoots: [],
  };
}
