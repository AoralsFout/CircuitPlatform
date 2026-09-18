import type { CanvasNode } from "../canvas/index.ts";

/** 波形面板的一行：一行画一个信号。 */
export interface WaveformRow {
  label: string;
  /** `${editorComponentId}:${portId}`，与画布、检查器、波形记录共用同一套信号键空间。 */
  key: string;
}

/**
 * 由场景投影生成波形行：每个 Input 元件的驱动端口、每个其它元件的输出端口，以及每个 Output
 * 元件的接收端。
 *
 * 行的键就是 `${editorComponentId}:${portId}`，复用画布与检查器的同一套键空间，不引入第二套索引。
 * 行由场景推导而不是写死，因此增删元件后行跟着变，已经不存在的信号不会被画出来。一个元件有多
 * 个待观察端口时用端口标签区分，单端口元件只显示元件名——位宽为 1 的既有电路因此与改造前逐行相同。
 * @param nodes 场景投影里的元件节点。
 * @returns 按场景顺序排列的波形行。
 */
export function createWaveformRows(nodes: readonly CanvasNode[]): readonly WaveformRow[] {
  const rows: WaveformRow[] = [];
  for (const node of nodes) {
    // Input 的行读它自己的驱动端口，Output 的行读接收端，其余元件读自己的输出端口——与工作区
    // 推导运行时绑定的规则一致，因此工作区记录的键一定落在这些行里。
    const ports = node.ports.filter((port) => port.direction === (node.kind === "output" ? "input" : "output"));
    for (const port of ports) {
      rows.push({
        key: `${node.id}:${port.id}`,
        label: ports.length > 1 ? `${node.displayName} · ${port.label}` : node.displayName,
      });
    }
  }
  return rows;
}
