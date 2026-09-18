import type { BitRange, ComponentKindName, PortSpec } from "@circuit-platform/protocol";

/**
 * 新放置的总线元件默认把宿主总线平均分成多少条分支。
 *
 * 默认值让元件放下即可用：8 位输入拆成八条 1 位分支，用户不必先改配置就能把总线接进逐位逻辑门。
 * 合线器与它对称——八条 1 位输入合成一条 8 位输出。
 */
export const DEFAULT_BUS_WIDTH = 8;

/**
 * 拆线器与合线器：端口数量由数据决定的两个元件。
 *
 * 引擎对它们没有内置定义——总线多宽、分成几条分支、每条覆盖哪几位全部由端口清单决定，因此
 * 清单必须由前端生成并随 `add_component` 一起发出。这与内置元件的「省略清单、引擎回退」相反。
 */
const DATA_DRIVEN_KINDS: readonly ComponentKindName[] = ["splitter", "merger"];

/**
 * 判断一种元件是不是数据驱动端口形状的元件。
 * @param kind 元件类型。
 * @returns 是拆线器或合线器时返回 true。
 */
export function isDataDrivenKind(kind: ComponentKindName): boolean {
  return DATA_DRIVEN_KINDS.includes(kind);
}

/**
 * 宿主总线端口的名字：拆线器从它取位，合线器把位放回它。
 * 不导出：宿主名是这份清单内部的一处构造细节，外部只该拿到整份清单（`defaultPortsFor` /
 * `portsWithBitRanges`），否则调用方又会照着名字自己拼第三份定义。
 */
function hostPortNameFor(kind: ComponentKindName): string {
  return kind === "merger" ? "out" : "in";
}

/**
 * 第 `index` 条分支的端口名；与宿主名一样不导出。
 * 分支按位区间从高到低排列，因此 0 号分支拿的是最高位段——画布上它因此在最上面（ADR 0017）。
 */
function branchPortNameFor(kind: ComponentKindName, index: number): string {
  return kind === "merger" ? `in${index}` : `out${index}`;
}

/**
 * 一个刚放下的拆线器或合线器的默认端口清单：`width` 位宿主总线，拆成 `width` 条 1 位分支。
 * @param kind 元件类型。
 * @param width 宿主总线的位宽。
 * @returns 端口清单；类型不是数据驱动元件时返回 null。
 */
export function defaultPortsFor(
  kind: ComponentKindName,
  width: number = DEFAULT_BUS_WIDTH,
): readonly PortSpec[] | null {
  if (!isDataDrivenKind(kind)) return null;

  const merging = kind === "merger";
  const branches: PortSpec[] = [];
  for (let index = 0; index < width; index += 1) {
    const bit = width - 1 - index;
    branches.push({
      name: branchPortNameFor(kind, index),
      direction: merging ? "input" : "output",
      width: 1,
      bitRange: { msb: bit, lsb: bit },
    });
  }

  const host: PortSpec = {
    name: hostPortNameFor(kind),
    direction: merging ? "output" : "input",
    width,
  };
  return merging ? [...branches, host] : [host, ...branches];
}

/**
 * 一个元件当前的分支位区间，按端口清单里的顺序。
 * @param ports 端口清单。
 * @returns 带位区间的端口各自的区间；没有分支时返回空数组。
 */
export function branchBitRanges(ports: readonly PortSpec[]): BitRange[] {
  return ports
    .filter((port) => port.bitRange !== undefined)
    .map((port) => ({ ...port.bitRange! }));
}

/**
 * 把检查器里的一行位区间文本解析成区间列表。
 *
 * 形状是逗号分隔的 `msb:lsb`，例如 `7:4, 3:0`。这里只解析形状：覆盖是否完整、有没有重叠、
 * 有没有越出宿主总线都是引擎的领域规则，让清单往返一次由引擎给出可展示的原因，前端不写
 * 第二份判定——两份判定迟早会说出两套规则。
 * @param text 用户输入的一行文本。
 * @returns 形状合法时返回区间列表，否则返回 null。
 */
export function parseBitRangeList(text: string): BitRange[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const ranges: BitRange[] = [];
  for (const part of trimmed.split(",")) {
    const match = /^\s*(\d+)\s*:\s*(\d+)\s*$/.exec(part);
    if (!match) return null;

    const msb = Number.parseInt(match[1]!, 10);
    const lsb = Number.parseInt(match[2]!, 10);
    if (!Number.isSafeInteger(msb) || !Number.isSafeInteger(lsb) || msb < lsb) return null;
    ranges.push({ msb, lsb });
  }
  return ranges;
}

/** 位区间列表的文本形式，与 `parseBitRangeList` 互为逆运算。 */
export function formatBitRangeList(ranges: readonly BitRange[]): string {
  return ranges.map((range) => `${range.msb}:${range.lsb}`).join(", ");
}

/**
 * 用新的位区间列表重建整份端口清单。
 *
 * 分支数量、每条分支的名字与位宽都跟着列表走：列表有几项就有几条分支，分支名按位置重新编号，
 * 位宽等于区间长度（引擎的 `validatePort` 要求这两者一致）。宿主总线端口留在它原来的位置上、
 * 声明原样不动——它说的是总线有多宽，而改区间不改变这件事，端口顺序也就不该被这次编辑搅动。
 *
 * 列表不满足覆盖规则时这里照样把清单拼出来：被拒绝的是引擎，它给出的原因才是用户该看到的那条。
 * @param kind 元件类型。
 * @param ports 当前的端口清单，用来找出宿主总线端口。
 * @param ranges 新的位区间列表，从最高位段到最低位段。
 * @returns 替换后的整份端口清单；端口清单里没有宿主总线端口时原样返回。
 */
export function portsWithBitRanges(
  kind: ComponentKindName,
  ports: readonly PortSpec[],
  ranges: readonly BitRange[],
): PortSpec[] {
  const hostIndex = ports.findIndex((port) => port.bitRange === undefined);
  if (hostIndex < 0) return ports.map((port) => ({ ...port }));

  const merging = kind === "merger";
  const rebuilt: PortSpec[] = ranges.map((range, index) => ({
    name: branchPortNameFor(kind, index),
    direction: merging ? "input" : "output",
    width: range.msb - range.lsb + 1,
    bitRange: { ...range },
  }));

  rebuilt.splice(hostIndex, 0, { ...ports[hostIndex]! });
  return rebuilt;
}
