import type { Signal } from "@circuit-platform/protocol";
import type { EditorSnapshot } from "./index.ts";
import type { SimulationSnapshot } from "../canvas/index.ts";
import { isProjectedDangling } from "./port-width.ts";
import { coerceInputValue, type InputValue } from "../workspace/index.ts";

export interface SimulationDisplayInputs {
  /** 兼容投影：按文档顺序的前两个 Input 元件；已求值的输入优先取自 `inputValues`。 */
  inputA: InputValue;
  inputB: InputValue;
  inputValues?: Readonly<Record<string, InputValue>>;
  /**
   * 工作区最近一次稳定求值后读取到的端口信号，键为 `${componentId}:${portId}`。
   * 每个 Output 元件从自己的接收端读取，不回退到其它 Output 的值。
   */
  signals?: Readonly<Record<string, Signal>>;
}

/**
 * 从通用 EditorSnapshot 生成画布仿真展示快照；输入按文档中的 Input Component 顺序绑定。
 *
 * 端口清单来自编辑器文档（也就是引擎回传的那一份），因此未求值的端口按它自己声明的位宽给出
 * 兜底值，长度不会与端口对不上。
 * @param snapshot 当前编辑器结构，不读取固定示例 ID。
 * @param values 工作区提供的输入、输出和最近一次稳定求值后的端口信号。
 * @returns 以 `${componentId}:${portId}` 为键的只读信号映射；未求值端口为全 X。
 */
export function createSimulationSnapshot(
  snapshot: EditorSnapshot,
  values: SimulationDisplayInputs,
): SimulationSnapshot {
  const inputs = snapshot.document.components.filter((component) => component.kind === "input");
  const signals: Record<string, Signal> = { ...values.signals };
  const observedKeys = new Set(Object.keys(values.signals ?? {}));
  const componentsById = new Map(snapshot.document.components.map((component) => [component.id, component]));

  for (const component of snapshot.document.components) {
    const inputIndex = inputs.indexOf(component);
    for (const port of component.ports ?? []) {
      const key = `${component.id}:${port.name}`;
      if (component.kind === "input" && port.direction === "output") {
        // Input 的取值是逐位文本；对齐到端口位宽后直接展示，因此宽 Input 既不会显示成长度
        // 对不上的值，也不会被压成单一的 0/1。
        signals[key] = coerceInputValue(
          values.inputValues?.[component.id] ?? (inputIndex === 0 ? values.inputA : inputIndex === 1 ? values.inputB : undefined),
          port.width,
        );
        observedKeys.add(key);
      } else if (component.kind === "output" && port.direction === "input") {
        // 文档中的每个 Output 各自读取自己的信号；未求值时保持未知。
        signals[key] ??= "X".repeat(port.width);
        observedKeys.add(key);
      } else {
        signals[key] ??= "X".repeat(port.width);
      }
    }
  }

  for (const connection of snapshot.document.connections) {
    // 悬空连接不参与仿真：端点缺失与两端位宽不再相同都是悬空。
    if (isProjectedDangling(connection, componentsById)) continue;
    const sourceKey = `${connection.source.componentId}:${connection.source.port}`;
    if (!observedKeys.has(sourceKey)) continue;
    const targetKey = `${connection.target.componentId}:${connection.target.port}`;
    signals[targetKey] = signals[sourceKey] ?? "X";
    observedKeys.add(targetKey);
  }
  return { signals };
}
