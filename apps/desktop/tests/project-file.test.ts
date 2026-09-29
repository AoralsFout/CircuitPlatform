import assert from "node:assert/strict";
import test from "node:test";
import type { EditorConnection, EditorDocument, Point } from "../src/editor/index.ts";
import { importProjectSnapshot } from "../src/project-file/definitions.ts";
import {
  PROJECT_FILE_VERSION,
  parseProjectFile,
  serializeProjectFile,
  type ProjectFileCircuit,
  type ProjectFileData,
  type ProjectFileError,
  type ParsedProjectFile,
} from "../src/project-file/index.ts";

const at = (x: number, y: number): Point => ({ x, y });
const port = (name: string, direction: "input" | "output", width = 1) => ({ name, direction, width });
const emptyCircuit = (): ProjectFileCircuit => ({ components: [], connections: [] });
const project = (circuit: ProjectFileCircuit = emptyCircuit(), definitions: ProjectFileData["definitions"] = {}, libraryRoots: readonly string[] = []): ProjectFileData =>
  ({ version: 2, circuit, definitions, libraryRoots });
const input = (id: string, label: string, width = 1) => ({
  id, kind: "input" as const, displayName: label, position: at(0, 0), ports: [port("out", "output", width)],
});
const output = (id: string, label: string, width = 1) => ({
  id, kind: "output" as const, displayName: label, position: at(200, 0), ports: [port("in", "input", width)],
});
const sub = (id: string, definitionId: string, cachedPorts = [port("A", "input"), port("Y", "output")]) => ({
  id, kind: "subcircuit" as const, displayName: "子电路", position: at(100, 0),
  data: { definitionId, cachedPorts },
});
const wire = (id: string, source: string, sourcePort: string, target: string, targetPort: string) => ({
  id, source: { component: source, port: sourcePort }, target: { component: target, port: targetPort },
});
const passThrough = (): ProjectFileCircuit => ({
  components: [input("in", "A"), output("out", "Y")],
  connections: [wire("through", "in", "out", "out", "in")],
});

function successOf(raw: unknown): ParsedProjectFile {
  const result = parseProjectFile(raw);
  assert.ok(result.ok, result.ok ? "" : result.errors.map((error) => error.message).join("; "));
  return result.value;
}

function failureOf(raw: unknown): readonly ProjectFileError[] {
  const result = parseProjectFile(raw);
  assert.equal(result.ok, false);
  return result.ok ? [] : result.errors;
}

const codesOf = (errors: readonly ProjectFileError[]) => errors.map((error) => error.code);

test("serializes a new circuit as the complete v2 file shape", () => {
  const document: EditorDocument = {
    components: [{
      id: "source", kind: "input", displayName: "输入", position: at(4, 8), lifecycle: "active",
      ports: [port("out", "output", 4)],
    }],
    connections: [],
  };
  assert.deepEqual(serializeProjectFile({ document, inputValues: { source: "10X1" } }), {
    version: PROJECT_FILE_VERSION,
    circuit: {
      components: [{ id: "source", kind: "input", displayName: "输入", position: at(4, 8), ports: [port("out", "output", 4)], data: { value: "10X1" } }],
      connections: [],
    },
    definitions: {},
    libraryRoots: [],
  });
});

test("round-trips embedded definitions, direct roots, cached ports, and connection geometry", () => {
  const cachedPorts = [port("Y", "output"), port("A", "input", 8)];
  const definitions = {
    arithmetic: { displayName: "arith.circuit.json", circuit: passThrough() },
    unused: { displayName: "unused.circuit.json", circuit: emptyCircuit() },
  };
  const document: EditorDocument = {
    components: [{
      id: "u1", kind: "subcircuit", displayName: "arith.circuit.json", position: at(120, 80),
      lifecycle: "active", ports: cachedPorts,
      data: { subcircuit: { definitionId: "arithmetic", reference: "", cachedPorts, portOrder: ["Y", "A"], status: "resolved" } },
    }],
    connections: [{
      id: "w1",
      source: { componentId: "u1", port: "Y", point: at(0, 0) },
      target: { componentId: "u1", port: "A", point: at(0, 0) },
      lifecycle: "visible", danglingEndpoints: [],
      waypoints: [at(140, 20)], color: "cyan",
    } satisfies EditorConnection],
  };
  const file = serializeProjectFile({ document, definitions, libraryRoots: ["arithmetic"] });
  assert.deepEqual(file.circuit.components[0]?.data, { definitionId: "arithmetic", cachedPorts, portOrder: ["Y", "A"] });
  assert.equal(JSON.stringify(file).includes("reference"), false);
  const parsed = successOf(JSON.parse(JSON.stringify(file)));
  assert.deepEqual(parsed.file, file);
  assert.deepEqual(parsed.file.libraryRoots, ["arithmetic"]);
  assert.deepEqual(Object.keys(parsed.file.definitions).sort(), ["arithmetic", "unused"]);
  assert.deepEqual(parsed.document.components[0]?.data?.subcircuit, { definitionId: "arithmetic", reference: "", cachedPorts, portOrder: ["Y", "A"] });
  assert.deepEqual(parsed.document.connections[0]?.waypoints, [at(140, 20)]);
  assert.equal(parsed.document.connections[0]?.color, "cyan");
});

test("rejects every non-v2 version before interpreting the file", () => {
  for (const version of [0, 1, 3]) {
    const errors = failureOf({ version, circuit: emptyCircuit() });
    assert.deepEqual(codesOf(errors), ["version-unsupported"]);
    assert.match(errors[0]?.message ?? "", /不支持/);
  }
  assert.deepEqual(codesOf(failureOf({ circuit: emptyCircuit() })), ["version-missing"]);
  assert.deepEqual(codesOf(failureOf({ version: "2", circuit: emptyCircuit() })), ["version-not-integer"]);
});

test("requires the v2 definition table and direct root list", () => {
  assert.deepEqual(codesOf(failureOf({ version: 2, circuit: emptyCircuit() })), ["definitions-not-object"]);
  assert.deepEqual(codesOf(failureOf({ version: 2, circuit: emptyCircuit(), definitions: {} })), ["library-roots-invalid"]);
  assert.deepEqual(codesOf(failureOf(project(emptyCircuit(), {}, ["missing"]))), ["library-root-missing"]);
  assert.deepEqual(codesOf(failureOf(project(emptyCircuit(), {}, ["same", "same"]))), ["library-roots-invalid"]);
});

test("accepts a missing definition and dangling Port while retaining the component and wire", () => {
  const file = project({
    components: [input("src", "SRC"), sub("missing-use", "deleted", [port("A", "input")])],
    connections: [wire("w", "src", "out", "missing-use", "old-port")],
  });
  const parsed = successOf(file);
  assert.equal(parsed.file.circuit.components[1]?.kind, "subcircuit");
  assert.equal(parsed.file.circuit.connections[0]?.target.port, "old-port");
  assert.equal(parsed.document.connections[0]?.target.port, "old-port");
});

test("rejects definition cycles while accepting repeated uses of one definition", () => {
  const shared = { displayName: "Shared", circuit: passThrough() };
  const valid = project({ components: [sub("a", "shared"), sub("b", "shared")], connections: [] }, { shared }, ["shared"]);
  assert.equal(successOf(valid).file.circuit.components.length, 2);
  const cyclic = project(emptyCircuit(), {
    a: { displayName: "A", circuit: { components: [sub("to-b", "b")], connections: [] } },
    b: { displayName: "B", circuit: { components: [sub("to-a", "a")], connections: [] } },
  }, ["a"]);
  assert.ok(codesOf(failureOf(cyclic)).includes("definition-cycle"));
});

test("treats prototype-like definition IDs as data rather than inherited definitions", () => {
  const missing = project({ components: [sub("u", "toString")], connections: [] });
  assert.equal(successOf(missing).file.circuit.components[0]?.data && "definitionId" in successOf(missing).file.circuit.components[0]!.data!, true);
  const definitions = Object.fromEntries([
    ["__proto__", { displayName: "Proto", circuit: passThrough() }],
    ["toString", { displayName: "String", circuit: passThrough() }],
  ]);
  const parsed = successOf(project(emptyCircuit(), definitions, ["__proto__", "toString"]));
  assert.equal(Object.hasOwn(parsed.file.definitions, "__proto__"), true);
  assert.equal(Object.hasOwn(parsed.file.definitions, "toString"), true);
});

test("rejects malformed components and missing endpoint components atomically", () => {
  const malformed = project({
    components: [
      input("same", "A"),
      input("same", "B"),
      { id: "unknown", kind: "future" as "and", displayName: "?", position: at(0, 0) },
    ],
    connections: [wire("orphan", "same", "out", "absent", "in")],
  });
  const codes = codesOf(failureOf(malformed));
  assert.ok(codes.includes("component-id-duplicate"));
  assert.ok(codes.includes("component-kind-unknown"));
  assert.ok(codes.includes("connection-endpoint-unresolved"));
});

test("an import creates a fresh source-independent definition without changing the parent", () => {
  const source = project(passThrough());
  const parent = project();
  let sequence = 0;
  const allocate = () => "import-" + ++sequence;
  const first = importProjectSnapshot(parent, source, "first.circuit.json", allocate);
  assert.ok(first.ok, first.ok ? "" : first.errors.map((error) => error.message).join("; "));
  assert.deepEqual(first.ports, [port("A", "input"), port("Y", "output")]);
  assert.equal(parent.libraryRoots.length, 0);
  assert.equal(first.file.definitions[first.definitionId]?.displayName, "first.circuit.json");
  const second = importProjectSnapshot(first.file, source, "second.circuit.json", allocate);
  assert.ok(second.ok, second.ok ? "" : second.errors.map((error) => error.message).join("; "));
  assert.notEqual(first.definitionId, second.definitionId);
  assert.deepEqual(second.file.libraryRoots, [first.definitionId, second.definitionId]);
  Object.assign(source.circuit.components[0]!, { displayName: "changed source" });
  assert.equal(second.file.definitions[first.definitionId]?.circuit.components[0]?.displayName, "A");
  assert.equal(second.file.definitions[second.definitionId]?.circuit.components[0]?.displayName, "A");
});

test("import includes only recursively reachable definitions and preserves sharing within one closure", () => {
  const source = project({
    components: [sub("b1", "B"), sub("b2", "B")], connections: [],
  }, {
    B: { displayName: "B", circuit: { components: [sub("c", "C")], connections: [] } },
    C: { displayName: "C", circuit: passThrough() },
    idle: { displayName: "idle", circuit: emptyCircuit() },
  }, ["B", "idle"]);
  const result = importProjectSnapshot(project(), source, "A", (() => { let id = 0; return () => "new-" + ++id; })());
  assert.ok(result.ok, result.ok ? "" : result.errors.map((error) => error.message).join("; "));
  assert.equal(Object.keys(result.file.definitions).length, 3);
  assert.equal(result.file.libraryRoots.length, 1);
  const root = result.file.definitions[result.definitionId]!;
  const bIds = root.circuit.components.map((component) => component.data && "definitionId" in component.data ? component.data.definitionId : null);
  assert.equal(bIds[0], bIds[1]);
  assert.equal(Object.values(result.file.definitions).some((definition) => definition.displayName === "idle"), false);
});

test("failed import leaves the parent untouched", () => {
  const parent = project();
  const source = project(passThrough());
  const duplicate = importProjectSnapshot(parent, source, "A", () => "");
  assert.equal(duplicate.ok, false);
  assert.deepEqual(parent, project());
  const clock = project({ components: [{ id: "clock", kind: "clock", displayName: "Clock", position: at(0, 0) }], connections: [] });
  const rejected = importProjectSnapshot(parent, clock, "Clock", () => "clock-root");
  assert.equal(rejected.ok, false);
  assert.deepEqual(parent, project());
});
