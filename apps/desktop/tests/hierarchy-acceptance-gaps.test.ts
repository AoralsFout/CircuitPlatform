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
  return { version: 1, circuit: { components: [], connections: [] } };
}

function unresolvedParent(): ProjectFileData {
  return {
    version: 1,
    circuit: {
      components: [
        { id: "unit", kind: "subcircuit", displayName: "missing.circuit.json", position: { x: 100, y: 100 }, data: {
          reference: ".\\missing.circuit.json",
          cachedPorts: [{ name: "a", direction: "input", width: 1 }, { name: "y", direction: "output", width: 1 }],
        } },
      ],
      connections: [],
    },
  };
}

function resolvedParent(): ProjectFileData {
  return {
    version: 1,
    circuit: {
      components: [{ id: "unit", kind: "subcircuit", displayName: "child.circuit.json", position: { x: 100, y: 100 }, data: {
        reference: ".\\child.circuit.json",
        cachedPorts: [{ name: "a", direction: "input", width: 1 }, { name: "y", direction: "output", width: 1 }],
      } }],
      connections: [],
    },
  };
}

function resolvedChild(): ProjectFileData {
  return {
    version: 1,
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

test("canceling Subcircuit selection keeps the document, history, dirty flag and recent projects unchanged", async () => {
  const engine = new AcceptanceEngine();
  const restore = installWindow(engine);
  try {
    const parentPath = "E:\\circuits\\parent.circuit.json";
    engine.files.set(parentPath, JSON.stringify(emptyProject()));
    const binding = useWorkspace();
    await binding.bootstrap();
    assert.equal(await binding.openProjectFromPath(parentPath), true);
    const beforeDocument = JSON.stringify(binding.editorState.value?.document);
    const beforeRecent = JSON.stringify(binding.recentProjects.value);
    const beforeCalls = [...engine.calls];

    assert.equal(await binding.addSubcircuitFromDialog({ x: 20, y: 20 }), false);
    assert.equal(JSON.stringify(binding.editorState.value?.document), beforeDocument);
    assert.equal(binding.editorState.value?.canUndo, false);
    assert.equal(binding.isDirty.value, false);
    assert.equal(JSON.stringify(binding.recentProjects.value), beforeRecent);
    assert.deepEqual(engine.calls, beforeCalls);
  } finally {
    restore();
  }
});

test("adding the parent Project itself is rejected as a stable reference-cycle diagnostic", async () => {
  const engine = new AcceptanceEngine();
  const restore = installWindow(engine);
  try {
    const parentPath = "E:\\circuits\\parent.circuit.json";
    engine.files.set(parentPath, JSON.stringify(emptyProject()));
    engine.openResults.push({ ok: true, path: parentPath });
    const binding = useWorkspace();
    await binding.bootstrap();
    assert.equal(await binding.openProjectFromPath(parentPath), true);
    const beforeCalls = [...engine.calls];

    assert.equal(await binding.addSubcircuitFromDialog({ x: 20, y: 20 }), false);
    assert.match(binding.openError.value ?? "", /直接自引用/);
    assert.equal(binding.editorState.value?.document.components.length, 0);
    assert.equal(binding.editorState.value?.canUndo, false);
    assert.equal(binding.isDirty.value, false);
    assert.deepEqual(engine.calls, beforeCalls);
  } finally {
    restore();
  }
});

test("an unsaved parent stops at a canceled save before opening the Subcircuit chooser", async () => {
  const engine = new AcceptanceEngine();
  const restore = installWindow(engine);
  try {
    const binding = useWorkspace();
    await binding.bootstrap();
    await binding.requestLoadExample();
    const beforeDocument = JSON.stringify(binding.editorState.value?.document);
    const beforeRecent = JSON.stringify(binding.recentProjects.value);
    assert.equal(binding.isDirty.value, true);

    assert.equal(await binding.addSubcircuitFromDialog({ x: 20, y: 20 }), false);
    assert.equal(JSON.stringify(binding.editorState.value?.document), beforeDocument);
    assert.equal(binding.projectPath.value, null);
    assert.equal(binding.isDirty.value, true);
    assert.equal(binding.editorState.value?.canUndo, false);
    assert.equal(JSON.stringify(binding.recentProjects.value), beforeRecent);
    assert.equal(engine.pickOpenCalls, 0, "保存取消后不能继续打开子文件选择器");
  } finally {
    restore();
  }
});

test("an unsaved parent stops at a failed save before opening the Subcircuit chooser", async () => {
  const engine = new AcceptanceEngine();
  const restore = installWindow(engine);
  try {
    const binding = useWorkspace();
    await binding.bootstrap();
    await binding.requestLoadExample();
    const beforeDocument = JSON.stringify(binding.editorState.value?.document);
    const beforeRecent = JSON.stringify(binding.recentProjects.value);
    engine.writeFailure = true;

    assert.equal(await binding.addSubcircuitFromDialog({ x: 20, y: 20 }), false);
    assert.equal(JSON.stringify(binding.editorState.value?.document), beforeDocument);
    assert.equal(binding.projectPath.value, null);
    assert.equal(binding.isDirty.value, true);
    assert.equal(binding.editorState.value?.canUndo, false);
    assert.equal(JSON.stringify(binding.recentProjects.value), beforeRecent);
    assert.equal(engine.pickOpenCalls, 0, "保存失败后不能继续打开子文件选择器");
  } finally {
    restore();
  }
});

test("saving a hierarchy writes the adopted root without rereading its child and reopens with the same interface", async () => {
  const engine = new AcceptanceEngine();
  const restore = installWindow(engine);
  try {
    const parentPath = "E:\\circuits\\parent.circuit.json";
    const childPath = "E:\\circuits\\child.circuit.json";
    const parent = {
      version: 1,
      circuit: {
        components: [{ id: "unit", kind: "subcircuit" as const, displayName: "child.circuit.json", position: { x: 10, y: 10 }, data: {
          reference: ".\\child.circuit.json",
          cachedPorts: [{ name: "a", direction: "input" as const, width: 1 }, { name: "y", direction: "output" as const, width: 1 }],
        } }],
        connections: [],
      },
    } satisfies ProjectFileData;
    engine.files.set(parentPath, JSON.stringify(parent));
    engine.files.set(childPath.toLowerCase(), JSON.stringify({ version: 1, circuit: {
      components: [
        { id: "in", kind: "input" as const, displayName: "a", position: { x: 0, y: 0 }, ports: ports.input },
        { id: "gate", kind: "not" as const, displayName: "NOT", position: { x: 50, y: 0 } },
        { id: "out", kind: "output" as const, displayName: "y", position: { x: 100, y: 0 }, ports: ports.output },
      ],
      connections: [
        { id: "in", source: { component: "in", port: "out" }, target: { component: "gate", port: "in" } },
        { id: "out", source: { component: "gate", port: "out" }, target: { component: "out", port: "in" } },
      ],
    }}));
    const binding = useWorkspace();
    await binding.bootstrap();
    assert.equal(await binding.openProjectFromPath(parentPath), true);
    const readsAfterOpen = [...engine.readPaths];
    assert.equal(await binding.save(), true);
    assert.deepEqual(engine.readPaths, readsAfterOpen);

    const secondBinding = useWorkspace();
    await secondBinding.bootstrap();
    assert.equal(await secondBinding.openProjectFromPath(parentPath), true);
    const unit = secondBinding.editorState.value?.document.components.find((component) => component.id === "unit");
    assert.equal(unit?.data?.subcircuit?.status, "resolved");
    assert.deepEqual(unit?.ports?.map((port) => [port.name, port.direction, port.width]), [["a", "input", 1], ["y", "output", 1]]);
  } finally {
    restore();
  }
});

test("an unresolved branch stays visible while ordinary sibling branches are still flattened and evaluated", async () => {
  const engine = new AcceptanceEngine();
  const restore = installWindow(engine);
  try {
    const parentPath = "E:\\circuits\\partial.circuit.json";
    const project: ProjectFileData = {
      version: 1,
      circuit: {
        components: [
          { id: "source", kind: "input", displayName: "Source", position: { x: 0, y: 0 }, ports: ports.input },
          { id: "gate", kind: "not", displayName: "NOT", position: { x: 40, y: 0 } },
          { id: "sink", kind: "output", displayName: "Sink", position: { x: 80, y: 0 }, ports: ports.output },
          { id: "missing", kind: "subcircuit", displayName: "missing.circuit.json", position: { x: 40, y: 100 }, data: {
            reference: ".\\missing.circuit.json",
            cachedPorts: [{ name: "a", direction: "input", width: 1 }, { name: "y", direction: "output", width: 1 }],
          } },
        ],
        connections: [
          { id: "in", source: { component: "source", port: "out" }, target: { component: "gate", port: "in" } },
          { id: "out", source: { component: "gate", port: "out" }, target: { component: "sink", port: "in" } },
        ],
      },
    };
    engine.files.set(parentPath, JSON.stringify(project));
    const binding = useWorkspace();
    await binding.bootstrap();
    assert.equal(await binding.openProjectFromPath(parentPath), true);
    const document = binding.editorState.value?.document;
    assert.equal(document?.components.find((component) => component.id === "missing")?.data?.subcircuit?.status, "unresolved");
    assert.deepEqual(document?.components.map((component) => component.id), ["source", "gate", "sink", "missing"]);
    assert.deepEqual(engine.calls.filter((call) => call.startsWith("add:")), ["add:input", "add:not", "add:output"]);
    assert.equal(binding.state.value.hasCircuit, true);
  } finally {
    restore();
  }
});

test("an unresolved Subcircuit can be duplicated, deleted, undone and redone without an engine subtree", async () => {
  const engine = new AcceptanceEngine();
  const restore = installWindow(engine);
  try {
    const parentPath = "E:\\circuits\\parent.circuit.json";
    engine.files.set(parentPath, JSON.stringify(unresolvedParent()));
    const binding = useWorkspace();
    await binding.bootstrap();
    assert.equal(await binding.openProjectFromPath(parentPath), true);
    assert.equal(binding.editorState.value?.document.components[0]?.data?.subcircuit?.status, "unresolved");
    const beforeCalls = [...engine.calls];

    assert.equal(await binding.duplicateComponent("unit"), true);
    const components = binding.editorState.value?.document.components ?? [];
    assert.equal(components.length, 2);
    assert.notEqual(components[0]?.id, components[1]?.id);
    assert.deepEqual(components.map((component) => component.data?.subcircuit?.status), ["unresolved", "unresolved"]);
    assert.deepEqual(engine.calls.filter((call) => !call.startsWith("settle")), beforeCalls.filter((call) => !call.startsWith("settle")));

    await binding.undo();
    assert.equal(binding.editorState.value?.document.components.length, 1);
    await binding.redo();
    assert.equal(binding.editorState.value?.document.components.length, 2);
    const duplicateId = binding.editorState.value?.document.components[1]?.id;
    assert.ok(duplicateId);
    await binding.deleteComponent(duplicateId);
    assert.equal(binding.editorState.value?.document.components.length, 1);
    await binding.undo();
    assert.equal(binding.editorState.value?.document.components.length, 2);
    assert.deepEqual(engine.calls.filter((call) => !call.startsWith("settle")), beforeCalls.filter((call) => !call.startsWith("settle")));
  } finally {
    restore();
  }
});

test("a resolved Subcircuit keeps authoritative flat ports for its read-only internal signal table", async () => {
  const engine = new AcceptanceEngine();
  const restore = installWindow(engine);
  try {
    const parentPath = "E:\\circuits\\parent.circuit.json";
    const childPath = "E:\\circuits\\child.circuit.json";
    engine.files.set(parentPath, JSON.stringify(resolvedParent()));
    engine.files.set(childPath.toLowerCase(), JSON.stringify(resolvedChild()));
    const binding = useWorkspace();
    await binding.bootstrap();

    assert.equal(await binding.openProjectFromPath(parentPath), true);
    const internal = binding.state.value.internalComponents ?? [];
    assert.equal(internal.length, 2);
    assert.deepEqual(internal.map((descriptor) => descriptor.flatId), ["unit/gate", "unit/gate2"]);
    assert.deepEqual(internal.map((descriptor) => descriptor.ports.map((port) => port.name)), [
      ["in", "out"],
      ["in", "out"],
    ]);
  } finally {
    restore();
  }
});

test("a failed resolved Subcircuit projection is compensated without publishing a history frame", async () => {
  const engine = new AcceptanceEngine();
  const restore = installWindow(engine);
  try {
    const parentPath = "E:\\circuits\\parent.circuit.json";
    const childPath = "E:\\circuits\\child.circuit.json";
    engine.files.set(parentPath, JSON.stringify(resolvedParent()));
    engine.files.set(childPath.toLowerCase(), JSON.stringify(resolvedChild()));
    const binding = useWorkspace();
    await binding.bootstrap();
    assert.equal(await binding.openProjectFromPath(parentPath), true);
    const beforeDocument = JSON.stringify(binding.editorState.value?.document);
    const beforeCalls = engine.calls.length;
    // duplicate 展平子树按 input → gate → output 创建；第二次创建失败时第一项必须被移除补偿。
    engine.failOnAddCall = engine.addCallCount + 2;
    const duplicateResult = await binding.duplicateComponent("unit");
    assert.equal(duplicateResult, false);
    assert.equal(JSON.stringify(binding.editorState.value?.document), beforeDocument);
    assert.equal(binding.editorState.value?.operation, "idle");
    assert.equal(binding.editorState.value?.canUndo, false);
    assert.equal(engine.calls.slice(beforeCalls).some((call) => call.startsWith("remove:")), true);
  } finally {
    restore();
  }
});

test("a projection compensation failure enters recovery-required instead of claiming Subcircuit success", async () => {
  const engine = new AcceptanceEngine();
  const restore = installWindow(engine);
  try {
    const parentPath = "E:\\circuits\\parent.circuit.json";
    const childPath = "E:\\circuits\\child.circuit.json";
    engine.files.set(parentPath, JSON.stringify(resolvedParent()));
    engine.files.set(childPath.toLowerCase(), JSON.stringify(resolvedChild()));
    const binding = useWorkspace();
    await binding.bootstrap();
    assert.equal(await binding.openProjectFromPath(parentPath), true);
    engine.failOnAddCall = engine.addCallCount + 2;
    engine.failRemove = true;
    const duplicateResult = await binding.duplicateComponent("unit");
    assert.equal(duplicateResult, false);
    assert.equal(binding.editorState.value?.operation, "recovery-required");
    assert.equal(binding.editorState.value?.document.components.filter((component) => component.kind === "subcircuit").length, 1);
  } finally {
    restore();
  }
});
