import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentKindName, EngineResponse, PortSpec, Signal } from "@circuit-platform/protocol";
import { useWorkspace } from "../src/composables/useWorkspace.ts";
import type { EngineAdapter } from "../src/workspace/index.ts";
import type { KeyValueStorage } from "../src/project-file/recent-projects.ts";
import type { ProjectFileData } from "../src/project-file/index.ts";
import { portsForAddComponent } from "./fake-ports.ts";

type DialogResult = { ok: true; path: string } | { ok: false; reason: string };

class AcceptanceEngine implements EngineAdapter {
  readonly files = new Map<string, string>();
  readonly calls: string[] = [];
  readonly readPaths: string[] = [];
  readonly openResults: DialogResult[] = [];
  readonly saveResults: DialogResult[] = [];
  failOnAddCall: number | null = null;
  failRemove = false;
  addCallCount = 0;
  pickOpenCalls = 0;
  writeFailure = false;
  private nextComponentId = 1;
  private nextConnectionId = 1;

  async checkEngine() {
    return { status: "ok" as const, engine: "acceptance", processEpoch: 1 };
  }

  async addComponent(kind: ComponentKindName, ports?: readonly PortSpec[]): Promise<EngineResponse> {
    this.addCallCount += 1;
    this.calls.push(`add:${kind}`);
    if (this.failOnAddCall === this.addCallCount) {
      return { type: "error", requestId: "acceptance", code: "FAKE_ERROR", message: "创建元件失败" };
    }
    return { type: "component_added", requestId: "acceptance", componentId: this.nextComponentId++, ports: portsForAddComponent(kind, ports) };
  }

  async setPortWidth(componentId: number, ports: readonly PortSpec[]): Promise<EngineResponse> {
    return { type: "port_width_set", requestId: "acceptance", componentId, ports, danglingConnectionIds: [] };
  }

  async addConnection(source: { componentId: number; port: string }, target: { componentId: number; port: string }): Promise<EngineResponse> {
    this.calls.push(`connect:${source.componentId}->${target.componentId}`);
    return { type: "connection_added", requestId: "acceptance", connectionId: this.nextConnectionId++ };
  }

  async removeComponent(componentId: number): Promise<EngineResponse> {
    this.calls.push(`remove:${componentId}`);
    if (this.failRemove) {
      return { type: "error", requestId: "acceptance", code: "FAKE_ERROR", message: "补偿删除失败" };
    }
    return { type: "component_removed", requestId: "acceptance", componentId };
  }

  async removeConnection(connectionId: number): Promise<EngineResponse> {
    this.calls.push(`disconnect:${connectionId}`);
    return { type: "connection_removed", requestId: "acceptance", connectionId };
  }

  async setInput(_componentId: number, _value: Signal): Promise<EngineResponse> {
    return { type: "input_set", requestId: "acceptance" };
  }

  async settle(): Promise<EngineResponse> {
    this.calls.push("settle");
    return { type: "settled", requestId: "acceptance", status: "ok" };
  }

  async tick(): Promise<EngineResponse> {
    return { type: "ticked", requestId: "acceptance", step: 1, signals: [] };
  }

  async reset(): Promise<EngineResponse> {
    return { type: "reset_done", requestId: "acceptance", status: "ok" };
  }

  async getSignal(_componentId: number, _port: string): Promise<EngineResponse> {
    return { type: "signal_result", requestId: "acceptance", value: "0" };
  }

  async pickOpenPath(): Promise<DialogResult> {
    this.pickOpenCalls += 1;
    return this.openResults.shift() ?? { ok: false, reason: "canceled" };
  }

  async pickSavePath(): Promise<DialogResult> {
    return this.saveResults.shift() ?? { ok: false, reason: "canceled" };
  }

  async writeProjectFile(path: string, content: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (this.writeFailure) return { ok: false, reason: "写入失败。" };
    this.files.set(path, content);
    return { ok: true };
  }

  async readProjectFile(path: string): Promise<{ ok: true; content: string } | { ok: false; reason: string; code?: string }> {
    this.readPaths.push(path);
    const content = this.files.get(path);
    return content === undefined
      ? { ok: false, reason: "项目文件不存在。", code: "PROJECT_FILE_NOT_FOUND" }
      : { ok: true, content };
  }
}

function storage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

function installWindow(engine: AcceptanceEngine): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { circuitPlatform: engine, localStorage: storage() },
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  };
}

const ports = {
  input: [{ name: "out", direction: "output", width: 1 }] as const,
  output: [{ name: "in", direction: "input", width: 1 }] as const,
};

function emptyProject(): ProjectFileData {
  return { version: 2, circuit: { components: [], connections: [] }, definitions: {}, libraryRoots: [] };
}

function childProjectFile(): ProjectFileData {
  return {
    ...emptyProject(),
    circuit: {
      components: [
        { id: "in", kind: "input", displayName: "a", position: { x: 0, y: 0 }, ports: ports.input },
        { id: "gate", kind: "not", displayName: "NOT", position: { x: 50, y: 0 } },
        { id: "gate2", kind: "not", displayName: "NOT 2", position: { x: 75, y: 0 } },
        { id: "out", kind: "output", displayName: "y", position: { x: 100, y: 0 }, ports: ports.output },
      ],
      connections: [
        { id: "in", source: { component: "in", port: "out" }, target: { component: "gate", port: "in" } },
        { id: "mid", source: { component: "gate", port: "out" }, target: { component: "gate2", port: "in" } },
        { id: "out", source: { component: "gate2", port: "out" }, target: { component: "out", port: "in" } },
      ],
    },
  };
}

function embeddedParent(): ProjectFileData {
  return {
    version: 2,
    circuit: {
      components: [{ id: "unit", kind: "subcircuit", displayName: "child.circuit.json", position: { x: 100, y: 100 }, data: {
        definitionId: "child",
        cachedPorts: [{ name: "a", direction: "input", width: 1 }, { name: "y", direction: "output", width: 1 }],
      } }],
      connections: [],
    },
    definitions: { child: { displayName: "child.circuit.json", circuit: childProjectFile().circuit } },
    libraryRoots: ["child"],
  };
}

function missingDefinitionParent(): ProjectFileData {
  return {
    version: 2,
    circuit: {
      components: [
        { id: "source", kind: "input", displayName: "Source", position: { x: 0, y: 0 }, ports: ports.input },
        { id: "gate", kind: "not", displayName: "NOT", position: { x: 40, y: 0 } },
        { id: "sink", kind: "output", displayName: "Sink", position: { x: 80, y: 0 }, ports: ports.output },
        { id: "missing", kind: "subcircuit", displayName: "missing.circuit.json", position: { x: 40, y: 100 }, data: {
          definitionId: "missing-definition",
          cachedPorts: [{ name: "a", direction: "input", width: 1 }, { name: "y", direction: "output", width: 1 }],
        } },
      ],
      connections: [
        { id: "in", source: { component: "source", port: "out" }, target: { component: "gate", port: "in" } },
        { id: "out", source: { component: "gate", port: "out" }, target: { component: "sink", port: "in" } },
      ],
    },
    definitions: {},
    libraryRoots: [],
  };
}

test("canceling import in an unsaved parent leaves document, history, dirty state and engine unchanged", async () => {
  const engine = new AcceptanceEngine();
  const restore = installWindow(engine);
  try {
    const binding = useWorkspace();
    await binding.bootstrap();
    await binding.requestLoadExample();
    const beforeDocument = binding.editorState.value?.document;
    const beforeDirty = binding.isDirty.value;
    const beforeCalls = [...engine.calls];
    const beforeRecent = [...binding.recentProjects.value];

    assert.equal(await binding.addSubcircuitFromDialog({ x: 20, y: 20 }), false);
    assert.deepEqual(binding.editorState.value?.document, beforeDocument);
    assert.equal(binding.editorState.value?.canUndo, false);
    assert.equal(binding.isDirty.value, beforeDirty);
    assert.equal(binding.projectPath.value, null);
    assert.deepEqual(binding.recentProjects.value, beforeRecent);
    assert.deepEqual(engine.calls, beforeCalls);
    assert.equal(engine.pickOpenCalls, 1);
    assert.equal(engine.files.size, 0);
  } finally {
    restore();
  }
});

test("missing and old-version sources reject import without a partial definition or undo frame", async () => {
  const engine = new AcceptanceEngine();
  const restore = installWindow(engine);
  try {
    const binding = useWorkspace();
    await binding.bootstrap();
    await binding.requestNew();
    const absentPath = "E:\\circuits\\absent.circuit.json";
    const oldPath = "E:\\circuits\\old.circuit.json";
    engine.files.set(oldPath, JSON.stringify({ version: 1, circuit: { components: [], connections: [] } }));
    const beforeCalls = [...engine.calls];

    engine.openResults.push({ ok: true, path: absentPath });
    assert.equal(await binding.addSubcircuitFromDialog(), false);
    assert.match(binding.openError.value ?? "", /不存在/);
    engine.openResults.push({ ok: true, path: oldPath });
    assert.equal(await binding.addSubcircuitFromDialog(), false);
    assert.match(binding.openError.value ?? "", /版本|支持/);
    assert.equal(binding.editorState.value?.document.components.length, 0);
    assert.equal(binding.editorState.value?.canUndo, false);
    assert.equal(binding.isDirty.value, false);
    assert.deepEqual(engine.calls, beforeCalls);
  } finally {
    restore();
  }
});

test("import into an unsaved parent is one undoable edit and saving never rereads the source", async () => {
  const engine = new AcceptanceEngine();
  const restore = installWindow(engine);
  try {
    const sourcePath = "E:\\circuits\\source.circuit.json";
    const parentPath = "E:\\circuits\\parent.circuit.json";
    engine.files.set(sourcePath, JSON.stringify(childProjectFile()));
    engine.openResults.push({ ok: true, path: sourcePath });
    const binding = useWorkspace();
    await binding.bootstrap();
    await binding.requestNew();
    assert.equal(await binding.addSubcircuitFromDialog({ x: 120, y: 100 }), true, binding.openError.value ?? "");
    const placed = binding.editorState.value?.document.components[0];
    assert.equal(placed?.kind, "subcircuit");
    assert.equal(placed?.data?.subcircuit?.status, "resolved");
    assert.equal(binding.editorState.value?.canUndo, true);
    assert.equal(binding.projectPath.value, null);
    await binding.undo();
    assert.equal(binding.editorState.value?.document.components.length, 0);
    await binding.redo();
    assert.equal(binding.editorState.value?.document.components.length, 1);

    engine.files.set(sourcePath, JSON.stringify(emptyProject()));
    const readsBeforeSave = [...engine.readPaths];
    engine.saveResults.push({ ok: true, path: parentPath });
    assert.equal(await binding.saveAs(), true, binding.saveError.value ?? "");
    assert.deepEqual(engine.readPaths, readsBeforeSave);
    const saved = JSON.parse(engine.files.get(parentPath)!) as ProjectFileData;
    assert.equal(saved.version, 2);
    assert.equal(Object.keys(saved.definitions).length, 1);
    assert.equal(saved.libraryRoots.length, 1);
    assert.equal(saved.definitions[saved.libraryRoots[0]!]!.circuit.components.some((component) => component.kind === "not"), true);
    assert.equal(JSON.stringify(saved).includes(sourcePath), false);
    assert.equal(JSON.stringify(saved).includes("reference"), false);

    engine.files.delete(sourcePath);
    const reopened = useWorkspace();
    await reopened.bootstrap();
    assert.equal(await reopened.openProjectFromPath(parentPath), true, reopened.openError.value ?? "");
    assert.equal(reopened.editorState.value?.document.components[0]?.data?.subcircuit?.status, "resolved");
    assert.deepEqual(engine.readPaths.slice(readsBeforeSave.length), [parentPath]);
  } finally {
    restore();
  }
});

test("a missing embedded definition stays visible while an independent branch still reaches the engine", async () => {
  const engine = new AcceptanceEngine();
  const restore = installWindow(engine);
  try {
    const parentPath = "E:\\circuits\\partial.circuit.json";
    engine.files.set(parentPath, JSON.stringify(missingDefinitionParent()));
    const binding = useWorkspace();
    await binding.bootstrap();
    assert.equal(await binding.openProjectFromPath(parentPath), true, binding.openError.value ?? "");
    const document = binding.editorState.value?.document;
    assert.equal(document?.components.find((component) => component.id === "missing")?.data?.subcircuit?.status, "unresolved");
    assert.deepEqual(document?.components.map((component) => component.id), ["source", "gate", "sink", "missing"]);
    assert.deepEqual(engine.calls.filter((call) => call.startsWith("add:")), ["add:input", "add:not", "add:output"]);
    assert.equal(binding.state.value.hasCircuit, true);
  } finally {
    restore();
  }
});

test("duplicating an embedded Subcircuit uses the saved definition and failed projection rolls back", async () => {
  const engine = new AcceptanceEngine();
  const restore = installWindow(engine);
  try {
    const parentPath = "E:\\circuits\\parent.circuit.json";
    engine.files.set(parentPath, JSON.stringify(embeddedParent()));
    const binding = useWorkspace();
    await binding.bootstrap();
    assert.equal(await binding.openProjectFromPath(parentPath), true, binding.openError.value ?? "");
    const original = binding.editorState.value?.document.components[0];
    const beforeCalls = engine.calls.length;

    engine.failOnAddCall = engine.addCallCount + 2;
    assert.equal(await binding.duplicateComponent("unit"), false);
    assert.deepEqual(binding.editorState.value?.document.components, [original]);
    assert.equal(binding.editorState.value?.canUndo, false);
    assert.equal(engine.calls.slice(beforeCalls).some((call) => call.startsWith("remove:")), true);

    engine.failOnAddCall = null;
    assert.equal(await binding.duplicateComponent("unit"), true);
    const units = binding.editorState.value?.document.components ?? [];
    assert.equal(units.length, 2);
    assert.equal(units[1]?.data?.subcircuit?.definitionId, units[0]?.data?.subcircuit?.definitionId);
    assert.equal(units[1]?.data?.subcircuit?.status, "resolved");
    await binding.undo();
    assert.equal(binding.editorState.value?.document.components.length, 1);
  } finally {
    restore();
  }
});

test("a compensation failure reports recovery-required without publishing a duplicate", async () => {
  const engine = new AcceptanceEngine();
  const restore = installWindow(engine);
  try {
    const parentPath = "E:\\circuits\\parent.circuit.json";
    engine.files.set(parentPath, JSON.stringify(embeddedParent()));
    const binding = useWorkspace();
    await binding.bootstrap();
    assert.equal(await binding.openProjectFromPath(parentPath), true);
    engine.failOnAddCall = engine.addCallCount + 2;
    engine.failRemove = true;

    assert.equal(await binding.duplicateComponent("unit"), false);
    assert.equal(binding.editorState.value?.operation, "recovery-required");
    assert.equal(binding.editorState.value?.document.components.filter((component) => component.kind === "subcircuit").length, 1);
  } finally {
    restore();
  }
});
