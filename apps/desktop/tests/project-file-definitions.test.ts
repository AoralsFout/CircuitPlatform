import assert from "node:assert/strict";
import test from "node:test";
import { affectedOccurrencePaths, exportDefinitionProject, importProjectSnapshot, planDeleteDefinition, reimportProjectSnapshot } from "../src/project-file/definitions.ts";
import { parseProjectFile, type ProjectFileCircuit, type ProjectFileData } from "../src/project-file/index.ts";

const input = (id: string, name: string) => ({ id, kind: "input" as const, displayName: name, position: { x: 0, y: 0 }, ports: [{ name: "out", direction: "output" as const, width: 1 }] });
const sub = (id: string, definitionId: string) => ({ id, kind: "subcircuit" as const, displayName: id, position: { x: 100, y: 0 }, data: { definitionId, cachedPorts: [{ name: "x", direction: "input" as const, width: 1 }] } });
const circuit = (...components: ProjectFileCircuit["components"]): ProjectFileCircuit => ({ components: components.flat(), connections: [] });
const file = (body: ProjectFileCircuit, definitions: ProjectFileData["definitions"] = {}, libraryRoots: string[] = []): ProjectFileData => ({ version: 2, circuit: body, definitions, libraryRoots });
const allocate = (used: ReadonlySet<string>): string => {
  let index = 1;
  while (used.has(`new-${index}`)) index += 1;
  return `new-${index}`;
};

test("recursive import copies only reachable definitions and preserves shared edges within one closure", () => {
  const source = file(circuit(sub("b1", "B"), sub("b2", "B")), {
    B: { displayName: "B", circuit: circuit(sub("c", "C")) },
    C: { displayName: "C", circuit: circuit(input("x", "x")) },
    unused: { displayName: "unused", circuit: circuit(input("u", "u")) },
  }, ["B", "unused"]);
  const parent = file(circuit(), { oldB: { displayName: "old B", circuit: circuit(input("old", "old")) } }, ["oldB"]);
  const first = importProjectSnapshot(parent, source, "A", allocate);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.file.definitions.oldB?.displayName, "old B");
  assert.deepEqual(first.file.definitions.oldB?.circuit.components.map((item) => item.id), ["old"]);
  assert.equal(Object.keys(first.file.definitions).length, 4);
  const root = first.file.definitions[first.definitionId]!;
  const edges = root.circuit.components.map((item) => item.data && "definitionId" in item.data ? item.data.definitionId : null);
  assert.equal(edges[0], edges[1]);
  assert.notEqual(edges[0], "B");
  assert.notEqual(edges[0], "oldB");
  const nested = first.file.definitions[edges[0]!]!;
  const leafId = nested.circuit.components[0]!.data;
  assert.ok(leafId && "definitionId" in leafId && first.file.definitions[leafId.definitionId]);
  assert.equal(Object.values(first.file.definitions).some((item) => item.displayName === "unused"), false);

  const second = importProjectSnapshot(first.file, source, "A again", allocate);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(Object.keys(second.file.definitions).length, 7);
  assert.notEqual(second.definitionId, first.definitionId);
  assert.deepEqual(second.file.definitions[first.definitionId], first.file.definitions[first.definitionId]);
  assert.deepEqual(second.file.definitions.oldB, parent.definitions.oldB);
});

test("missing source definition is retained as a missing reference while a cycle is rejected atomically", () => {
  const source = file(circuit(sub("broken", "missing"), input("healthy", "x")));
  const parent = file(circuit(input("parent", "p"), sub("existing-missing", "new-1")));
  const imported = importProjectSnapshot(parent, source, "partial", allocate);
  assert.equal(imported.ok, true);
  if (!imported.ok) return;
  assert.notEqual(imported.definitionId, "new-1");
  const missingUse = imported.file.definitions[imported.definitionId]!.circuit.components[0]!;
  assert.ok(missingUse.data && "definitionId" in missingUse.data);
  assert.equal(Object.hasOwn(imported.file.definitions, missingUse.data.definitionId), false);
  const second = importProjectSnapshot(imported.file, source, "partial again", allocate);
  assert.equal(second.ok, true);
  if (second.ok) {
    assert.notEqual(second.definitionId, imported.definitionId);
    const secondMissing = second.file.definitions[second.definitionId]!.circuit.components[0]!.data;
    assert.ok(secondMissing && "definitionId" in secondMissing);
    assert.notEqual(secondMissing.definitionId, missingUse.data.definitionId);
    assert.equal(Object.hasOwn(second.file.definitions, "new-1"), false);
  }
  assert.equal(Object.keys(parent.definitions).length, 0);

  const cyclic = file(circuit(sub("a", "A")), {
    A: { displayName: "A", circuit: circuit(sub("b", "B")) },
    B: { displayName: "B", circuit: circuit(sub("a", "A")) },
  });
  const parsed = parseProjectFile(cyclic);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.ok(parsed.errors.some((item) => item.code === "definition-cycle"));
  assert.equal(Object.keys(parent.definitions).length, 0);
});

test("reimport preserves the selected identity and name, replaces descendants, and isolates another closure", () => {
  const parent = file(circuit(sub("u1", "selected"), sub("u2", "selected"), sub("other-use", "other")), {
    selected: { displayName: "Local name", circuit: circuit(input("boundary", "x"), sub("inner", "old-child")) },
    "old-child": { displayName: "Old child", circuit: circuit(input("old", "old")) },
    other: { displayName: "Other root", circuit: circuit(input("other", "other")) },
  }, ["selected", "other"]);
  const source = file(circuit(input("new-boundary", "x"), sub("inner", "source-child")), {
    "source-child": { displayName: "New child", circuit: circuit(input("new", "new")) },
    unused: { displayName: "Unused", circuit: circuit(input("idle", "idle")) },
  });
  const result = reimportProjectSnapshot(parent, source, "selected", allocate);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.definitionId, "selected");
  assert.equal(result.file.definitions.selected?.displayName, "Local name");
  assert.deepEqual(result.file.libraryRoots, ["selected", "other"]);
  assert.deepEqual(result.file.circuit.components.map((item) => item.data && "definitionId" in item.data ? item.data.definitionId : null), ["selected", "selected", "other"]);
  assert.equal(result.file.definitions["old-child"], undefined);
  assert.deepEqual(result.file.definitions.other, parent.definitions.other);
  const newChild = result.file.definitions.selected!.circuit.components[1]!.data;
  assert.ok(newChild && "definitionId" in newChild);
  assert.notEqual(newChild.definitionId, "source-child");
  assert.ok(result.file.definitions[newChild.definitionId]);
  assert.equal(Object.values(result.file.definitions).some((item) => item.displayName === "Unused"), false);
  assert.ok(parent.definitions["old-child"]);
  assert.deepEqual(affectedOccurrencePaths(parent, "selected"), ["u1", "u2"]);
  assert.deepEqual(affectedOccurrencePaths(parent, "old-child"), ["u1/inner", "u2/inner"]);
});

test("reimport rejects incompatible ports without changing the parent", () => {
  const parent = file(circuit(sub("u", "selected")), {
    selected: { displayName: "Selected", circuit: circuit(input("old", "x")) },
  }, ["selected"]);
  const source = file(circuit(input("new", "renamed")));
  const original = JSON.stringify(parent);
  const result = reimportProjectSnapshot(parent, source, "selected", allocate);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errors[0]?.code, "interface-incompatible");
  assert.equal(JSON.stringify(parent), original);
});

test("reimporting a nested definition leaves its readonly ancestor identity intact", () => {
  const parent = file(circuit(sub("use-a", "A")), {
    A: { displayName: "A", circuit: circuit(sub("inner", "B")) },
    B: { displayName: "B local", circuit: circuit(input("old-boundary", "x"), sub("leaf", "old-leaf")) },
    "old-leaf": { displayName: "Old leaf", circuit: circuit(input("old", "old")) },
  }, ["A"]);
  const source = file(circuit(input("new-boundary", "x"), sub("leaf", "source-leaf")), {
    "source-leaf": { displayName: "New leaf", circuit: circuit(input("new", "new")) },
  });
  const result = reimportProjectSnapshot(parent, source, "B", allocate);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const ancestorUse = result.file.definitions.A?.circuit.components[0]?.data;
  assert.ok(ancestorUse && "definitionId" in ancestorUse);
  assert.equal(ancestorUse.definitionId, "B");
  assert.equal(result.file.definitions.B?.displayName, "B local");
  assert.equal(result.file.definitions["old-leaf"], undefined);
  const descendant = result.file.definitions.B!.circuit.components[1]?.data;
  assert.ok(descendant && "definitionId" in descendant && result.file.definitions[descendant.definitionId]);
  assert.deepEqual(affectedOccurrencePaths(parent, "B"), ["use-a/inner"]);
});

test("reimport handles prototype-like definition identities as ordinary data", () => {
  const parent = file(circuit(sub("use", "__proto__")), Object.fromEntries([
    ["__proto__", { displayName: "Local", circuit: circuit(input("old", "x")) }],
  ]), ["__proto__"]);
  const result = reimportProjectSnapshot(parent, file(circuit(input("new", "x"))), "__proto__", allocate);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(Object.hasOwn(result.file.definitions, "__proto__"), true);
    assert.equal(result.file.definitions["__proto__"]?.displayName, "Local");
    assert.deepEqual(result.file.definitions["__proto__"]?.circuit.components.map((item) => item.id), ["new"]);
  }
});

test("exporting a nested definition promotes its circuit and copies only reachable dependencies", () => {
  const source = file(circuit(sub("top", "A")), {
    A: { displayName: "A", circuit: circuit(sub("nested", "B"), sub("shared", "B")) },
    B: { displayName: "B", circuit: circuit(sub("leaf", "C")) },
    C: { displayName: "C", circuit: circuit(input("x", "x")) },
    idle: { displayName: "idle", circuit: circuit(input("unused", "unused")) },
  }, ["A", "idle"]);
  const before = structuredClone(source);
  const exported = exportDefinitionProject(source, "B");
  assert.equal(exported.ok, true);
  if (!exported.ok) return;
  assert.deepEqual(exported.file.circuit, source.definitions.B?.circuit);
  assert.deepEqual(Object.keys(exported.file.definitions), ["C"]);
  assert.deepEqual(exported.file.libraryRoots, []);
  assert.equal(parseProjectFile(exported.file).ok, true);
  assert.deepEqual(source, before);
  const missing = exportDefinitionProject(source, "deleted");
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.errors[0]?.code, "definition-missing");
});

test("definition deletion lists top-level and nested uses and only prunes private descendants", () => {
  const parent = file(circuit(sub("top-use", "A"), sub("kept-child", "C")), {
    A: { displayName: "A", circuit: circuit(sub("nested-use", "B"), sub("shared", "C")) },
    B: { displayName: "B", circuit: circuit(input("b-input", "b")) },
    C: { displayName: "C", circuit: circuit(input("c-input", "c")) },
    independent: { displayName: "Independent", circuit: circuit(sub("nested-a", "A")) },
  }, ["A", "independent"]);
  const plan = planDeleteDefinition(parent, "A");
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.uses.map((use) => [use.ownerDefinitionId, use.componentId]), [[null, "top-use"], ["independent", "nested-a"]]);
  assert.deepEqual(plan.removedDefinitionIds, ["A", "B"]);
  assert.equal(Object.hasOwn(plan.file.definitions, "A"), false);
  assert.equal(Object.hasOwn(plan.file.definitions, "B"), false);
  assert.equal(Object.hasOwn(plan.file.definitions, "C"), true);
  const retainedUse = plan.file.circuit.components[0]?.data;
  assert.ok(retainedUse && "definitionId" in retainedUse);
  assert.equal(retainedUse.definitionId, "A");
  assert.deepEqual(plan.file.libraryRoots, ["independent"]);
  assert.equal(parseProjectFile(plan.file).ok, true);
  assert.deepEqual(parent.libraryRoots, ["A", "independent"]);
});

test("unused direct import deletes immediately and missing identity has a stable diagnostic", () => {
  const parent = file(circuit(), { A: { displayName: "A", circuit: circuit(input("a", "a")) } }, ["A"]);
  const plan = planDeleteDefinition(parent, "A");
  assert.equal(plan.ok, true);
  if (plan.ok) {
    assert.deepEqual(plan.uses, []);
    assert.deepEqual(plan.file.definitions, {});
    assert.deepEqual(plan.file.libraryRoots, []);
  }
  const missing = planDeleteDefinition(parent, "absent");
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.errors[0]?.code, "definition-missing");
});
