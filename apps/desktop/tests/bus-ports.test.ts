import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentKindName, PortSpec } from "@circuit-platform/protocol";
import { componentGeometryFor, createComponentDefinitionRegistry } from "../src/canvas/index.ts";
import {
  branchBitRanges,
  defaultPortsFor,
  formatBitRangeList,
  isDataDrivenKind,
  parseBitRangeList,
  portsWithBitRanges,
} from "../src/editor/bus-ports.ts";
import { BUILT_IN_PORTS } from "./fake-ports.ts";

const registry = createComponentDefinitionRegistry();

/** 只有拆线器与合线器把端口形状交给数据；其余元件的形状是固定的。 */
test("only the splitter and the merger are data driven", () => {
  assert.equal(isDataDrivenKind("splitter"), true);
  assert.equal(isDataDrivenKind("merger"), true);
  for (const kind of Object.keys(BUILT_IN_PORTS) as (keyof typeof BUILT_IN_PORTS)[]) {
    if (kind === "splitter" || kind === "merger") continue;
    assert.equal(isDataDrivenKind(kind), false, kind);
    assert.equal(defaultPortsFor(kind), null, kind);
  }
});

/** 放下即可用：默认的拆线器是 8 位输入拆成八条 1 位分支，合线器与它对称。 */
test("a new splitter and a new merger default to eight one-bit branches", () => {
  const splitter = defaultPortsFor("splitter")!;
  assert.equal(splitter[0]?.name, "in");
  assert.equal(splitter[0]?.direction, "input");
  assert.equal(splitter[0]?.width, 8);
  assert.equal(splitter[0]?.bitRange, undefined);
  assert.deepEqual(splitter.slice(1).map((port) => port.name), ["out0", "out1", "out2", "out3", "out4", "out5", "out6", "out7"]);
  // 位编号 [N-1:0]，0 号分支拿最高位：画布上它因此排在最上面。
  assert.deepEqual(splitter.slice(1).map((port) => port.bitRange), [
    { msb: 7, lsb: 7 }, { msb: 6, lsb: 6 }, { msb: 5, lsb: 5 }, { msb: 4, lsb: 4 },
    { msb: 3, lsb: 3 }, { msb: 2, lsb: 2 }, { msb: 1, lsb: 1 }, { msb: 0, lsb: 0 },
  ]);
  // 每条分支的位宽等于它声明的区间长度。
  assert.ok(splitter.slice(1).every((port) => port.width === 1));

  const merger = defaultPortsFor("merger")!;
  assert.equal(merger.at(-1)?.name, "out");
  assert.equal(merger.at(-1)?.direction, "output");
  assert.equal(merger.at(-1)?.width, 8);
  assert.deepEqual(merger.slice(0, -1).map((port) => port.name), ["in0", "in1", "in2", "in3", "in4", "in5", "in6", "in7"]);
  assert.equal(merger.at(-1)?.bitRange, undefined);
  // 两个元件互为镜像：分支的位区间逐条相同，只有方向相反。
  assert.deepEqual(branchBitRanges(merger), branchBitRanges(splitter));
});

/** 数据驱动元件的尺寸按端口清单算出来：高度跟着端口数走，宽度有下限。 */
test("the geometry of a data driven component grows with its port count", () => {
  const definition = registry.get("splitter")!;
  const eight = componentGeometryFor(definition, defaultPortsFor("splitter")!);
  // 留白 30 上下各一份，八条分支之间 7 段 32。
  assert.deepEqual(eight.size, { width: 148, height: 30 * 2 + 7 * 32 });
  assert.equal(eight.pitch, 32);

  // 分支少的时候高度照着端口数回落，下限 84 只在每侧最多一个端口时才生效。
  const two = componentGeometryFor(definition, defaultPortsFor("splitter", 2)!);
  assert.deepEqual(two.size, { width: 148, height: 30 * 2 + 32 });
  assert.equal(two.pitch, 32);

  const one = componentGeometryFor(definition, defaultPortsFor("splitter", 1)!);
  assert.deepEqual(one.size, { width: 148, height: 84 });

  // 每侧只有一个端口时下限 84 生效：八条分支时的高度是 7 段间距撑开的，不是堆在两侧。
  const wide = componentGeometryFor(definition, [
    { name: "in", direction: "input", width: 32 },
    { name: "out0", direction: "output", width: 32, bitRange: { msb: 31, lsb: 0 } },
  ]);
  assert.deepEqual(wide.size, { width: 148, height: 84 });

  // 宽度按最长的那条端口标注估算：`out0[7:7]` 这类标签撑不开 148 的下限，更长的名字才顶开。
  // 30 个字符 × 8 + 两侧内缩 48 = 288，正好落在 16 的网格上。
  const longLabel = componentGeometryFor(definition, [
    { name: "in", direction: "input", width: 2 },
    { name: "a_branch_with_a_long_name", direction: "output", width: 2, bitRange: { msb: 1, lsb: 0 } },
  ]);
  assert.deepEqual(longLabel.size, { width: 288, height: 84 });
});

/** 内置元件的几何是展示定义里那个固定值，通用间距原样不动——既有元件的画布外观因此不变。 */
test("built in components keep their fixed size and the generic pitch", () => {
  for (const definition of registry.list()) {
    if (definition.sizing === "by-port-count") continue;
    const geometry = componentGeometryFor(definition, BUILT_IN_PORTS[definition.kind as ComponentKindName]);
    assert.deepEqual(geometry.size, definition.size, definition.kind);
    assert.equal(geometry.pitch, 24, definition.kind);
  }
});

/** 位区间列表的文本形式与解析互为逆运算。 */
test("parses and formats the bit range list", () => {
  assert.deepEqual(parseBitRangeList("7:7, 6:6"), [{ msb: 7, lsb: 7 }, { msb: 6, lsb: 6 }]);
  assert.deepEqual(parseBitRangeList("7:4,3:0"), [{ msb: 7, lsb: 4 }, { msb: 3, lsb: 0 }]);
  assert.equal(formatBitRangeList([{ msb: 7, lsb: 4 }, { msb: 3, lsb: 0 }]), "7:4, 3:0");
  assert.deepEqual(parseBitRangeList(formatBitRangeList(branchBitRanges(defaultPortsFor("splitter")!))), branchBitRanges(defaultPortsFor("splitter")!));

  // 形状不对的输入连一份端口清单都拼不出来，因此在本地就停下；覆盖规则由引擎判定。
  assert.equal(parseBitRangeList(""), null);
  assert.equal(parseBitRangeList("7"), null);
  assert.equal(parseBitRangeList("7-4"), null);
  assert.equal(parseBitRangeList("7:4,"), null);
  assert.equal(parseBitRangeList("4:7"), null);
  assert.equal(parseBitRangeList("x:0"), null);
  assert.equal(parseBitRangeList("-1:0"), null);
});

/** 改位区间会重算分支的数量、名字与位宽，宿主总线端口原样保留。 */
test("rebuilds the port list from a new bit range list", () => {
  const before = defaultPortsFor("splitter")!;
  const merged = portsWithBitRanges("splitter", before, [{ msb: 7, lsb: 4 }, { msb: 3, lsb: 0 }]);

  assert.deepEqual(merged.map((port) => port.name), ["in", "out0", "out1"]);
  assert.deepEqual(merged, [
    { name: "in", direction: "input", width: 8 },
    { name: "out0", direction: "output", width: 4, bitRange: { msb: 7, lsb: 4 } },
    { name: "out1", direction: "output", width: 4, bitRange: { msb: 3, lsb: 0 } },
  ] satisfies PortSpec[]);

  // 合线器同样重算，只是宿主在最后、分支是输入。
  const merger = portsWithBitRanges("merger", defaultPortsFor("merger")!, [{ msb: 7, lsb: 0 }]);
  assert.deepEqual(merger, [
    { name: "in0", direction: "input", width: 8, bitRange: { msb: 7, lsb: 0 } },
    { name: "out", direction: "output", width: 8 },
  ] satisfies PortSpec[]);
});
