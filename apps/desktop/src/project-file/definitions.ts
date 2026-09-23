import type { PortSpec } from "@circuit-platform/protocol";
import { parseProjectFile, type ProjectFileCircuit, type ProjectFileData, type ProjectFileError } from "./index.ts";

/** 导入后的完整候选文件；调用方在写入工作区前可据此完成引擎事务。 */
export type ImportProjectSnapshotResult =
  | { ok: true; file: ProjectFileData; definitionId: string; ports: readonly PortSpec[] }
  | { ok: false; errors: readonly ProjectFileError[] };

/** 删除前展示的具体使用位置；ownerDefinitionId 为空表示顶层 Circuit。 */
export interface DefinitionUse {
  ownerDefinitionId: string | null;
  componentId: string;
  location: string;
}

export type DeleteDefinitionPlan =
  | { ok: true; file: ProjectFileData; uses: readonly DefinitionUse[]; removedDefinitionIds: readonly string[] }
  | { ok: false; errors: readonly ProjectFileError[] };

/**
 * 构造删除定义的完整候选快照。目标定义即使仍被引用也会移除；其下层仅在没有其他
 * 根、顶层使用处或剩余定义引用时一并清理。调用方根据 uses 决定是否二次确认。
 * @param file 当前父工程的已校验快照。
 * @param definitionId 要删除的工程内定义身份。
 * @returns 可提交的候选、受影响使用位置与实际移除的身份，或稳定诊断。
 */
export function planDeleteDefinition(file: ProjectFileData, definitionId: string): DeleteDefinitionPlan {
  if (!Object.hasOwn(file.definitions, definitionId)) {
    return { ok: false, errors: [{ code: "definition-missing", message: `子电路定义「${definitionId}」已不存在。` }] };
  }
  const uses: DefinitionUse[] = [];
  const scan = (circuit: ProjectFileCircuit, ownerDefinitionId: string | null, ownerName: string): void => {
    for (const component of circuit.components) {
      if (component.kind !== "subcircuit" || !component.data || !("definitionId" in component.data)) continue;
      if (component.data.definitionId === definitionId) {
        uses.push({ ownerDefinitionId, componentId: component.id, location: `${ownerName} / ${component.displayName}（${component.id}）` });
      }
    }
  };
  scan(file.circuit, null, "顶层电路");
  for (const [id, definition] of Object.entries(file.definitions)) scan(definition.circuit, id, definition.displayName);

  const descendants = new Set<string>();
  const collect = (id: string): void => {
    if (descendants.has(id) || !Object.hasOwn(file.definitions, id)) return;
    descendants.add(id);
    for (const component of file.definitions[id]!.circuit.components) {
      if (component.kind === "subcircuit" && component.data && "definitionId" in component.data) collect(component.data.definitionId);
    }
  };
  collect(definitionId);
  const retained = new Set<string>();
  const retain = (id: string): void => {
    if (id === definitionId || retained.has(id) || !descendants.has(id)) return;
    retained.add(id);
    for (const component of file.definitions[id]!.circuit.components) {
      if (component.kind === "subcircuit" && component.data && "definitionId" in component.data) retain(component.data.definitionId);
    }
  };
  for (const id of file.libraryRoots) if (id !== definitionId) retain(id);
  for (const circuit of [file.circuit, ...Object.entries(file.definitions).filter(([id]) => !descendants.has(id)).map(([, definition]) => definition.circuit)]) {
    for (const component of circuit.components) {
      if (component.kind === "subcircuit" && component.data && "definitionId" in component.data) retain(component.data.definitionId);
    }
  }
  const removedDefinitionIds = [...descendants].filter((id) => !retained.has(id));
  const removed = new Set(removedDefinitionIds);
  const candidate: ProjectFileData = {
    ...file,
    definitions: Object.fromEntries(Object.entries(file.definitions).filter(([id]) => !removed.has(id))),
    libraryRoots: file.libraryRoots.filter((id) => !removed.has(id)),
  };
  const parsed = parseProjectFile(candidate);
  return parsed.ok
    ? { ok: true, file: parsed.value.file, uses, removedDefinitionIds }
    : { ok: false, errors: parsed.errors };
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
