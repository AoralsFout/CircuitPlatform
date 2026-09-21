import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { ComponentKindName } from "@circuit-platform/protocol";
import { createCanvasSceneProjector, createComponentDefinitionRegistry, isDenseCanvasScene } from "../src/canvas/index.ts";
import { createAndDemoDocument, type EditorDocument, type EditorSnapshot } from "../src/editor/index.ts";
import { flattenProjectHierarchy } from "../src/project-file/hierarchy.ts";
import { createHierarchyPerformanceFixture } from "../src/project-file/performance-fixture.ts";
import { portsForAddComponent } from "./fake-ports.ts";

/** 给示例文档补上引擎回传的端口清单：没有清单就画不出端口，性能断言也就无从谈起。 */
function documentWithPorts(): EditorDocument {
  const document = createAndDemoDocument();
  return {
    ...document,
    components: document.components.map((component) => ({
      ...component,
      ports: portsForAddComponent(component.kind as ComponentKindName),
    })),
  };
}

function snapshot(): EditorSnapshot {
  return {
    document: documentWithPorts(),
    selection: null,
    operation: "idle",
    canUndo: false,
    canRedo: false,
    confirmation: null,
    error: null,
  };
}

test("signal updates reuse cached Route geometry", () => {
  const projector = createCanvasSceneProjector(createComponentDefinitionRegistry());
  const editorSnapshot = snapshot();
  const first = projector.project(editorSnapshot, { signals: { "input-a:out": "0" } });
  const second = projector.project(editorSnapshot, { signals: { "input-a:out": "1" } });

  // The benchmark's hot path must not generate fresh point arrays when only signal state changes.
  assert.strictEqual(second.wires[0]?.route, first.wires[0]?.route);
  assert.notEqual(second.wires[0]?.signal, first.wires[0]?.signal);
  assert.equal(second.nodes[0]?.ports[0]?.signal, "1");
});

test("signal updates reuse Route geometry during a stable route preview", () => {
  const projector = createCanvasSceneProjector(createComponentDefinitionRegistry());
  const editorSnapshot = snapshot();
  const previewRoute = [{ x: 200, y: 80 }, { x: 240, y: 80 }, { x: 240, y: 160 }];
  const previewRoutes = { "wire-a": previewRoute };
  const first = projector.project(editorSnapshot, { signals: { "input-a:out": "0" } }, undefined, previewRoutes);
  const second = projector.project(editorSnapshot, { signals: { "input-a:out": "1" } }, undefined, previewRoutes);

  assert.strictEqual(second.wires[0]?.route, first.wires[0]?.route);
});

test("dense-scene fallback is only a visual-density signal", () => {
  const scene = {
    nodes: Array.from({ length: 501 }, (_, index) => ({ id: String(index) })),
    wires: [],
    bounds: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } },
  } as never;
  assert.equal(isDenseCanvasScene(scene), true);
});

test("performance benchmark asserts the production hierarchy fixture before rendering", async () => {
  const desktopRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const benchmark = await readFile(join(desktopRoot, "benchmark.html"), "utf8");
  const runner = await readFile(join(desktopRoot, "scripts", "performance-benchmark.mjs"), "utf8");
  assert.match(benchmark, /flattenProjectHierarchy/);
  assert.match(benchmark, /createHierarchyPerformanceFixture/);
  assert.match(benchmark, /hierarchyFixture/);
  assert.match(benchmark, /flattenedComponents/);
  assert.match(benchmark, /flattenedWires/);
  assert.match(benchmark, /visibleComponents/);
  assert.match(benchmark, /visibleWires/);
  assert.match(runner, /hierarchyFixture/);
  assert.match(runner, /flattenedObjects/);
});

test("multidocument benchmark uses production runtimes and adapter-observed work", async () => {
  const desktopRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const benchmark = await readFile(join(desktopRoot, "benchmark.html"), "utf8");
  const runner = await readFile(join(desktopRoot, "scripts", "performance-benchmark-runner.cjs"), "utf8");
  assert.match(benchmark, /useDocumentWorkspace\(\{ schedulerFactory/);
  assert.match(benchmark, /forDocument: \(documentKey\) => adapterFor\(documentKey\)/);
  assert.match(benchmark, /rootPaths = Array\.from\(\{ length: documentCount/);
  assert.match(benchmark, /metrics\.getSignalCalls/);
  assert.match(benchmark, /setInternalSignalTableVisible\(/);
  assert.match(benchmark, /await workspace\.start\(\)/);
  assert.match(benchmark, /schedulerRuns \+= 1/);
  assert.match(benchmark, /filter\(\(\[key\]\) => key !== activeKey\(\)\)/);
  assert.match(benchmark, /adapter\.metrics\.work \+ adapter\.metrics\.schedulerRuns/);
  assert.match(benchmark, /runtimeAdapterCount/);
  assert.match(benchmark, /runtimeAdapterKeys/);
  assert.doesNotMatch(benchmark, /const snapshot = ref\(/);
  assert.doesNotMatch(benchmark, /internalSignalReads\s*\+=/);
  assert.match(runner, /await window\.__driveInternalSignalFrame\(\)/);
});

test("hierarchy performance fixture reaches the production flattener at 500/1000 scale", async () => {
  const fixture = createHierarchyPerformanceFixture();
  const flattened = await flattenProjectHierarchy({
    rootIdentity: fixture.rootIdentity,
    root: fixture.root,
    platform: "posix",
    reader: {
      read: async (identity) => {
        const value = fixture.files.get(identity);
        return value === undefined
          ? { ok: false, code: "project-read-failed", message: `性能夹具缺少 Project：${identity}` }
          : { ok: true, value };
      },
    },
  });
  assert.deepEqual(flattened.diagnostics, []);
  assert.equal(flattened.circuit.components.length, 500);
  assert.equal(flattened.circuit.connections.length, 1000);
  assert.ok(flattened.circuit.components.some((component) => component.id === "wrapper/core/n0"));
  assert.ok(flattened.circuit.connections.some((connection) => connection.id === "source-to-wrapper"));
});
