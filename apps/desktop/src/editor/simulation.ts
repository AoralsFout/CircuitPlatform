import type { Signal } from "@circuit-platform/protocol";
import type { EditorSnapshot } from "./index.ts";
import type { ComponentDefinitionRegistry, SimulationSnapshot } from "../canvas/index.ts";

export interface SimulationDisplayInputs {
  inputA: 0 | 1;
  inputB: 0 | 1;
  output: Signal;
  inputValues?: Readonly<Record<string, 0 | 1>>;
  /** 工作区最近一次稳定求值后读取到的端口信号。 */
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
        signals[key] = values.inputValues?.[component.id] ?? (inputIndex === 0 ? values.inputA : inputIndex === 1 ? values.inputB : 0);
        observedKeys.add(key);
      } else if (component.kind === "output" && port.direction === "input") {
        signals[key] = values.output;
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
