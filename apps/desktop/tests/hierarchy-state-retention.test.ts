import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentKindName, EngineResponse, PortSpec, Signal } from "@circuit-platform/protocol";
import { useWorkspace } from "../src/composables/useWorkspace.ts";
import type { ProjectFileData } from "../src/project-file/index.ts";
import type { EngineAdapter } from "../src/workspace/index.ts";
import { portsForAddComponent } from "./fake-ports.ts";

type ComponentState = {
  kind: ComponentKindName;
  ports: readonly PortSpec[];
  inputs: Map<string, Signal>;
  outputs: Map<string, Signal>;
  dffQ: Signal;
  previousClock: Signal;
};

/**
 * 可控的层次时序夹具：D Flip-Flop 只在已知 0 → 1 时采样，且每个引擎 Component
 * 自己持有 q/clock 历史。这样测试可以把「重复 occurrence 独立」与「普通结构编辑不清状态」
 * 钉在 useWorkspace 的公开边界，而不是依赖真实引擎进程的时序。
 */
class StatefulHierarchyEngine implements EngineAdapter {
  readonly files = new Map<string, string>();
  readonly resetCalls: number[] = [];
  readonly openChoices: string[] = [];
  private nextComponentId = 1;
  private nextConnectionId = 1;
  private readonly components = new Map<number, ComponentState>();
  private readonly connections = new Map<number, {
    source: { componentId: number; port: string };
    target: { componentId: number; port: string };
  }>();

  async checkEngine() {
    return { status: "ok" as const, engine: "stateful-fake", processEpoch: 1 };
  }

  async addComponent(kind: ComponentKindName, ports?: readonly PortSpec[]): Promise<EngineResponse> {
    const actualPorts = [...portsForAddComponent(kind, ports)];
    const componentId = this.nextComponentId++;
    const state: ComponentState = {
      kind,
      ports: actualPorts,
      inputs: new Map(actualPorts.filter((port) => port.direction === "input").map((port) => [port.name, "X"])),
      outputs: new Map(actualPorts.filter((port) => port.direction === "output").map((port) => [port.name, "X"])),
      dffQ: "X",
      previousClock: "X",
    };
    if (kind === "input") state.outputs.set("out", "0");
    if (kind === "d_flip_flop") state.outputs.set("q", "X");
    this.components.set(componentId, state);
    return { type: "component_added", requestId: "stateful", componentId, ports: actualPorts };
  }

  async setPortWidth(componentId: number, ports: readonly PortSpec[]): Promise<EngineResponse> {
    const component = this.components.get(componentId);
    if (!component) return this.error("元件不存在");
    component.ports = [...ports];
    for (const port of ports) {
      if (port.direction === "input" && !component.inputs.has(port.name)) component.inputs.set(port.name, "X");
      if (port.direction === "output" && !component.outputs.has(port.name)) component.outputs.set(port.name, "X");
    }
    return {
      type: "port_width_set",
      requestId: "stateful",
      componentId,
      ports: [...ports],
      danglingConnectionIds: [],
    };
  }

  async addConnection(
    source: { componentId: number; port: string },
    target: { componentId: number; port: string },
  ): Promise<EngineResponse> {
    const connectionId = this.nextConnectionId++;
    this.connections.set(connectionId, { source, target });
    return { type: "connection_added", requestId: "stateful", connectionId };
  }

  async removeComponent(componentId: number): Promise<EngineResponse> {
    this.components.delete(componentId);
    for (const [connectionId, connection] of this.connections) {
      if (connection.source.componentId === componentId || connection.target.componentId === componentId) {
        this.connections.delete(connectionId);
      }
    }
    return { type: "component_removed", requestId: "stateful", componentId };
  }

  async removeConnection(connectionId: number): Promise<EngineResponse> {
    this.connections.delete(connectionId);
    return { type: "connection_removed", requestId: "stateful", connectionId };
  }

  async setInput(componentId: number, value: Signal): Promise<EngineResponse> {
    const component = this.components.get(componentId);
    if (!component || component.kind !== "input") return this.error("输入元件不存在");
    component.outputs.set("out", value);
    return { type: "input_set", requestId: "stateful" };
  }

  async settle(): Promise<EngineResponse> {
    this.propagate();
    return { type: "settled", requestId: "stateful", status: "ok" };
  }

  async tick(): Promise<EngineResponse> {
    this.propagate();
    for (const component of this.components.values()) {
      if (component.kind !== "d_flip_flop") continue;
      const clock = component.inputs.get("clock") ?? "X";
      if (component.previousClock === "0" && clock === "1") {
        component.dffQ = component.inputs.get("d") ?? "X";
        component.outputs.set("q", component.dffQ);
      }
      component.previousClock = clock;
    }
    this.propagate();
    const signals = [...this.components.entries()].flatMap(([componentId, component]) =>
      [...component.outputs.entries()].map(([port, value]) => ({ componentId, port, value })),
    );
    return { type: "ticked", requestId: "stateful", step: 1, signals };
  }

  async reset(): Promise<EngineResponse> {
    this.resetCalls.push(1);
    for (const component of this.components.values()) {
      if (component.kind === "d_flip_flop") {
        component.dffQ = "X";
        component.previousClock = "X";
        component.outputs.set("q", "X");
      }
    }
    return { type: "reset_done", requestId: "stateful", status: "ok" };
  }

  async getSignal(componentId: number, port: string): Promise<EngineResponse> {
    const component = this.components.get(componentId);
    const value = component?.outputs.get(port) ?? component?.inputs.get(port) ?? "X";
    return { type: "signal_result", requestId: "stateful", value };
  }

  async readProjectFile(filePath: string): Promise<{ ok: true; content: string } | { ok: false; reason: string; code?: string }> {
    const content = this.files.get(filePath.toLowerCase());
    return content === undefined
      ? { ok: false, reason: "项目文件不存在。", code: "PROJECT_FILE_NOT_FOUND" }
      : { ok: true, content };
  }

  async pickOpenPath() {
    const path = this.openChoices.shift();
    return path === undefined ? { ok: false as const, reason: "canceled" } : { ok: true as const, path };
  }

  private propagate(): void {
    for (let iteration = 0; iteration < this.components.size + 2; iteration += 1) {
      for (const connection of this.connections.values()) {
        const source = this.components.get(connection.source.componentId);
        const target = this.components.get(connection.target.componentId);
        if (!source || !target) continue;
        target.inputs.set(connection.target.port, source.outputs.get(connection.source.port) ?? "X");
      }
      for (const component of this.components.values()) {
        const read = (port: string): Signal => component.inputs.get(port) ?? "X";
        const write = (port: string, value: Signal): void => { component.outputs.set(port, value); };
        switch (component.kind) {
          case "output": write("in", read("in")); break;
          case "not": write("out", invert(read("in"))); break;
          case "d_flip_flop": write("q", component.dffQ); break;
          default: break;
        }
      }
    }
  }

  private error(message: string): EngineResponse {
    return { type: "error", requestId: "stateful", code: "STATEFUL_FAKE_ERROR", message };
  }
}

function invert(value: Signal): Signal {
  return value === "0" ? "1" : value === "1" ? "0" : "X";
}

const inputPorts = [{ name: "out", direction: "output", width: 1 }] as const;
const outputPorts = [{ name: "in", direction: "input", width: 1 }] as const;
const dffPorts = [
  { name: "d", direction: "input", width: 1 },
  { name: "clock", direction: "input", width: 1 },
  { name: "q", direction: "output", width: 1 },
] as const;

function dffChildProject(): ProjectFileData {
  return {
    version: 2,
    circuit: {
      components: [
        { id: "d", kind: "input", displayName: "d", position: { x: 0, y: 0 }, ports: inputPorts },
        { id: "clock", kind: "input", displayName: "clock", position: { x: 0, y: 80 }, ports: inputPorts },
        { id: "ff", kind: "d_flip_flop", displayName: "DFF", position: { x: 160, y: 40 } },
        { id: "q", kind: "output", displayName: "q", position: { x: 320, y: 40 }, ports: outputPorts },
      ],
      connections: [
        { id: "d-ff", source: { component: "d", port: "out" }, target: { component: "ff", port: "d" } },
        { id: "clock-ff", source: { component: "clock", port: "out" }, target: { component: "ff", port: "clock" } },
        { id: "ff-q", source: { component: "ff", port: "q" }, target: { component: "q", port: "in" } },
      ],
    },
    definitions: {},
    libraryRoots: [],
  };
}

function parentProject(): ProjectFileData {
  const subcircuitPorts = [...dffPorts];
  const components = [
    ["data-1", "Data 1", 0, 0], ["clock-1", "Clock 1", 0, 80],
    ["data-2", "Data 2", 0, 220], ["clock-2", "Clock 2", 0, 300],
  ].map(([id, displayName, x, y]) => ({
    id: id as string,
    kind: "input" as const,
    displayName: displayName as string,
    position: { x: x as number, y: y as number },
    ports: inputPorts,
    data: { value: "0" },
  }));
  return {
    version: 2,
    circuit: {
      components: [
        ...components,
        { id: "u1", kind: "subcircuit", displayName: "register.circuit.json", position: { x: 240, y: 40 }, data: { definitionId: "register", cachedPorts: subcircuitPorts } },
        { id: "u2", kind: "subcircuit", displayName: "register.circuit.json", position: { x: 240, y: 240 }, data: { definitionId: "register", cachedPorts: subcircuitPorts } },
        { id: "out-1", kind: "output", displayName: "Q 1", position: { x: 520, y: 40 }, ports: outputPorts },
        { id: "out-2", kind: "output", displayName: "Q 2", position: { x: 520, y: 240 }, ports: outputPorts },
      ],
      connections: [
        { id: "u1-d", source: { component: "data-1", port: "out" }, target: { component: "u1", port: "d" } },
        { id: "u1-clock", source: { component: "clock-1", port: "out" }, target: { component: "u1", port: "clock" } },
        { id: "u1-q", source: { component: "u1", port: "q" }, target: { component: "out-1", port: "in" } },
        { id: "u2-d", source: { component: "data-2", port: "out" }, target: { component: "u2", port: "d" } },
        { id: "u2-clock", source: { component: "clock-2", port: "out" }, target: { component: "u2", port: "clock" } },
        { id: "u2-q", source: { component: "u2", port: "q" }, target: { component: "out-2", port: "in" } },
      ],
    },
    definitions: { register: { displayName: "register.circuit.json", circuit: dffChildProject().circuit } },
    libraryRoots: ["register"],
  };
}

function nestedSharedParentProject(): ProjectFileData {
  const parent = parentProject();
  const wrapper: ProjectFileData["circuit"] = {
    components: [
      { id: "d", kind: "input", displayName: "d", position: { x: 0, y: 0 }, ports: inputPorts },
      { id: "clock", kind: "input", displayName: "clock", position: { x: 0, y: 80 }, ports: inputPorts },
      { id: "inner", kind: "subcircuit", displayName: "register", position: { x: 160, y: 40 }, data: { definitionId: "register", cachedPorts: dffPorts } },
      { id: "q", kind: "output", displayName: "q", position: { x: 320, y: 40 }, ports: outputPorts },
    ],
    connections: [
      { id: "d-inner", source: { component: "d", port: "out" }, target: { component: "inner", port: "d" } },
      { id: "clock-inner", source: { component: "clock", port: "out" }, target: { component: "inner", port: "clock" } },
      { id: "inner-q", source: { component: "inner", port: "q" }, target: { component: "q", port: "in" } },
    ],
  };
  return {
    ...parent,
    circuit: { ...parent.circuit, components: parent.circuit.components.map((component) => component.kind === "subcircuit"
      ? { ...component, data: { definitionId: "wrapper", cachedPorts: dffPorts } }
      : component) },
    definitions: { ...parent.definitions, wrapper: { displayName: "wrapper.circuit.json", circuit: wrapper } },
    libraryRoots: ["wrapper"],
  };
}

function projectText(file: ProjectFileData): string {
  return JSON.stringify(file);
}

function installWindow(engine: StatefulHierarchyEngine): () => void {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      circuitPlatform: engine,
      localStorage: { getItem: () => null, setItem: () => undefined },
    },
  });
  return () => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  };
}

test("hierarchy DFF occurrences retain independent state across unrelated component edits", async () => {
  const engine = new StatefulHierarchyEngine();
  const parentPath = "E:\\circuits\\parent.circuit.json";
  engine.files.set(parentPath.toLowerCase(), projectText(parentProject()));
  const restore = installWindow(engine);

  try {
    const binding = useWorkspace();
    await binding.bootstrap();
    assert.equal(await binding.openProjectFromPath(parentPath), true, binding.openError.value ?? "层次项目打开失败");
    assert.equal(binding.state.value.signals["u1:q"], "X");
    assert.equal(binding.state.value.signals["u2:q"], "X");

    // 先建立两个 occurrence 的已知下降沿前值，再只给 u1 一个上升沿。
    await binding.step();
    await binding.setInputBit("data-1", 0, "1");
    await binding.setInputBit("clock-1", 0, "1");
    await binding.step();
    assert.equal(binding.state.value.signals["u1:q"], "1");
    assert.equal(binding.state.value.signals["u2:q"], "X");

    // 第二次上升沿只采样 u2，u1 的 q 必须保留。
    await binding.setInputBit("clock-1", 0, "0");
    await binding.setInputBit("clock-2", 0, "1");
    await binding.step();
    assert.equal(binding.state.value.signals["u1:q"], "1");
    assert.equal(binding.state.value.signals["u2:q"], "0");

    // 添加、几何编辑、改宽、连线普通元件都不应触发层次状态重置。
    assert.equal(await binding.addComponent("not", { x: 760, y: 60 }), true);
    assert.equal(binding.state.value.signals["u1:q"], "1");
    assert.equal(binding.state.value.signals["u2:q"], "0");

    assert.equal(await binding.addComponent("input", { x: 760, y: 240 }), true);
    assert.equal(await binding.addComponent("output", { x: 1040, y: 240 }), true);
    const ordinary = binding.editorState.value?.document.components.filter((component) => component.kind === "input" || component.kind === "output") ?? [];
    const ordinaryInput = ordinary.at(-2);
    const ordinaryOutput = ordinary.at(-1);
    assert.ok(ordinaryInput && ordinaryOutput);
    await binding.moveComponent(ordinaryInput.id, { x: 800, y: 260 });
    await binding.setPortWidthCommand(ordinaryInput.id, [{ name: "out", direction: "output", width: 2 }]);
    await binding.setPortWidthCommand(ordinaryOutput.id, [{ name: "in", direction: "input", width: 2 }]);
    const connected = await binding.createConnection(
      { componentId: ordinaryInput.id, port: "out", direction: "output", point: { x: 900, y: 260 } },
      { componentId: ordinaryOutput.id, port: "in", direction: "input", point: { x: 1040, y: 260 } },
    );
    assert.equal(connected.ok, true, connected.error);
    assert.equal(binding.state.value.signals["u1:q"], "1");
    assert.equal(binding.state.value.signals["u2:q"], "0");
    assert.deepEqual(engine.resetCalls, [], "无关普通元件编辑不得调用 reset");
  } finally {
    restore();
  }
});

test("two occurrences of a shared nested definition keep separate DFF state", async () => {
  const engine = new StatefulHierarchyEngine();
  const parentPath = "E:\\circuits\\nested-parent.circuit.json";
  engine.files.set(parentPath.toLowerCase(), projectText(nestedSharedParentProject()));
  const restore = installWindow(engine);
  try {
    const binding = useWorkspace();
    await binding.bootstrap();
    assert.equal(await binding.openProjectFromPath(parentPath), true, binding.openError.value ?? "");
    assert.equal(binding.state.value.signals["u1:q"], "X");
    assert.equal(binding.state.value.signals["u2:q"], "X");
    await binding.step();
    await binding.setInputBit("data-1", 0, "1");
    await binding.setInputBit("clock-1", 0, "1");
    await binding.step();
    assert.equal(binding.state.value.signals["u1:q"], "1");
    assert.equal(binding.state.value.signals["u2:q"], "X");
    await binding.setInputBit("clock-1", 0, "0");
    await binding.setInputBit("clock-2", 0, "1");
    await binding.step();
    assert.equal(binding.state.value.signals["u1:q"], "1");
    assert.equal(binding.state.value.signals["u2:q"], "0");
  } finally {
    restore();
  }
});

test("reimport resets both uses of a nested DFF definition without rewinding simulation time", async () => {
  const engine = new StatefulHierarchyEngine();
  const parentPath = "E:\\circuits\\nested-parent.circuit.json";
  const replacementPath = "G:\\moved\\register.circuit.json";
  engine.files.set(parentPath.toLowerCase(), projectText(nestedSharedParentProject()));
  engine.files.set(replacementPath.toLowerCase(), projectText(dffChildProject()));
  const restore = installWindow(engine);
  try {
    const binding = useWorkspace();
    await binding.bootstrap();
    assert.equal(await binding.openProjectFromPath(parentPath), true);
    await binding.step();
    await binding.setInputBit("data-1", 0, "1");
    await binding.setInputBit("clock-1", 0, "1");
    await binding.step();
    await binding.setInputBit("clock-1", 0, "0");
    await binding.setInputBit("clock-2", 0, "1");
    await binding.step();
    assert.deepEqual([binding.state.value.signals["u1:q"], binding.state.value.signals["u2:q"]], ["1", "0"]);
    const step = binding.state.value.simulationStep;
    engine.openChoices.push(replacementPath);
    assert.equal(await binding.reimportEmbeddedDefinition("register"), true, binding.openError.value ?? "");
    assert.deepEqual([binding.state.value.signals["u1:q"], binding.state.value.signals["u2:q"]], ["X", "X"]);
    assert.equal(binding.state.value.simulationStep, step);
    assert.deepEqual(engine.resetCalls, []);
    await binding.step();
    await binding.setInputBit("clock-1", 0, "1");
    await binding.step();
    assert.equal(binding.state.value.signals["u1:q"], "1");
    assert.equal(await binding.renameImportedSubcircuit("register", "Renamed"), true);
    await binding.undo();
    assert.equal(binding.state.value.signals["u1:q"], "1", "普通改名撤销不应继承重导入的强制重建标记");
    const afterRenameUndo = binding.state.value.simulationStep;
    await binding.undo();
    assert.equal(binding.state.value.simulationStep, afterRenameUndo);
    assert.deepEqual([binding.state.value.signals["u1:q"], binding.state.value.signals["u2:q"]], ["X", "X"]);
    await binding.dispose();
  } finally {
    restore();
  }
});

test("reimport preserves a different definition's DFF state in the same parent", async () => {
  const engine = new StatefulHierarchyEngine();
  const parentPath = "E:\\circuits\\separate-parent.circuit.json";
  const replacementPath = "G:\\moved\\register.circuit.json";
  const parent = parentProject();
  const separated: ProjectFileData = {
    ...parent,
    circuit: { ...parent.circuit, components: parent.circuit.components.map((component) => component.id === "u2" && component.data && "definitionId" in component.data
      ? { ...component, data: { ...component.data, definitionId: "unaffected" } } : component) },
    definitions: { ...parent.definitions, unaffected: { displayName: "Independent", circuit: dffChildProject().circuit } },
    libraryRoots: ["register", "unaffected"],
  };
  engine.files.set(parentPath.toLowerCase(), projectText(separated));
  engine.files.set(replacementPath.toLowerCase(), projectText(dffChildProject()));
  const restore = installWindow(engine);
  try {
    const binding = useWorkspace();
    await binding.bootstrap();
    assert.equal(await binding.openProjectFromPath(parentPath), true);
    await binding.step();
    await binding.setInputBit("data-1", 0, "1");
    await binding.setInputBit("clock-1", 0, "1");
    await binding.step();
    await binding.setInputBit("clock-1", 0, "0");
    await binding.setInputBit("clock-2", 0, "1");
    await binding.step();
    assert.deepEqual([binding.state.value.signals["u1:q"], binding.state.value.signals["u2:q"]], ["1", "0"]);
    engine.openChoices.push(replacementPath);
    assert.equal(await binding.reimportEmbeddedDefinition("register"), true, binding.openError.value ?? "");
    assert.deepEqual([binding.state.value.signals["u1:q"], binding.state.value.signals["u2:q"]], ["X", "0"]);
    await binding.dispose();
  } finally {
    restore();
  }
});
