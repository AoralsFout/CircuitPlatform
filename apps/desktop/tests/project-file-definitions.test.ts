import assert from "node:assert/strict";
import test from "node:test";
import { importProjectSnapshot } from "../src/project-file/definitions.ts";
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
