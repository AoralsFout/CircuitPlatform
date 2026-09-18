import type { ComponentKindName, PortSpec } from "@circuit-platform/protocol";

/**
 * 假引擎使用的内置端口清单。
 *
 * 这里必须有一份，是因为**假引擎扮演的就是引擎**：真实引擎在 `add_component` 省略端口清单时
 * 回退到自己的内置定义，并把实际清单回传。夹具要重现的正是这条路径，而前端源码里不该再有
 * 第二份——端口清单的唯一权威来源是引擎。
 */
const bit = (name: string, direction: PortSpec["direction"]): PortSpec => ({ name, direction, width: 1 });

export const BUILT_IN_PORTS: Readonly<Record<ComponentKindName, readonly PortSpec[]>> = {
  input: [bit("out", "output")],
  output: [bit("in", "input")],
  and: [bit("in1", "input"), bit("in2", "input"), bit("out", "output")],
  or: [bit("in1", "input"), bit("in2", "input"), bit("out", "output")],
  nand: [bit("in1", "input"), bit("in2", "input"), bit("out", "output")],
  nor: [bit("in1", "input"), bit("in2", "input"), bit("out", "output")],
  xor: [bit("in1", "input"), bit("in2", "input"), bit("out", "output")],
  xnor: [bit("in1", "input"), bit("in2", "input"), bit("out", "output")],
  not: [bit("in", "input"), bit("out", "output")],
  clock: [bit("out", "output")],
  d_flip_flop: [bit("d", "input"), bit("clock", "input"), bit("q", "output")],
};

/**
 * 取一种元件的内置端口清单；调用方给了清单时用调用方的那份。
 * @param kind 元件类型。
 * @param ports 请求里携带的端口清单，省略时回退到内置定义。
 * @returns 该元件实际的端口清单，与真实引擎的回退规则一致。
 */
export function portsForAddComponent(
  kind: ComponentKindName,
  ports?: readonly PortSpec[],
): readonly PortSpec[] {
  return ports ?? BUILT_IN_PORTS[kind];
}

/**
 * 把「编辑器元件 ID → 元件类型」映射成一份端口清单映射，供测试拼装仿真绑定。
 * @param kinds 编辑器元件 ID 到类型的映射。
 * @returns 每个 ID 对应的内置端口清单。
 */
export function builtInPortsById(
  kinds: Readonly<Record<string, ComponentKindName>>,
): Record<string, readonly PortSpec[]> {
  return Object.fromEntries(Object.entries(kinds).map(([id, kind]) => [id, BUILT_IN_PORTS[kind]]));
}
