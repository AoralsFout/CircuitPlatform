import type { Signal } from "@circuit-platform/protocol";
import type { EditorSnapshot } from "./index.ts";
import type { ComponentDefinitionRegistry, SimulationSnapshot } from "../canvas/index.ts";
import type { BinarySignal } from "../workspace/index.ts";

export interface SimulationDisplayInputs {
  /** 兼容投影：按文档顺序的前两个 Input 元件；已求值的输入优先取自 `inputValues`。 */
  inputA: BinarySignal;
  inputB: BinarySignal;
  inputValues?: Readonly<Record<string, BinarySignal>>;
  /**
   * 工作区最近一次稳定求值后读取到的端口信号，键为 `${componentId}:${portId}`。
   * 每个 Output 元件从自己的接收端读取，不回退到其它 Output 的值。
   */
  signals?: Readonly<Record<string, Signal>>;
}

/**
 * 从通用 EditorSnapshot 生成画布仿真展示快照；输入按文档中的 Input Component 顺序绑定。
 * @param snapshot 当前编辑器结构，不读取固定示例 ID。
 * @param registry 提供每种 Component 的 Port 定义。
 * @param values 工作区提供的输入、输出和最近一次稳定求值后的端口信号。
 * @returns 以 `${componentId}:${portId}` 为键的只读信号映射；未求值端口为 X。
 */
export function createSimulationSnapshot(
  snapshot: EditorSnapshot,
  registry: ComponentDefinitionRegistry,
  values: SimulationDisplayInputs,
): SimulationSnapshot {
  const inputs = snapshot.document.components.filter((component) => component.kind === "input");
  const signals: Record<string, Signal> = { ...values.signals };
  const observedKeys = new Set(Object.keys(values.signals ?? {}));
  for (const component of snapshot.document.components) {
    const definition = registry.get(component.kind);
    if (!definition) continue;
    const inputIndex = inputs.indexOf(component);
    for (const port of definition.ports) {
      const key = `${component.id}:${port.id}`;
      if (component.kind === "input" && port.direction === "output") {
        signals[key] = values.inputValues?.[component.id] ?? (inputIndex === 0 ? values.inputA : inputIndex === 1 ? values.inputB : "0");
        observedKeys.add(key);
      } else if (component.kind === "output" && port.direction === "input") {
        // 文档中的每个 Output 各自读取自己的信号；未求值时保持 X。
        signals[key] ??= "X";
        observedKeys.add(key);
      } else {
        signals[key] ??= "X";
      }
    }
  }
  for (const connection of snapshot.document.connections) {
    if (connection.danglingEndpoints.length > 0) continue;
    const sourceKey = `${connection.source.componentId}:${connection.source.port}`;
    if (!observedKeys.has(sourceKey)) continue;
    const targetKey = `${connection.target.componentId}:${connection.target.port}`;
    signals[targetKey] = signals[sourceKey] ?? "X";
    observedKeys.add(targetKey);
  }
  return { signals };
}
