import assert from "node:assert/strict";
import test from "node:test";
import { createComponentDefinitionRegistry, hitTestCanvas, type CanvasPort, type CanvasScene } from "../src/canvas/index.ts";
import { contextActionsFor } from "../src/editor/context-menu.ts";
import { createInspectorModel } from "../src/editor/inspector.ts";
import { defaultPortsFor } from "../src/editor/bus-ports.ts";
import { BUILT_IN_PORTS } from "./fake-ports.ts";

/**
 * 把引擎回传的端口清单摊成画布端口。
 * 几何走展示布局规则；这里只关心检查器读到的字段，因此偏移按调用方给的表直接摆好。
 */
function canvasPorts(
  ports: readonly { name: string; direction: "input" | "output"; width: number; bitRange?: { msb: number; lsb: number } }[],
  origin: { x: number; y: number },
  offsets: Readonly<Record<string, { x: number; y: number }>>,
  labels: Readonly<Record<string, string>> = {},
): CanvasPort[] {
  return ports.map((port) => {
    const offset = offsets[port.name]!;
    const label = labels[port.name] ?? port.name;
    return {
      id: port.name,
      name: label,
      label: port.bitRange
        ? `${label}[${port.bitRange.msb}:${port.bitRange.lsb}]`
        : port.width > 1 ? `${label}[${port.width - 1}:0]` : label,
      direction: port.direction,
      width: port.width,
      ...(port.bitRange ? { bitRange: { ...port.bitRange } } : {}),
      point: { x: origin.x + offset.x, y: origin.y + offset.y },
      offset: { ...offset },
      signal: "X",
      dangling: false,
    };
  });
}

function scene(): CanvasScene {
  return {
    nodes: [{
      id: "and-1", kind: "and", displayName: "AND 1", symbol: "&", description: "所有输入为 1 时输出 1。",
      position: { x: 100, y: 100 }, size: { width: 148, height: 84 }, selected: true,
      ports: [
        { id: "in1", name: "in1", label: "in1", direction: "input", width: 1, point: { x: 100, y: 130 }, offset: { x: 0, y: 30 }, signal: "1", dangling: false },
        { id: "out", name: "out", label: "out", direction: "output", width: 1, point: { x: 248, y: 142 }, offset: { x: 148, y: 42 }, signal: "1", dangling: false },
      ],
    }],
    wires: [{
      id: "wire-1", source: { componentId: "source", port: "out", point: { x: 0, y: 142 } },
      target: { componentId: "and-1", port: "in1", point: { x: 100, y: 130 } },
      route: [{ x: 0, y: 142 }, { x: 50, y: 142 }, { x: 50, y: 130 }, { x: 100, y: 130 }],
      waypoints: [{ x: 50, y: 142 }, { x: 50, y: 130 }],
      signal: "1", danglingEndpoints: [], dangling: false, selected: false,
    }],
    bounds: { min: { x: 0, y: 100 }, max: { x: 248, y: 184 } },
  };
}

test("hit testing honors Port, selected Wire handles, node, Wire, then background priority", () => {
  const current = scene();
  assert.deepEqual(hitTestCanvas(current, { x: 100, y: 130 }), { kind: "port", nodeId: "and-1", portId: "in1" });
  const segmentScene = scene();
  segmentScene.wires[0]!.route = [{ x: 0, y: 142 }, { x: 50, y: 142 }, { x: 50, y: 110 }, { x: 100, y: 110 }];
  assert.deepEqual(hitTestCanvas(segmentScene, { x: 50, y: 126 }, { selectedConnectionId: "wire-1" }), { kind: "wire-handle", connectionId: "wire-1", handle: "segment", index: 1 });
  assert.deepEqual(hitTestCanvas(current, { x: 25, y: 142 }, { selectedConnectionId: "wire-1" }), { kind: "wire", connectionId: "wire-1" });
  assert.deepEqual(hitTestCanvas(current, { x: 120, y: 170 }), { kind: "component", nodeId: "and-1" });
  assert.deepEqual(hitTestCanvas(current, { x: 50, y: 130 }), { kind: "wire", connectionId: "wire-1" });
  assert.deepEqual(hitTestCanvas(current, { x: 500, y: 500 }), { kind: "background" });
});

test("object context actions keep Component and Wire vocabulary separate", () => {
  assert.deepEqual(contextActionsFor({ kind: "component", nodeId: "and-1" }).map((item) => item.id), ["copy-component", "delete-component"]);
  assert.deepEqual(contextActionsFor({ kind: "wire", connectionId: "wire-1" }).map((item) => item.id), ["edit-route", "reset-route", "delete-connection"]);
  assert.deepEqual(contextActionsFor({ kind: "wire-handle", connectionId: "wire-1", handle: "segment", index: 0 }).map((item) => item.id), ["edit-route", "reset-route", "delete-connection"]);
  assert.deepEqual(contextActionsFor({ kind: "wire-handle", connectionId: "wire-1", handle: "waypoint", index: 1 }).map((item) => item.id), ["edit-route", "delete-waypoint", "reset-route", "delete-connection"]);
  assert.deepEqual(contextActionsFor({ kind: "port", nodeId: "and-1", portId: "in1" }), []);
});

/** D Flip-Flop 的 `q` 与 `d` 对齐而不是垂直居中，这三个坐标来自它自己的展示布局。 */
const FLIP_FLOP_OFFSETS = { d: { x: 0, y: 30 }, clock: { x: 0, y: 54 }, q: { x: 148, y: 30 } } as const;
const FLIP_FLOP_LABELS = { d: "D", clock: "CLK", q: "Q" } as const;

/** 没有接时钟的 D Flip-Flop 每一步都不更新：这是结构问题，检查器给出一行提示而不是报错。 */
test("inspector hints when the d flip-flop clock port has no connection", () => {
  const registry = createComponentDefinitionRegistry();
  const unconnectedClock: CanvasScene = {
    nodes: [{
      id: "dff-1", kind: "d_flip_flop", displayName: "D Flip-Flop", symbol: "D", description: "在 clock 端口的上升沿把 D 采样进 Q。",
      position: { x: 100, y: 100 }, size: { width: 148, height: 84 }, selected: true,
      ports: canvasPorts(BUILT_IN_PORTS.d_flip_flop, { x: 100, y: 100 }, FLIP_FLOP_OFFSETS, FLIP_FLOP_LABELS),
    }],
    wires: [{
      id: "wire-1", source: { componentId: "source", port: "out", point: { x: 0, y: 130 } },
      target: { componentId: "dff-1", port: "d", point: { x: 100, y: 130 } },
      route: [{ x: 0, y: 130 }, { x: 50, y: 130 }, { x: 50, y: 130 }, { x: 100, y: 130 }],
      signal: "1", danglingEndpoints: [], dangling: false, selected: false,
    }],
    bounds: { min: { x: 0, y: 100 }, max: { x: 248, y: 184 } },
  };

  const model = createInspectorModel(unconnectedClock, { kind: "component", id: "dff-1" }, registry);
  assert.equal(model?.kind, "component");
  if (model?.kind === "component") {
    assert.equal(model.ports.find((port) => port.id === "clock")?.connectionState, "unconnected");
    // 端口行显示的是带端口名的展示标签，位宽为 1 时不含位区间。
    assert.equal(model.ports.find((port) => port.id === "clock")?.label, "CLK");
    assert.match(model.hint ?? "", /clock 端口未连接/);
  }

  // 时钟接上之后提示消失。
  const connectedClock: CanvasScene = {
    ...unconnectedClock,
    wires: [...unconnectedClock.wires, {
      id: "wire-2", source: { componentId: "clock-source", port: "out", point: { x: 0, y: 154 } },
      target: { componentId: "dff-1", port: "clock", point: { x: 100, y: 154 } },
      route: [{ x: 0, y: 154 }, { x: 50, y: 154 }, { x: 50, y: 154 }, { x: 100, y: 154 }],
      signal: "0", danglingEndpoints: [], dangling: false, selected: false,
    }],
  };
  const connected = createInspectorModel(connectedClock, { kind: "component", id: "dff-1" }, registry);
  assert.equal(connected?.kind === "component" ? connected.hint : "missing", null);
});

/** 位宽是第一个可编辑属性，而 Input / Output 各只有一个端口，改它就是改「这个元件有多宽」。 */
test("inspector exposes the width as the first editable attribute of an Input", () => {
  const registry = createComponentDefinitionRegistry();
  const input: CanvasScene = {
    nodes: [{
      id: "input-1", kind: "input", displayName: "输入 1", symbol: "→", description: "产生 0 或 1 的数字输入。",
      position: { x: 0, y: 0 }, size: { width: 148, height: 84 }, selected: true,
      ports: canvasPorts([{ name: "out", direction: "output", width: 8 }], { x: 0, y: 0 }, { out: { x: 148, y: 42 } }),
    }],
    wires: [],
    bounds: { min: { x: 0, y: 0 }, max: { x: 148, y: 84 } },
  };
  const model = createInspectorModel(input, { kind: "component", id: "input-1" }, registry);
  assert.equal(model?.kind, "component");
  if (model?.kind !== "component") return;

  assert.deepEqual(model.attributes, [{ id: "width", label: "位宽", value: 8, portName: "out" }]);
  // 端口行同时带上位宽与带位区间的标签。
  assert.equal(model.ports[0]?.width, 8);
  assert.equal(model.ports[0]?.label, "out[7:0]");
});

/**
 * 拆线器与合线器的可编辑属性是位区间列表；列表里每一项的 `msb:lsb` 就是它在检查器里的样子。
 */
test("inspector exposes the bit range list of a splitter", () => {
  const registry = createComponentDefinitionRegistry();
  const defaultPorts = defaultPortsFor("splitter")!;
  const splitter: CanvasScene = {
    nodes: [{
      id: "splitter-1", kind: "splitter", displayName: "拆线器 1", symbol: "⇤", description: "把一条多位总线按位区间拆成若干条分支。",
      position: { x: 0, y: 0 }, size: { width: 148, height: 284 }, selected: true,
      ports: canvasPorts(
        defaultPorts.map((port) => ({ name: port.name, direction: port.direction, width: port.width, bitRange: port.bitRange })),
        { x: 0, y: 0 },
        Object.fromEntries(defaultPorts.map((port, index) => [port.name, { x: 0, y: index * 32 }])),
      ),
    }],
    wires: [],
    bounds: { min: { x: 0, y: 0 }, max: { x: 148, y: 284 } },
  };
  const model = createInspectorModel(splitter, { kind: "component", id: "splitter-1" }, registry);
  assert.equal(model?.kind, "component");
  if (model?.kind !== "component") return;

  // 位区间列表跟在位宽之后；宿主总线端口在 portName 上，提交时用它认出哪一条是宿主。
  assert.deepEqual(model.attributes, [{
    id: "bit-ranges",
    label: "位区间",
    value: "7:7, 6:6, 5:5, 4:4, 3:3, 2:2, 1:1, 0:0",
    portName: "in",
  }]);
});

test("inspector projects read-only Component ports and Wire endpoints", () => {
  const current = scene();
  const registry = createComponentDefinitionRegistry();
  const component = createInspectorModel(current, { kind: "component", id: "and-1" }, registry);
  assert.equal(component?.kind, "component");
  if (component?.kind === "component") {
    assert.equal(component.type, "AND 门");
    assert.equal(component.behavior, "所有输入为 1 时输出 1。");
    assert.equal(component.ports[0]!.connectionState, "connected");
    assert.equal(component.ports[1]!.connectionState, "unconnected");
    assert.equal("position" in component, false);
    // 逻辑门固定按 1 位工作，因此没有可编辑属性。
    assert.deepEqual(component.attributes, []);
  }
  const wire = createInspectorModel(current, { kind: "connection", id: "wire-1" }, registry);
  assert.equal(wire?.kind, "wire");
  if (wire?.kind === "wire") {
    assert.deepEqual({
      kind: wire.kind, source: wire.source, target: wire.target, signal: wire.signal,
      status: wire.status, waypointCount: wire.waypointCount,
    }, {
      kind: "wire", source: { componentId: "source", port: "out" }, target: { componentId: "and-1", port: "in1" },
      signal: "1", status: "normal", waypointCount: 2,
    });
  }
});
