import assert from "node:assert/strict";
import test from "node:test";
import { flattenProjectHierarchy, type HierarchyProjectReader } from "../src/project-file/hierarchy.ts";
import type { ProjectFileData } from "../src/project-file/index.ts";

const port = (name: string, direction: "input" | "output", width = 1) => ({ name, direction, width });
const input = (id: string, label: string, y: number, width = 1) => ({ id, kind: "input" as const, displayName: label, position: { x: 0, y }, ports: [port("out", "output", width)] });
const output = (id: string, label: string, y: number, width = 1) => ({ id, kind: "output" as const, displayName: label, position: { x: 100, y }, ports: [port("in", "input", width)] });
const sub = (id: string, reference: string, cachedPorts: readonly ReturnType<typeof port>[], portOrder?: readonly string[]) => ({
  id,
  kind: "subcircuit" as const,
  displayName: "子电路",
  position: { x: 50, y: 0 },
  data: { reference, cachedPorts, ...(portOrder ? { portOrder } : {}) },
});

function readerOf(files: Readonly<Record<string, ProjectFileData>>): HierarchyProjectReader {
  return { async read(identity) {
    const value = files[identity];
    return value ? { ok: true, value } : { ok: false, code: "file-not-found", message: "项目文件不存在。" };
  } };
}

test("resolves a single subcircuit, removes boundary components, and splices fan-out", async () => {
  const child: ProjectFileData = {
    version: 1,
    circuit: {
      components: [input("in", "A", 0), { id: "gate", kind: "not", displayName: "非门", position: { x: 40, y: 0 }, ports: [port("in", "input"), port("out", "output")] }, output("out", "Y", 0)],
      connections: [
        { id: "w1", source: { component: "in", port: "out" }, target: { component: "gate", port: "in" } },
        { id: "w2", source: { component: "gate", port: "out" }, target: { component: "out", port: "in" } },
      ],
    },
  };
  const root: ProjectFileData = {
    version: 1,
    circuit: {
      components: [input("src", "SRC", 0), sub("u1", "child.circuit.json", [port("A", "input"), port("Y", "output")]), output("sink", "SINK", 0)],
      connections: [
        { id: "in", source: { component: "src", port: "out" }, target: { component: "u1", port: "A" } },
        { id: "out", source: { component: "u1", port: "Y" }, target: { component: "sink", port: "in" } },
      ],
    },
  };
  const result = await flattenProjectHierarchy({
    rootIdentity: "C:\\circuits\\root.circuit.json",
    root,
    platform: "windows",
    reader: readerOf({ "c:\\circuits\\child.circuit.json": child }),
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.circuit.components.map((item) => item.id), ["src", "u1/gate", "sink"]);
  assert.equal(result.circuit.connections.some((item) => item.source.componentId === "src" && item.target.componentId === "u1/gate"), true);
  assert.equal(result.circuit.connections.some((item) => item.source.componentId === "u1/gate" && item.target.componentId === "sink"), true);
  assert.equal(result.document.components.find((item) => item.id === "u1")?.data?.subcircuit?.status, "resolved");
  assert.deepEqual(result.sources.components.u1, ["u1/gate"]);
  assert.deepEqual(result.sources.ports.u1?.A?.inputTargets, [{ componentId: "u1/gate", port: "in" }]);
  assert.deepEqual(result.sources.ports.u1?.Y?.outputSources, [{ componentId: "u1/gate", port: "out" }]);
});

test("keeps a missing child visible with cached ports and excludes its subtree", async () => {
  const root: ProjectFileData = {
    version: 1,
    circuit: {
      components: [sub("u1", "missing.circuit.json", [port("A", "input"), port("Y", "output")])],
      connections: [],
    },
  };
  const result = await flattenProjectHierarchy({
    rootIdentity: "/circuits/root.circuit.json",
    root,
    platform: "posix",
    reader: readerOf({}),
  });
  assert.equal(result.circuit.components.length, 0);
  assert.equal(result.document.components[0]?.data?.subcircuit?.status, "unresolved");
  assert.deepEqual(result.document.components[0]?.ports, [port("A", "input"), port("Y", "output")]);
  assert.equal(result.diagnostics[0]?.code, "file-not-found");
});

test("rejects duplicate interface labels and reports a cycle", async () => {
  const duplicate: ProjectFileData = {
    version: 1,
    circuit: { components: [input("a", "same", 0), output("b", "same", 10)], connections: [] },
  };
  const cycle: ProjectFileData = {
    version: 1,
    circuit: { components: [sub("self", "cycle.circuit.json", [port("A", "input")])], connections: [] },
  };
  const result = await flattenProjectHierarchy({
    rootIdentity: "/circuits/cycle.circuit.json",
    root: cycle,
    platform: "posix",
    reader: readerOf({ "/circuits/cycle.circuit.json": cycle, "/circuits/duplicate.circuit.json": duplicate }),
  });
  assert.equal(result.diagnostics[0]?.code, "reference-cycle");
  const duplicateResult = await flattenProjectHierarchy({
    rootIdentity: "/circuits/parent.circuit.json",
    root: { version: 1, circuit: { components: [sub("u", "duplicate.circuit.json", [port("same", "input")])], connections: [] } },
    platform: "posix",
    reader: readerOf({ "/circuits/duplicate.circuit.json": duplicate }),
  });
  assert.equal(duplicateResult.diagnostics.some((item) => item.code === "interface-duplicate-label"), true);
});

test("allows Clock in the root but rejects a Clock-bearing child Project", async () => {
  const childWithClock: ProjectFileData = {
    version: 1,
    circuit: {
      components: [
        { id: "clock", kind: "clock", displayName: "时钟", position: { x: 0, y: 0 } },
        input("in", "A", 0),
        output("out", "Y", 20),
      ],
      connections: [],
    },
  };
  const root: ProjectFileData = {
    version: 1,
    circuit: {
      components: [
        { id: "clock", kind: "clock", displayName: "顶层时钟", position: { x: 0, y: 0 } },
        sub("u1", "child.circuit.json", [port("A", "input"), port("Y", "output")]),
      ],
      connections: [],
    },
  };
  const result = await flattenProjectHierarchy({
    rootIdentity: "/circuits/root.circuit.json",
    root,
    platform: "posix",
    reader: readerOf({ "/circuits/child.circuit.json": childWithClock }),
  });
  assert.equal(result.circuit.components.some((entry) => entry.id === "clock"), true);
  assert.equal(result.circuit.components.some((entry) => entry.id.startsWith("u1/")), false);
  assert.equal(result.document.components.find((entry) => entry.id === "u1")?.data?.subcircuit?.status, "unresolved");
  assert.equal(result.diagnostics.some((item) => item.code === "interface-clock-unsupported"), true);
});

test("gives repeated subcircuit occurrences stable component, connection, and ownership IDs", async () => {
  const child: ProjectFileData = {
    version: 1,
    circuit: {
      components: [input("in", "A", 0), { id: "gate", kind: "not", displayName: "非门", position: { x: 40, y: 0 }, ports: [port("in", "input"), port("out", "output")] }, { id: "gate2", kind: "not", displayName: "非门 2", position: { x: 70, y: 0 }, ports: [port("in", "input"), port("out", "output")] }, output("out", "Y", 0)],
      connections: [
        { id: "w-in", source: { component: "in", port: "out" }, target: { component: "gate", port: "in" } },
        { id: "w-mid", source: { component: "gate", port: "out" }, target: { component: "gate2", port: "in" } },
        { id: "w-out", source: { component: "gate2", port: "out" }, target: { component: "out", port: "in" } },
      ],
    },
  };
  const root: ProjectFileData = {
    version: 1,
    circuit: {
      components: [
        input("src1", "S1", 0),
        sub("u1", "child.circuit.json", [port("A", "input"), port("Y", "output")]),
        input("src2", "S2", 80),
        sub("u2", "child.circuit.json", [port("A", "input"), port("Y", "output")]),
        output("sink1", "O1", 0),
        output("sink2", "O2", 80),
      ],
      connections: [
        { id: "in1", source: { component: "src1", port: "out" }, target: { component: "u1", port: "A" } },
        { id: "out1", source: { component: "u1", port: "Y" }, target: { component: "sink1", port: "in" } },
        { id: "in2", source: { component: "src2", port: "out" }, target: { component: "u2", port: "A" } },
        { id: "out2", source: { component: "u2", port: "Y" }, target: { component: "sink2", port: "in" } },
      ],
    },
  };
  const result = await flattenProjectHierarchy({
    rootIdentity: "/circuits/root.circuit.json",
    root,
    platform: "posix",
    reader: readerOf({ "/circuits/child.circuit.json": child }),
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.sources.components.u1, ["u1/gate", "u1/gate2"]);
  assert.deepEqual(result.sources.components.u2, ["u2/gate", "u2/gate2"]);
  assert.deepEqual(result.sources.ownedConnections.u1, ["u1/w-mid"]);
  assert.deepEqual(result.sources.ownedConnections.u2, ["u2/w-mid"]);
  assert.deepEqual(result.circuit.components.filter((entry) => entry.kind === "not").map((entry) => entry.id), ["u1/gate", "u1/gate2", "u2/gate", "u2/gate2"]);
  assert.equal(result.circuit.connections.some((entry) => entry.id === "u1/w-mid"), true);
  assert.equal(result.circuit.connections.some((entry) => entry.id === "u2/w-mid"), true);
  assert.equal("src1" in result.sources.ports, false);
  assert.equal("sink1" in result.sources.ports, false);
});

test("resolves nested references relative to each containing Project", async () => {
  const grandchild: ProjectFileData = {
    version: 1,
    circuit: {
      components: [input("in", "A", 0), { id: "gate", kind: "not", displayName: "非门", position: { x: 40, y: 0 }, ports: [port("in", "input"), port("out", "output")] }, output("out", "Y", 0)],
      connections: [
        { id: "in", source: { component: "in", port: "out" }, target: { component: "gate", port: "in" } },
        { id: "out", source: { component: "gate", port: "out" }, target: { component: "out", port: "in" } },
      ],
    },
  };
  const child: ProjectFileData = {
    version: 1,
    circuit: {
      components: [
        input("in", "A", 0),
        sub("g1", "../lib/grand.circuit.json", [port("A", "input"), port("Y", "output")]),
        output("out", "Y", 0),
      ],
      connections: [
        { id: "in", source: { component: "in", port: "out" }, target: { component: "g1", port: "A" } },
        { id: "out", source: { component: "g1", port: "Y" }, target: { component: "out", port: "in" } },
      ],
    },
  };
  const root: ProjectFileData = {
    version: 1,
    circuit: {
      components: [input("src", "S", 0), sub("u1", "sub/child.circuit.json", [port("A", "input"), port("Y", "output")]), output("sink", "O", 0)],
      connections: [
        { id: "in", source: { component: "src", port: "out" }, target: { component: "u1", port: "A" } },
        { id: "out", source: { component: "u1", port: "Y" }, target: { component: "sink", port: "in" } },
      ],
    },
  };
  const result = await flattenProjectHierarchy({
    rootIdentity: "/circuits/root.circuit.json",
    root,
    platform: "posix",
    reader: readerOf({
      "/circuits/sub/child.circuit.json": child,
      "/circuits/lib/grand.circuit.json": grandchild,
    }),
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.circuit.components.map((entry) => entry.id), ["src", "u1/g1/gate", "sink"]);
  assert.equal(result.circuit.connections.some((entry) => entry.source.componentId === "src" && entry.target.componentId === "u1/g1/gate"), true);
  assert.equal(result.circuit.connections.some((entry) => entry.source.componentId === "u1/g1/gate" && entry.target.componentId === "sink"), true);
});

test("does not merge partial flat output when a nested branch fails", async () => {
  const child: ProjectFileData = {
    version: 1,
    circuit: {
      components: [
        input("in", "A", 0),
        { id: "gate", kind: "not", displayName: "非门", position: { x: 40, y: 0 }, ports: [port("in", "input"), port("out", "output")] },
        sub("broken", "missing.circuit.json", [port("A", "input"), port("Y", "output")]),
        output("out", "Y", 0),
      ],
      connections: [{ id: "w", source: { component: "in", port: "out" }, target: { component: "gate", port: "in" } }],
    },
  };
  const root: ProjectFileData = {
    version: 1,
    circuit: {
      components: [sub("u1", "child.circuit.json", [port("A", "input"), port("Y", "output")])],
      connections: [],
    },
  };
  const result = await flattenProjectHierarchy({
    rootIdentity: "/circuits/root.circuit.json",
    root,
    platform: "posix",
    reader: readerOf({ "/circuits/child.circuit.json": child }),
  });
  assert.equal(result.circuit.components.some((entry) => entry.id.startsWith("u1/")), false);
  assert.equal(result.circuit.connections.some((entry) => entry.id.startsWith("u1/")), false);
  assert.equal(result.document.components[0]?.data?.subcircuit?.status, "unresolved");
  assert.equal(result.diagnostics.some((item) => item.code === "file-not-found"), true);
});
