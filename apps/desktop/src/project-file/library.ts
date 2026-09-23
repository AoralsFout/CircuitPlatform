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

/**
 * 按定义插入顺序给同名定义添加显示编号，不改写持久化名称。
 * @param definitions 父 Project 的定义表。
 * @returns 以定义身份索引的显示名；空定义表返回空映射。
 */
export function definitionDisplayNames(definitions: ProjectFileData["definitions"]): Readonly<Record<string, string>> {
  const seen = new Map<string, number>();
  return Object.fromEntries(Object.entries(definitions).map(([id, definition]) => {
    const count = (seen.get(definition.displayName) ?? 0) + 1;
    seen.set(definition.displayName, count);
    return [id, count === 1 ? definition.displayName : `${definition.displayName} (${count})`];
  }));
}

/**
 * 为画布标题省略 `.circuit.json` 后缀，保留同名编号。
 * @param name 已编号或原始的显示名。
 * @returns 画布用名称；不修改持久化定义。
 */
export function canvasSubcircuitName(name: string): string {
  return name.replace(/\.circuit\.json(?= \(\d+\)$|$)/, "");
}

/**
 * 让顶层及内嵌使用处采用定义的当前显示名与同名编号。
 * @param file 已解析的父 Project。
 * @returns 带更新显示名的新文件；缺失定义的使用处保留原名，输入不被修改。
 */
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

/**
 * 从直接导入的根构建导航树，并统计顶层及定义内的静态使用数。
 * @param file 已解析的父 Project。
 * @returns 按根顺序排列的节点；缺失或循环引用显示状态但不继续递归。
 */
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
