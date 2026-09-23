import type { ProjectFileCircuit, ProjectFileData } from "./index.ts";

/** 子电路树节点；同一定义可在不同依赖路径中出现。 */
export interface LibraryNode {
  definitionId: string;
  displayName: string;
  editableName: string;
  usageCount: number;
  status: "ready" | "missing";
  diagnostic?: string;
  children: readonly LibraryNode[];
}

/** 按定义插入顺序为同名定义编号，保留文件中的原始显示名称。 */
export function definitionDisplayNames(definitions: ProjectFileData["definitions"]): Readonly<Record<string, string>> {
  const seen = new Map<string, number>();
  return Object.fromEntries(Object.entries(definitions).map(([id, definition]) => {
    const count = (seen.get(definition.displayName) ?? 0) + 1;
    seen.set(definition.displayName, count);
    return [id, count === 1 ? definition.displayName : `${definition.displayName} (${count})`];
  }));
}

/** 只为画布标题省略文件后缀；编号仍保留，持久化名称不变。 */
export function canvasSubcircuitName(name: string): string {
  return name.replace(/\.circuit\.json(?= \(\d+\)$|$)/, "");
}

/** 让所有使用处的显示名称跟随定义名称及同名编号。 */
export function labelDefinitionUses(file: ProjectFileData): ProjectFileData {
  const labels = definitionDisplayNames(file.definitions);
  const labelCircuit = (circuit: ProjectFileCircuit): ProjectFileCircuit => ({
    ...circuit,
    components: circuit.components.map((component) => {
      if (component.kind !== "subcircuit" || !component.data || !("definitionId" in component.data)) return component;
      const label = labels[component.data.definitionId];
      return label === undefined ? component : { ...component, displayName: label };
    }),
  });
  return {
    ...file,
    circuit: labelCircuit(file.circuit),
    definitions: Object.fromEntries(Object.entries(file.definitions).map(([id, definition]) => [id, { ...definition, circuit: labelCircuit(definition.circuit) }])),
  };
}

/** 从直接导入的根开始构建定义树；使用数统计顶层及定义内的静态引用。 */
export function buildLibraryTree(file: ProjectFileData): readonly LibraryNode[] {
  const labels = definitionDisplayNames(file.definitions);
  const uses = new Map<string, number>();
  for (const circuit of [file.circuit, ...Object.values(file.definitions).map((definition) => definition.circuit)]) {
    for (const component of circuit.components) {
      if (component.kind !== "subcircuit" || !component.data || !("definitionId" in component.data)) continue;
      uses.set(component.data.definitionId, (uses.get(component.data.definitionId) ?? 0) + 1);
    }
  }
  const node = (id: string, ancestors: ReadonlySet<string>): LibraryNode => {
    const definition = file.definitions[id];
    const status = definition === undefined ? "missing" : "ready";
    const next = new Set(ancestors).add(id);
    return {
      definitionId: id,
      displayName: labels[id] ?? id,
      editableName: definition?.displayName ?? id,
      usageCount: uses.get(id) ?? 0,
      status,
      ...(status === "missing" ? { diagnostic: "定义已删除" } : {}),
      children: definition === undefined || ancestors.has(id) ? [] : definition.circuit.components.flatMap((component) =>
        component.kind === "subcircuit" && component.data && "definitionId" in component.data
          ? [node(component.data.definitionId, next)] : []),
    };
  };
  return file.libraryRoots.map((id) => node(id, new Set()));
}
