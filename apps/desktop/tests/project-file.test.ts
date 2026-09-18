import assert from "node:assert/strict";
import test from "node:test";
import type { EditorComponent, EditorConnection, EditorDocument, Point } from "../src/editor/index.ts";
import { createAndDemoDocument } from "../src/editor/index.ts";
import {
  PROJECT_FILE_VERSION,
  parseProjectFile,
  serializeProjectFile,
  type ProjectFileError,
  type ParsedProjectFile,
} from "../src/project-file/index.ts";

const at = (x: number, y: number): Point => ({ x, y });

function component(
  id: string,
  kind: EditorComponent["kind"],
  displayName: string,
  position: Point,
  ports?: readonly { name: string; direction: "input" | "output"; width: number; bitRange?: { msb: number; lsb: number } }[],
): EditorComponent {
  return {
    id,
    kind,
    displayName,
    position,
    lifecycle: "active",
    ...(ports ? { ports } : {}),
  };
}

function connection(
  id: string,
  source: { componentId: string; port: string },
  target: { componentId: string; port: string },
  extra: Partial<Pick<EditorConnection, "waypoints" | "color" | "route" | "lifecycle">> = {},
): EditorConnection {
  return {
    id,
    source: { ...source, point: at(0, 0) },
    target: { ...target, point: at(0, 0) },
    lifecycle: "visible",
    danglingEndpoints: [],
    ...extra,
  };
}

/** 断言解析失败并返回结构化错误列表；顺便确保成功分支从未被走到。 */
function failureOf(raw: unknown): readonly ProjectFileError[] {
  const result = parseProjectFile(raw);
  assert.ok(!result.ok, "expected the file to be rejected");
  return result.errors;
}

/** 断言解析成功并返回结果；失败时把全部原因拼进断言消息，方便定位。 */
function successOf(raw: unknown): ParsedProjectFile {
  const result = parseProjectFile(raw);
  assert.ok(result.ok, result.ok ? "" : result.errors.map((error) => `${error.code}: ${error.message}`).join("; "));
  return result.value;
}

const codesOf = (errors: readonly ProjectFileError[]): string[] => errors.map((error) => error.code);

test("serializes the exact v1 file shape for a mixed circuit", () => {
  const document: EditorDocument = {
    components: [
      component("input-a", "input", "输入 A", at(110, 100), [{ name: "out", direction: "output", width: 8 }]),
      component("and-gate", "and", "AND 门", at(440, 220)),
    ],
    connections: [
      connection(
        "wire-a",
        { componentId: "input-a", port: "out" },
        { componentId: "and-gate", port: "in1" },
        { waypoints: [at(330, 150), at(330, 250)], color: "cyan" },
      ),
    ],
  };

  // 整份文件对象被逐字断言：格式骨架（根、circuit、组件与连接记录）一旦漂移测试立刻失败。
  assert.deepEqual(serializeProjectFile({ document, inputValues: { "input-a": "1010" } }), {
    version: 1,
    circuit: {
      components: [
        {
          id: "input-a",
          kind: "input",
          displayName: "输入 A",
          position: { x: 110, y: 100 },
          ports: [{ name: "out", direction: "output", width: 8 }],
          data: { value: "1010" },
        },
        { id: "and-gate", kind: "and", displayName: "AND 门", position: { x: 440, y: 220 } },
      ],
      connections: [
        {
          id: "wire-a",
          source: { component: "input-a", port: "out" },
          target: { component: "and-gate", port: "in1" },
          waypoints: [{ x: 330, y: 150 }, { x: 330, y: 250 }],
          color: "cyan",
        },
      ],
    },
  });
});

test("round-trips a data-driven document without losing or shifting any field", () => {
  const document: EditorDocument = {
    components: [
      component("in-bus", "input", "输入总线", at(0, 0), [
        { name: "out", direction: "output", width: 8 },
      ]),
      component("split", "splitter", "拆线器", at(200, 0), [
        { name: "in", direction: "input", width: 8 },
        { name: "out0", direction: "output", width: 4, bitRange: { msb: 7, lsb: 4 } },
        { name: "out1", direction: "output", width: 4, bitRange: { msb: 3, lsb: 0 } },
      ]),
      component("merge", "merger", "合线器", at(400, 0), [
        { name: "in0", direction: "input", width: 4, bitRange: { msb: 7, lsb: 4 } },
        { name: "in1", direction: "input", width: 4, bitRange: { msb: 3, lsb: 0 } },
        { name: "out", direction: "output", width: 8 },
      ]),
      component("sink", "output", "输出", at(600, 0), [{ name: "in", direction: "input", width: 8 }]),
    ],
    connections: [
      connection("w1", { componentId: "in-bus", port: "out" }, { componentId: "split", port: "in" }, {
        waypoints: [at(100, -60)],
        color: "violet",
      }),
      connection("w2", { componentId: "merge", port: "out" }, { componentId: "sink", port: "in" }),
    ],
  };
  const inputValues = { "in-bus": "0110X01X" };

  const file = serializeProjectFile({ document, inputValues });
  const parsed = successOf(JSON.parse(JSON.stringify(file)));

  // 端点 point 是占位零点（投影层对已连接端点自行推导），除此之外文档数据原样还原。
  assert.deepEqual(parsed.document.components, document.components);
  assert.deepEqual(parsed.document.connections, [
    {
      id: "w1",
      source: { componentId: "in-bus", port: "out", point: at(0, 0) },
      target: { componentId: "split", port: "in", point: at(0, 0) },
      lifecycle: "visible",
      danglingEndpoints: [],
      waypoints: [at(100, -60)],
      color: "violet",
    },
    {
      id: "w2",
      source: { componentId: "merge", port: "out", point: at(0, 0) },
      target: { componentId: "sink", port: "in", point: at(0, 0) },
      lifecycle: "visible",
      danglingEndpoints: [],
    },
  ]);
  assert.deepEqual(parsed.inputValues, inputValues);
  assert.equal(parsed.version, PROJECT_FILE_VERSION);
});

test("derives semantic waypoints from a render-only route, as the editor session does", () => {
  // 示例文档的连接只带渲染 Route 没有 Waypoint 投影；序列化按会话移动元件时的同一条
  // 规则取 Route 的中间点作 Waypoint，直连（两个端点）不产生 Waypoint。
  const file = serializeProjectFile({ document: createAndDemoDocument() });
  const connections = file.circuit.connections;
  assert.deepEqual(connections[0]!.waypoints, [at(330, 150), at(330, 250)]);
  assert.deepEqual(connections[1]!.waypoints, [at(330, 405), at(330, 290)]);
  assert.equal(connections[2]!.waypoints, undefined);
  const parsed = successOf(file);
  assert.deepEqual(parsed.document.connections[0]!.waypoints, [at(330, 150), at(330, 250)]);
});

test("keeps port lists off built-in gates and ignores stray ones in files", () => {
  const document: EditorDocument = {
    components: [component("gate", "and", "与门", at(0, 0))],
    connections: [],
  };
  const file = serializeProjectFile({ document });
  assert.equal("ports" in file.circuit.components[0]!, false);

  // 文件里给内置门带 ports 属于未知数据：容忍忽略，不报错也不进结果。
  const parsed = successOf({
    version: 1,
    circuit: {
      components: [
        { id: "gate", kind: "and", displayName: "与门", position: { x: 0, y: 0 }, ports: [{ name: "out", direction: "output", width: 1 }] },
      ],
      connections: [],
    },
  });
  assert.equal("ports" in parsed.document.components[0]!, false);
});

test("leaves session-only state out of the file", () => {
  const document: EditorDocument = {
    components: [
      component("kept", "input", "保留", at(0, 0)),
      { ...component("gone", "or", "已删除", at(10, 10)), lifecycle: "deleted" },
    ],
    connections: [
      // 悬空连线（端点指向已删除元件）也不是文件内容：引用必须可解析，否则保存出的文件永远打不开。
      connection("dangling-wire", { componentId: "kept", port: "out" }, { componentId: "gone", port: "in" }),
      { ...connection("hidden-wire", { componentId: "kept", port: "out" }, { componentId: "gone", port: "in" }), lifecycle: "hidden" },
    ],
  };
  const file = serializeProjectFile({ document });
  assert.deepEqual(
    file.circuit.components.map((entry) => entry.id),
    ["kept"],
  );
  assert.deepEqual(file.circuit.connections, []);
});

test("rejects a missing, non-integer, or newer version with a displayable reason", () => {
  const shape = { circuit: { components: [], connections: [] } };
  assert.deepEqual(codesOf(failureOf(shape)), ["version-missing"]);
  for (const version of [1.5, "1", null, true]) {
    assert.deepEqual(codesOf(failureOf({ ...shape, version })), ["version-not-integer"]);
  }
  const newer = failureOf({ ...shape, version: 2 });
  assert.deepEqual(codesOf(newer), ["version-unsupported"]);
  assert.match(newer[0]!.message, /更新版本/);
  assert.ok(successOf({ ...shape, version: 1 }).version === 1);
});

test("tolerates unknown fields anywhere inside v1", () => {
  const parsed = successOf({
    version: 1,
    meta: { savedBy: "future-app" },
    circuit: {
      components: [
        {
          id: "input-a",
          kind: "input",
          displayName: "输入 A",
          position: { x: 110, y: 100, z: 9 },
          rotation: 90,
          data: { value: "10", pin: 3 },
        },
      ],
      connections: [
        {
          id: "wire-a",
          source: { component: "input-a", port: "out" },
          target: { component: "input-a", port: "out" },
          route: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
        },
      ],
    },
  });
  // 渲染 Route 即便出现在文件里也被忽略——文件只存语义 Waypoint。
  assert.deepEqual(parsed.document.components[0]!.position, { x: 110, y: 100 });
  assert.deepEqual(parsed.inputValues, { "input-a": "10" });
  assert.equal("route" in parsed.document.connections[0]!, false);
});

test("rejects the whole file on duplicate component ids and unresolved endpoint references", () => {
  const duplicate = failureOf({
    version: 1,
    circuit: {
      components: [
        { id: "dup", kind: "input", displayName: "A", position: { x: 0, y: 0 } },
        { id: "dup", kind: "output", displayName: "B", position: { x: 1, y: 1 } },
      ],
      connections: [],
    },
  });
  assert.deepEqual(codesOf(duplicate), ["component-id-duplicate"]);

  // 多处缺陷一次报全：结构化错误列表，不是 fail-fast 的第一条。
  const broken = failureOf({
    version: 1,
    circuit: {
      components: [
        { id: "a", kind: "input", displayName: "A", position: { x: 0, y: 0 } },
        { id: "a", kind: "output", displayName: "B", position: { x: 1, y: 1 } },
      ],
      connections: [
        { id: "w", source: { component: "a", port: "out" }, target: { component: "ghost", port: "in" } },
      ],
    },
  });
  assert.deepEqual(codesOf(broken).sort(), ["component-id-duplicate", "connection-endpoint-unresolved"]);

  // 整体拒绝：结果里没有可用的半成品文档。
  const result = parseProjectFile({
    version: 1,
    circuit: {
      components: [{ id: "a", kind: "input", displayName: "A", position: { x: 0, y: 0 } }],
      connections: [
        { id: "w", source: { component: "ghost", port: "in" }, target: { component: "a", port: "in" } },
      ],
    },
  });
  assert.ok(!result.ok);
  assert.equal("value" in result, false);
});

test("reports malformed structure with specific reasons", () => {
  assert.deepEqual(codesOf(failureOf("not an object")), ["root-not-object"]);
  assert.deepEqual(codesOf(failureOf({ version: 1 })), ["circuit-not-object"]);
  assert.deepEqual(
    codesOf(failureOf({ version: 1, circuit: { components: "no", connections: [] } })),
    ["components-not-array"],
  );
  assert.deepEqual(
    codesOf(failureOf({ version: 1, circuit: { components: [], connections: 42 } })),
    ["connections-not-array"],
  );

  const cases: readonly [unknown, string][] = [
    [{ kind: "input", displayName: "A", position: { x: 0, y: 0 } }, "component-id-invalid"],
    [{ id: "a", kind: "subcircuit", displayName: "A", position: { x: 0, y: 0 } }, "component-kind-unknown"],
    [{ id: "a", kind: "input", displayName: "A", position: { x: 0, y: "0" } }, "component-position-invalid"],
    [
      { id: "a", kind: "input", displayName: "A", position: { x: 0, y: 0 }, ports: [{ name: "out", direction: "output", width: 0 }] },
      "component-ports-invalid",
    ],
    [
      { id: "a", kind: "splitter", displayName: "S", position: { x: 0, y: 0 }, ports: [{ name: "in", direction: "input", width: 2, bitRange: { msb: 0, lsb: 3 } }] },
      "component-ports-invalid",
    ],
    [{ id: "a", kind: "input", displayName: "A", position: { x: 0, y: 0 }, data: { value: 10 } }, "component-data-invalid"],
  ];
  for (const [componentRecord, code] of cases) {
    const errors = failureOf({
      version: 1,
      circuit: { components: [componentRecord], connections: [] },
    });
    assert.ok(codesOf(errors).includes(code), `expected ${code} in ${JSON.stringify(codesOf(errors))}`);
  }

  const connectionCases: readonly [unknown, string][] = [
    [{ source: { component: "a", port: "out" }, target: { component: "a", port: "in" } }, "connection-id-invalid"],
    [{ id: "w", source: { component: "a" }, target: { component: "a", port: "in" } }, "connection-endpoint-invalid"],
    [{ id: "w", source: { component: "a", port: "out" }, target: { component: "a", port: "in" }, waypoints: [{ x: 1 }] }, "connection-waypoints-invalid"],
    [{ id: "w", source: { component: "a", port: "out" }, target: { component: "a", port: "in" }, color: "mauve" }, "connection-color-invalid"],
  ];
  for (const [connectionRecord, code] of connectionCases) {
    const errors = failureOf({
      version: 1,
      circuit: {
        components: [{ id: "a", kind: "input", displayName: "A", position: { x: 0, y: 0 } }],
        connections: [connectionRecord],
      },
    });
    assert.ok(codesOf(errors).includes(code), `expected ${code} in ${JSON.stringify(codesOf(errors))}`);
  }
});

test("round-trips an empty circuit and a portless input without errors", () => {
  const empty = successOf(serializeProjectFile({ document: { components: [], connections: [] } }));
  assert.deepEqual(empty.document, { components: [], connections: [] });
  assert.deepEqual(empty.inputValues, {});

  // 从未被引擎推送过的文档元件没有端口清单：文件里不写 ports，解析后同样不带。
  const fresh = serializeProjectFile({
    document: { components: [component("in", "input", "输入", at(0, 0))], connections: [] },
    inputValues: { in: "1" },
  });
  assert.equal("ports" in fresh.circuit.components[0]!, false);
  const parsed = successOf(fresh);
  assert.equal("ports" in parsed.document.components[0]!, false);
  assert.deepEqual(parsed.inputValues, { in: "1" });
});
