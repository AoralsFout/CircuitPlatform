import type { PortSpec } from "@circuit-platform/protocol";
import { parseProjectFile, type ProjectFileCircuit, type ProjectFileData, type ProjectFileError } from "./index.ts";

/** 导入后的完整候选文件；调用方在写入工作区前可据此完成引擎事务。 */
export type ImportProjectSnapshotResult =
  | { ok: true; file: ProjectFileData; definitionId: string; ports: readonly PortSpec[] }
  | { ok: false; errors: readonly ProjectFileError[] };

/** 兼容重导入的候选；原定义身份与本地名称不变，后代身份重新分配。 */
export type ReimportProjectSnapshotResult = ImportProjectSnapshotResult;

/** 导出的独立 v2 Project，或所选定义缺失与候选文件校验的诊断。 */
export type ExportDefinitionProjectResult =
  | { ok: true; file: ProjectFileData }
  | { ok: false; errors: readonly ProjectFileError[] };

/**
 * 把父工程中一个直接或嵌套定义提升为可编辑顶层 Circuit，仅复制它实际引用的定义闭包。
 * @param parent 已解析的父工程；不会被修改。
 * @param definitionId 父工程内的稳定定义身份。
 * @returns 独立且通过 v2 校验的 Project；所选定义缺失或候选无效时返回诊断。
 */
export function exportDefinitionProject(parent: ProjectFileData, definitionId: string): ExportDefinitionProjectResult {
  const selected = Object.hasOwn(parent.definitions, definitionId) ? parent.definitions[definitionId] : undefined;
  if (!selected) {
    return { ok: false, errors: [{ code: "definition-missing", message: `所选子电路定义「${definitionId}」已不存在，无法导出。` }] };
  }
  const definitions: Record<string, ProjectFileData["definitions"][string]> = Object.create(null);
  const visit = (circuit: ProjectFileCircuit): void => {
    for (const component of circuit.components) {
      if (component.kind !== "subcircuit" || !component.data || !("definitionId" in component.data)) continue;
      const id = component.data.definitionId;
      if (Object.hasOwn(definitions, id)) continue;
      const dependency = Object.hasOwn(parent.definitions, id) ? parent.definitions[id] : undefined;
      if (!dependency) continue; // v2 允许明确缺失的使用处；保留其原有端口缓存。
      definitions[id] = structuredClone(dependency);
      visit(dependency.circuit);
    }
  };
  visit(selected.circuit);
  const candidate: ProjectFileData = {
    version: 2,
    circuit: copyCircuit(selected.circuit),
    definitions,
    libraryRoots: [],
  };
  const validated = parseProjectFile(candidate);
  return validated.ok ? { ok: true, file: validated.value.file } : { ok: false, errors: validated.errors };
}

/** 从已保存定义的边界 Input/Output 取得再次放置所需的端口；不读取源文件。 */
export function portsForDefinition(circuit: ProjectFileCircuit): readonly PortSpec[] {
  const errors: ProjectFileError[] = [];
  return publishedPorts(circuit, errors);
}

/**
 * 将已校验源 Project 的顶层电路及实际可达定义复制进父工程。
 * 每次调用由 allocateId 分配全新身份；失败时父工程不发生任何修改。
 * @param parent 已校验的父工程快照。
 * @param source 已校验、从磁盘读取的源工程快照。
 * @param displayName 父工程中根定义的初始名称。
 * @param allocateId 根据目前已占用身份产生候选 ID；重复或空 ID 会得到稳定错误。
 * @returns 完整候选、根身份和发布 Port，或可展示的诊断。
 */
export function importProjectSnapshot(
  parent: ProjectFileData,
  source: ProjectFileData,
  displayName: string,
  allocateId: (usedIds: ReadonlySet<string>) => string,
): ImportProjectSnapshotResult {
  const errors: ProjectFileError[] = [];
  const ports = publishedPorts(source.circuit, errors);
  if (errors.length > 0) return { ok: false, errors };

  // 缺失定义的引用也是已占用身份；重用它会意外修复父工程中的旧使用处。
  const usedIds = new Set(Object.keys(parent.definitions));
  for (const circuit of [parent.circuit, ...Object.values(parent.definitions).map((definition) => definition.circuit)]) {
    for (const component of circuit.components) {
      if (component.kind === "subcircuit" && component.data !== undefined && "definitionId" in component.data) {
        usedIds.add(component.data.definitionId);
      }
    }
  }
  const identities = new Map<string, string>();
  const definitions = Object.assign(Object.create(null) as Record<string, { displayName: string; circuit: ProjectFileCircuit }>, structuredClone(parent.definitions));
  const allocate = (): string | null => {
    const id = allocateId(usedIds);
    if (typeof id !== "string" || id.length === 0 || usedIds.has(id)) {
      errors.push({ code: "definition-id-invalid", message: `新子电路定义 ID 为空或重复：${String(id)}。` });
      return null;
    }
    usedIds.add(id);
    return id;
  };
  const rootId = allocate();
  if (rootId === null) return { ok: false, errors };

  const remap = (oldId: string): string | null => {
    const existing = identities.get(oldId);
    if (existing !== undefined) return existing;
    const nextId = allocate();
    if (nextId === null) return null;
    identities.set(oldId, nextId);
    const sourceDefinition = Object.hasOwn(source.definitions, oldId) ? source.definitions[oldId] : undefined;
    if (sourceDefinition !== undefined) {
      const circuit = copyCircuit(sourceDefinition.circuit);
      definitions[nextId] = { displayName: sourceDefinition.displayName, circuit };
      for (const component of circuit.components) {
        if (component.kind !== "subcircuit" || component.data === undefined || !("definitionId" in component.data)) continue;
        const mapped = remap(component.data.definitionId);
        if (mapped === null) return null;
        component.data.definitionId = mapped;
      }
    }
    return nextId;
  };
  const rootCircuit = copyCircuit(source.circuit);
  definitions[rootId] = { displayName, circuit: rootCircuit };
  for (const component of rootCircuit.components) {
    if (component.kind !== "subcircuit" || component.data === undefined || !("definitionId" in component.data)) continue;
    const mapped = remap(component.data.definitionId);
    if (mapped === null) return { ok: false, errors };
    component.data.definitionId = mapped;
  }
  const candidate: ProjectFileData = {
    version: 2,
    circuit: structuredClone(parent.circuit),
    definitions: Object.fromEntries(Object.entries(definitions)),
    libraryRoots: [...parent.libraryRoots, rootId],
  };
  const validated = parseProjectFile(candidate);
  return validated.ok
    ? { ok: true, file: validated.value.file, definitionId: rootId, ports }
    : { ok: false, errors: validated.errors };
}

/**
 * 用已保存的源工程替换指定定义及其可达下层闭包，保留指定定义的身份和父工程名称。
 * 只接受发布 Port 名称、方向、位宽兼容的更新；调用方提交前可安全保留现有连接。
 * @param parent 已采用的父工程快照。
 * @param source 从文件读取并校验过的 v2 源工程。
 * @param definitionId 可为直接导入或嵌套定义的现有身份。
 * @param allocateId 为新后代生成未占用身份的分配器。
 * @returns 完整候选和原定义身份，或不改变父工程的诊断。
 */
export function reimportProjectSnapshot(
  parent: ProjectFileData,
  source: ProjectFileData,
  definitionId: string,
  allocateId: (usedIds: ReadonlySet<string>) => string,
): ReimportProjectSnapshotResult {
  const previous = Object.hasOwn(parent.definitions, definitionId) ? parent.definitions[definitionId] : undefined;
  if (previous === undefined) return { ok: false, errors: [{ code: "definition-missing", message: `子电路定义「${definitionId}」已不存在。` }] };
  const oldPorts = portsForDefinition(previous.circuit);
  const newPorts = portsForDefinition(source.circuit);
  const samePorts = oldPorts.length === newPorts.length && oldPorts.every((port) =>
    newPorts.some((candidate) => candidate.name === port.name && candidate.direction === port.direction && candidate.width === port.width));
  if (!samePorts) return { ok: false, errors: [{ code: "interface-incompatible", message: "新子电路的 Port 名称、方向或位宽与现有定义不兼容。" }] };

  const imported = importProjectSnapshot(parent, source, previous.displayName, allocateId);
  if (!imported.ok) return imported;
  const definitions = Object.assign(Object.create(null) as Record<string, ProjectFileData["definitions"][string]>, imported.file.definitions);
  const freshRoot = definitions[imported.definitionId]!;
  delete definitions[imported.definitionId];
  definitions[definitionId] = { ...freshRoot, displayName: previous.displayName };
  const updateUses = (circuit: ProjectFileCircuit): ProjectFileCircuit => ({
    ...circuit,
    components: circuit.components.map((component) => component.kind === "subcircuit" && component.data &&
      "definitionId" in component.data && component.data.definitionId === definitionId
      ? { ...component, data: { ...component.data, cachedPorts: newPorts.map((port) => ({ ...port })) } }
      : component),
  });
  for (const [id, definition] of Object.entries(definitions)) {
    definitions[id] = { ...definition, circuit: updateUses(definition.circuit) };
  }

  // 旧后代只有失去所有顶层使用和直接导入根的可达路径后才移除；共享的其他闭包不受影响。
  const oldDescendants = new Set<string>();
  const visitOld = (id: string): void => {
    const definition = Object.hasOwn(parent.definitions, id) ? parent.definitions[id] : undefined;
    if (!definition) return;
    for (const component of definition.circuit.components) {
      if (component.kind !== "subcircuit" || !component.data || !("definitionId" in component.data)) continue;
      const child = component.data.definitionId;
      if (child === definitionId || oldDescendants.has(child)) continue;
      oldDescendants.add(child);
      visitOld(child);
    }
  };
  visitOld(definitionId);
  const reachable = new Set<string>();
  const visitNew = (id: string): void => {
    if (reachable.has(id)) return;
    reachable.add(id);
    const definition = Object.hasOwn(definitions, id) ? definitions[id] : undefined;
    if (!definition) return;
    for (const component of definition.circuit.components) {
      if (component.kind === "subcircuit" && component.data && "definitionId" in component.data) visitNew(component.data.definitionId);
    }
  };
  for (const component of parent.circuit.components) {
    if (component.kind === "subcircuit" && component.data && "definitionId" in component.data) visitNew(component.data.definitionId);
  }
  for (const id of parent.libraryRoots) visitNew(id);
  for (const id of oldDescendants) if (!reachable.has(id)) delete definitions[id];

  const candidate = parseProjectFile({
    version: 2,
    circuit: updateUses(structuredClone(parent.circuit)),
    definitions,
    libraryRoots: [...parent.libraryRoots],
  });
  return candidate.ok
    ? { ok: true, file: candidate.value.file, definitionId, ports: newPorts }
    : { ok: false, errors: candidate.errors };
}

/**
 * 找出选中定义在顶层画布中的每条使用路径；扁平身份以这些路径为前缀。
 * @param parent 更新前的父工程快照。
 * @param definitionId 要替换的定义身份。
 * @returns 每个受影响使用处的稳定 Component ID 路径，包括嵌套使用处。
 */
export function affectedOccurrencePaths(parent: ProjectFileData, definitionId: string): readonly string[] {
  const paths: string[] = [];
  const visit = (circuit: ProjectFileCircuit, prefix: readonly string[]): void => {
    for (const component of circuit.components) {
      if (component.kind !== "subcircuit" || !component.data || !("definitionId" in component.data)) continue;
      const path = [...prefix, component.id];
      if (component.data.definitionId === definitionId) {
        paths.push(path.join("/"));
      } else {
        const child = Object.hasOwn(parent.definitions, component.data.definitionId)
          ? parent.definitions[component.data.definitionId] : undefined;
        if (child) visit(child.circuit, path);
      }
    }
  };
  visit(parent.circuit, []);
  return paths;
}

/** 源文件只读数据的深拷贝；重映射只作用于新副本。 */
function copyCircuit(circuit: ProjectFileCircuit): { components: Array<ProjectFileCircuit["components"][number]>; connections: Array<ProjectFileCircuit["connections"][number]> } {
  return structuredClone(circuit) as ReturnType<typeof copyCircuit>;
}

/** 从 Input / Output 元件发布边界 Port，沿用现有标签、Clock 和位宽约束。 */
function publishedPorts(circuit: ProjectFileCircuit, errors: ProjectFileError[]): readonly PortSpec[] {
  if (circuit.components.some((component) => component.kind === "clock")) {
    errors.push({ code: "interface-clock-unsupported", message: "包含 Clock 的 Project 不能作为 Subcircuit。" });
  }
  const named = new Set<string>();
  const ports: Array<PortSpec & { y: number; id: string }> = [];
  for (const component of circuit.components) {
    if (component.kind !== "input" && component.kind !== "output") continue;
    if (component.displayName.length === 0 || named.has(component.displayName)) {
      errors.push({ code: "interface-label-invalid", message: `Subcircuit Port 标签为空或重复：${component.displayName}。` });
      continue;
    }
    named.add(component.displayName);
    const direction = component.kind === "input" ? "output" : "input";
    const port = component.ports?.find((item) => item.direction === direction);
    if (port === undefined) {
      errors.push({ code: "interface-missing-port-list", message: `Subcircuit Port「${component.displayName}」缺少端口清单。` });
      continue;
    }
    ports.push({ name: component.displayName, direction: component.kind === "input" ? "input" : "output", width: port.width, y: component.position.y, id: component.id });
  }
  ports.sort((a, b) => a.y - b.y || a.id.localeCompare(b.id));
  return ports.map(({ name, direction, width }) => ({ name, direction, width }));
}
