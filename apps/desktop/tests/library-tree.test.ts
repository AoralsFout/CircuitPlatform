import assert from "node:assert/strict";
import test from "node:test";
import { buildLibraryTree, canvasSubcircuitName } from "../src/project-file/library.ts";
import type { ProjectFileData } from "../src/project-file/index.ts";

test("library tree keeps unused direct roots and shows nested dependencies with usage counts", () => {
  const file: ProjectFileData = {
    version: 2,
    circuit: { components: [], connections: [] },
    definitions: {
      a: { displayName: "Very long ALU source name.circuit.json", circuit: { components: [{
        id: "nested", kind: "subcircuit", displayName: "Register.circuit.json", position: { x: 0, y: 0 },
        data: { definitionId: "b", cachedPorts: [] },
      }], connections: [] } },
      b: { displayName: "Register.circuit.json", circuit: { components: [], connections: [] } },
    },
    libraryRoots: ["a"],
  };
  const [root] = buildLibraryTree(file);
  assert.equal(root?.displayName, "Very long ALU source name.circuit.json");
  assert.equal(root?.usageCount, 0);
  assert.equal(root?.status, "ready");
  assert.deepEqual(root?.children.map((node) => [node.definitionId, node.displayName, node.usageCount, node.status]), [
    ["b", "Register.circuit.json", 1, "ready"],
  ]);
});

test("missing dependencies are visible and suffix removal is exclusive to canvas text", () => {
  const file: ProjectFileData = {
    version: 2,
    circuit: { components: [], connections: [] },
    definitions: {
      a: { displayName: "ALU.circuit.json", circuit: { components: [{
        id: "missing", kind: "subcircuit", displayName: "Old", position: { x: 0, y: 0 },
        data: { definitionId: "gone", cachedPorts: [] },
      }], connections: [] } },
    },
    libraryRoots: ["a"],
  };
  assert.equal(buildLibraryTree(file)[0]?.children[0]?.diagnostic, "定义已删除");
  assert.equal(canvasSubcircuitName("ALU.circuit.json (2)"), "ALU (2)");
  assert.equal(canvasSubcircuitName("ALU.circuit.json.backup"), "ALU.circuit.json.backup");
});
