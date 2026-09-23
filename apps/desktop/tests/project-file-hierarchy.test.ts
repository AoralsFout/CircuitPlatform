import assert from "node:assert/strict";
import test from "node:test";
import { flattenProjectHierarchy } from "../src/project-file/hierarchy.ts";
import type { ProjectFileCircuit, ProjectFileData } from "../src/project-file/index.ts";

const port = (name: string, direction: "input" | "output", width = 1) => ({ name, direction, width });
const input = (id: string, label: string, y = 0) => ({
  id, kind: "input" as const, displayName: label, position: { x: 0, y }, ports: [port("out", "output")],
});
const output = (id: string, label: string, y = 0) => ({
  id, kind: "output" as const, displayName: label, position: { x: 400, y }, ports: [port("in", "input")],
});
const gate = (id: string) => ({
  id, kind: "not" as const, displayName: "NOT", position: { x: 200, y: 0 },
  ports: [port("in", "input"), port("out", "output")],
});
const sub = (id: string, definitionId: string, cachedPorts = [port("A", "input"), port("Y", "output")], portOrder?: readonly string[]) => ({
  id, kind: "subcircuit" as const, displayName: "子电路", position: { x: 100, y: 0 },
  data: { definitionId, cachedPorts, ...(portOrder ? { portOrder } : {}) },
});
const wire = (id: string, from: string, fromPort: string, to: string, toPort: string) => ({
  id, source: { component: from, port: fromPort }, target: { component: to, port: toPort },
});
const circuit = (components: ProjectFileCircuit["components"], connections: ProjectFileCircuit["connections"] = []): ProjectFileCircuit =>
  ({ components, connections });
const project = (root: ProjectFileCircuit, definitions: ProjectFileData["definitions"] = {}): ProjectFileData =>
  ({ version: 2, circuit: root, definitions, libraryRoots: Object.keys(definitions) });
const definition = (body: ProjectFileCircuit) => ({ displayName: "embedded.circuit.json", circuit: body });

async function flatten(file: ProjectFileData) {
  return flattenProjectHierarchy({
    rootIdentity: "/anywhere/parent.circuit.json",
    root: file,
    platform: "posix",
    reader: { async read() { throw new Error("embedded definition must not read source file"); } },
  });
}

test("uses the embedded definition, removes boundary components, and splices fan-out", async () => {
  const child = circuit(
    [input("in", "A"), gate("g"), output("out", "Y")],
    [wire("inside-in", "in", "out", "g", "in"), wire("inside-out", "g", "out", "out", "in")],
  );
  const root = circuit(
    [input("src", "SRC"), sub("u", "child"), output("sink1", "S1"), output("sink2", "S2")],
    [wire("into", "src", "out", "u", "A"), wire("out1", "u", "Y", "sink1", "in"), wire("out2", "u", "Y", "sink2", "in")],
  );
  const result = await flatten(project(root, { child: definition(child) }));
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.circuit.components.map((item) => item.id), ["src", "u/g", "sink1", "sink2"]);
  assert.equal(result.circuit.connections.some((item) => item.source.componentId === "src" && item.target.componentId === "u/g"), true);
  assert.equal(result.circuit.connections.filter((item) => item.source.componentId === "u/g").length, 2);
  assert.equal(result.document.components.find((item) => item.id === "u")?.data?.subcircuit?.status, "resolved");
  assert.deepEqual(result.sources.components.u, ["u/g"]);
  assert.deepEqual(result.sources.ports.u?.A?.inputTargets, [{ componentId: "u/g", port: "in" }]);
  assert.deepEqual(result.sources.ports.u?.Y?.outputSources, [{ componentId: "u/g", port: "out" }]);
});

test("a missing definition retains cached ports and leaves independent siblings runnable", async () => {
  const root = circuit(
    [input("src", "SRC"), sub("missing", "gone", [port("OLD", "input")]), gate("ordinary")],
    [wire("working", "src", "out", "ordinary", "in"), wire("dangling", "src", "out", "missing", "OLD")],
  );
  const result = await flatten(project(root));
  assert.equal(result.document.components.find((item) => item.id === "missing")?.data?.subcircuit?.status, "unresolved");
  assert.deepEqual(result.document.components.find((item) => item.id === "missing")?.ports, [port("OLD", "input")]);
  assert.ok(result.diagnostics.some((item) => item.code === "definition-missing"));
  assert.ok(result.circuit.components.some((item) => item.id === "ordinary"));
  assert.ok(result.circuit.connections.some((item) => item.source.componentId === "src" && item.target.componentId === "ordinary"));
  assert.equal(result.circuit.connections.some((item) => item.id === "dangling"), false);
});

test("two uses of one definition get distinct flat IDs and internal signal ownership", async () => {
  const child = circuit(
    [input("in", "A"), gate("g"), output("out", "Y")],
    [wire("to-g", "in", "out", "g", "in"), wire("from-g", "g", "out", "out", "in")],
  );
  const result = await flatten(project(
    circuit([sub("left", "shared"), sub("right", "shared")]),
    { shared: definition(child) },
  ));
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.sources.components.left, ["left/g"]);
  assert.deepEqual(result.sources.components.right, ["right/g"]);
  assert.deepEqual(result.sources.internalComponents.left?.map((item) => item.flatId), ["left/g"]);
  assert.deepEqual(result.sources.internalComponents.right?.map((item) => item.flatId), ["right/g"]);
});

test("nested embedded definitions preserve boundary splicing without source paths", async () => {
  const passthrough = circuit(
    [input("in", "A"), output("out", "Y")],
    [wire("through", "in", "out", "out", "in")],
  );
  const wrapper = circuit(
    [input("in", "A"), sub("nested", "leaf"), output("out", "Y")],
    [wire("into", "in", "out", "nested", "A"), wire("from", "nested", "Y", "out", "in")],
  );
  const root = circuit(
    [input("src", "SRC"), sub("u", "wrapper"), output("sink", "SINK")],
    [wire("into", "src", "out", "u", "A"), wire("from", "u", "Y", "sink", "in")],
  );
  const result = await flatten(project(root, { wrapper: definition(wrapper), leaf: definition(passthrough) }));
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.circuit.components.map((item) => item.id), ["src", "sink"]);
  assert.equal(result.circuit.connections.some((item) => item.source.componentId === "src" && item.target.componentId === "sink"), true);
});

test("a missing nested definition keeps healthy branches of its containing definition runnable", async () => {
  const wrapper = circuit(
    [input("in", "A"), gate("g"), sub("broken", "missing"), output("out", "Y")],
    [wire("to-g", "in", "out", "g", "in")],
  );
  const result = await flatten(project(
    circuit([sub("u", "wrapper"), gate("sibling")]),
    { wrapper: definition(wrapper) },
  ));
  assert.ok(result.diagnostics.some((item) => item.code === "definition-missing"));
  assert.ok(result.circuit.components.some((item) => item.id === "u/g"));
  assert.ok(result.circuit.components.some((item) => item.id === "sibling"));
  assert.equal(result.document.components.find((item) => item.id === "u")?.data?.subcircuit?.status, "resolved");
});

test("an existing dangling subcircuit port is diagnosed and omitted from the flat circuit", async () => {
  const leaf = circuit([input("in", "A"), output("out", "Y")], [wire("through", "in", "out", "out", "in")]);
  const wrapper = circuit(
    [input("src", "A"), sub("nested", "leaf"), gate("healthy")],
    [wire("stale", "src", "out", "nested", "OLD"), wire("working", "src", "out", "healthy", "in")],
  );
  const result = await flatten(project(
    circuit([input("outside", "SRC"), sub("u", "wrapper")], [wire("drive", "outside", "out", "u", "A")]),
    { wrapper: definition(wrapper), leaf: definition(leaf) },
  ));
  assert.ok(result.diagnostics.some((item) => item.code === "dangling-connection"));
  assert.ok(result.circuit.components.some((item) => item.id === "u/healthy"));
  assert.equal(result.circuit.connections.some((item) => item.id.includes("stale")), false);
  assert.ok(result.circuit.connections.some((item) => item.source.componentId === "outside" && item.target.componentId === "u/healthy"));
});

test("top-level Clock works while an embedded Clock definition reports an interface diagnostic", async () => {
  const root = circuit([
    { id: "clock", kind: "clock", displayName: "Clock", position: { x: 0, y: 0 } },
    sub("u", "clocked"),
  ]);
  const child = circuit([
    { id: "inner-clock", kind: "clock", displayName: "Clock", position: { x: 0, y: 0 } },
    input("in", "A"), output("out", "Y"),
  ]);
  const result = await flatten(project(root, { clocked: definition(child) }));
  assert.ok(result.circuit.components.some((item) => item.id === "clock"));
  assert.equal(result.circuit.components.some((item) => item.id === "u/inner-clock"), false);
  assert.ok(result.diagnostics.some((item) => item.code === "interface-clock-unsupported"));
});
