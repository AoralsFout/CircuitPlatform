import type { PortSpec } from "@circuit-platform/protocol";
import { parseProjectFile, type ProjectFileCircuit, type ProjectFileComponent, type ProjectFileData, type ProjectFileError } from "./index.ts";

/** 导入后的完整候选文件；调用方在写入工作区前可据此完成引擎事务。 */
export type ImportProjectSnapshotResult =
  | { ok: true; file: ProjectFileData; definitionId: string; ports: readonly PortSpec[] }
  | { ok: false; errors: readonly ProjectFileError[] };

/** 重新导入会新增的悬空端点；只列出此前有效、更新后失效的连接。 */
export interface ReimportPortImpact {
  ownerDefinitionId: string | null;
  componentId: string;
  connectionId: string;
  portName: string;
  oldPort: PortSpec;
  newPort: PortSpec | null;
}

/** 重导入候选及可编辑顶层的断线预告；只读上层断线作为错误返回。 */
export type ReimportProjectSnapshotResult =
  | { ok: true; file: ProjectFileData; definitionId: string; ports: readonly PortSpec[]; topLevelImpacts: readonly ReimportPortImpact[] }
  | { ok: false; errors: readonly ProjectFileError[] };

/** 单个缺失使用处修复的完整候选；顶层断线需由调用方确认。 */
export type RepairMissingUseResult =
  | { ok: true; file: ProjectFileData; topLevelImpacts: readonly ReimportPortImpact[] }
  | { ok: false; errors: readonly ProjectFileError[] };

/**
 * 列出仍指向缺失定义的顶层与内嵌使用处，供修复入口定位；不修改文件。
 * @param file 已解析的父 Project。
 * @returns 带所属定义、元件身份和可读位置的使用处；没有缺失引用时为空。
 */
export function missingDefinitionUses(file: ProjectFileData): readonly (DefinitionUse & { missingDefinitionId: string })[] {
  const uses: Array<DefinitionUse & { missingDefinitionId: string }> = [];
  const scan = (circuit: ProjectFileCircuit, ownerDefinitionId: string | null, ownerName: string): void => {
    for (const component of circuit.components) {
      if (component.kind !== "subcircuit" || !component.data || !("definitionId" in component.data)) continue;
      if (Object.hasOwn(file.definitions, component.data.definitionId)) continue;
      uses.push({ ownerDefinitionId, componentId: component.id, missingDefinitionId: component.data.definitionId,
        location: `${ownerName} / ${component.displayName}（${component.id}）` });
    }
  };
  scan(file.circuit, null, "顶层电路");
  for (const [id, definition] of Object.entries(file.definitions)) scan(definition.circuit, id, definition.displayName);
  return uses;
}

/**
 * 只重关联一个缺失使用处，不修改输入文件；先验证端口影响与定义环。
 * @param file 当前父 Project。
 * @param ownerDefinitionId 所属定义身份；null 表示顶层电路。
 * @param componentId 待修复的使用处元件身份。
 * @param targetDefinitionId 已存在且将被关联的定义身份。
 * @returns 完整候选及顶层新悬空端点预告，或使用处变化、目标缺失、环、只读上层断线等诊断。
 */
export function repairMissingDefinitionUse(
  file: ProjectFileData,
  ownerDefinitionId: string | null,
  componentId: string,
  targetDefinitionId: string,
): RepairMissingUseResult {
  const owner = ownerDefinitionId === null ? null : Object.hasOwn(file.definitions, ownerDefinitionId) ? file.definitions[ownerDefinitionId] : undefined;
  const target = Object.hasOwn(file.definitions, targetDefinitionId) ? file.definitions[targetDefinitionId] : undefined;
  const circuit = ownerDefinitionId === null ? file.circuit : owner?.circuit;
  const component = circuit?.components.find((item) => item.id === componentId);
  if (!circuit || component?.kind !== "subcircuit" || !component.data || !("definitionId" in component.data) ||
      Object.hasOwn(file.definitions, component.data.definitionId)) {
    return { ok: false, errors: [{ code: "missing-use-not-found", message: "所选缺失定义使用处已变化，请重新选择。" }] };
  }
  if (!target) return { ok: false, errors: [{ code: "definition-missing", message: `目标定义「${targetDefinitionId}」已不存在。` }] };
  const ports = portsForDefinition(target.circuit);
  const impacts = portImpactsForUse(circuit, ownerDefinitionId, component, component.data.cachedPorts, ports);
  const cachedPorts = replacementCachedPorts(circuit, component.id, component.data.cachedPorts, ports);
  const { portOrder: previousOrder, ...baseData } = component.data;
  const order = compatiblePortOrder(previousOrder, cachedPorts, ports);
  const updated: ProjectFileComponent = { ...component, data: { ...baseData, definitionId: targetDefinitionId,
    cachedPorts, ...(order ? { portOrder: order } : {}) } };
  const revisedCircuit = { ...circuit, components: circuit.components.map((item) => item.id === componentId ? updated : item) };
  const candidate: ProjectFileData = ownerDefinitionId === null
    ? { ...file, circuit: revisedCircuit }
    : { ...file, definitions: { ...file.definitions, [ownerDefinitionId]: { ...owner!, circuit: revisedCircuit } } };
  const parsed = parseProjectFile(candidate);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  if (ownerDefinitionId !== null && impacts.length > 0) {
    const first = impacts[0]!;
    return { ok: false, errors: [{ code: "readonly-ancestor-dangling",
      message: `修复会使只读定义「${owner?.displayName ?? ownerDefinitionId}」的连接「${first.connectionId}」在 Port「${first.portName}」处悬空；请重新导入该上层定义。` }] };
  }
  return { ok: true, file: parsed.value.file, topLevelImpacts: impacts };
}

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

/**
 * 从定义内的 Input/Output 边界发布端口，供再次放置与只读检查使用；不读取源文件。
 * @param circuit 已保存的定义电路。
 * @returns 按边界位置排序的端口清单；非法或重复边界由候选校验另行诊断。
 */
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
 * 只读上层若新增悬空连接则拒绝；可编辑顶层的影响返回给调用方预告并确认。
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

  const imported = importProjectSnapshot(parent, source, previous.displayName, allocateId);
  if (!imported.ok) return imported;
  const impacts = reimportPortImpacts(parent, definitionId, oldPorts, newPorts);
  const readonlyImpacts = impacts.filter((impact) => impact.ownerDefinitionId !== null);
  if (readonlyImpacts.length > 0) {
    const first = readonlyImpacts[0]!;
    const owner = parent.definitions[first.ownerDefinitionId!]?.displayName ?? first.ownerDefinitionId;
    return { ok: false, errors: [{
      code: "readonly-ancestor-dangling",
      message: `重新导入会使只读上层定义「${owner}」的连接「${first.connectionId}」在 Port「${first.portName}」处悬空；请重新导入该上层定义。`,
    }] };
  }
  const definitions = Object.assign(Object.create(null) as Record<string, ProjectFileData["definitions"][string]>, imported.file.definitions);
  const freshRoot = definitions[imported.definitionId]!;
  delete definitions[imported.definitionId];
  definitions[definitionId] = { ...freshRoot, displayName: previous.displayName };
  const updateUses = (circuit: ProjectFileCircuit): ProjectFileCircuit => ({
    ...circuit,
    components: circuit.components.map((component) => {
      if (component.kind !== "subcircuit" || !component.data || !("definitionId" in component.data) || component.data.definitionId !== definitionId) return component;
      const cachedPorts = component.data.cachedPorts;
      const updatedPorts = replacementCachedPorts(circuit, component.id, cachedPorts, newPorts);
      const { portOrder: previousOrder, ...baseData } = component.data;
      const order = compatiblePortOrder(previousOrder, updatedPorts, newPorts);
      return { ...component, data: { ...baseData, cachedPorts: updatedPorts,
        ...(order ? { portOrder: order } : {}) } };
    }),
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
    ? { ok: true, file: candidate.value.file, definitionId, ports: newPorts, topLevelImpacts: impacts.filter((impact) => impact.ownerDefinitionId === null) }
    : { ok: false, errors: candidate.errors };
}

/** 逐个已有连接端点比较完整 Port 规格；源文件新增 Port 不会使旧连接悬空。 */
function reimportPortImpacts(
  parent: ProjectFileData,
  definitionId: string,
  oldPorts: readonly PortSpec[],
  newPorts: readonly PortSpec[],
): readonly ReimportPortImpact[] {
  const impacts: ReimportPortImpact[] = [];
  const inspect = (circuit: ProjectFileCircuit, ownerDefinitionId: string | null): void => {
    for (const component of circuit.components) {
      if (component.kind !== "subcircuit" || !component.data || !("definitionId" in component.data) || component.data.definitionId !== definitionId) continue;
      impacts.push(...portImpactsForUse(circuit, ownerDefinitionId, component, oldPorts, newPorts));
    }
  };
  inspect(parent.circuit, null);
  for (const [id, definition] of Object.entries(parent.definitions)) inspect(definition.circuit, id);
  return impacts;
}

/** 单个使用处的端点变化；缓存规格用于排除本次操作前已悬空的连接。 */
function portImpactsForUse(
  circuit: ProjectFileCircuit,
  ownerDefinitionId: string | null,
  component: ProjectFileComponent,
  oldPorts: readonly PortSpec[],
  newPorts: readonly PortSpec[],
): readonly ReimportPortImpact[] {
  if (component.kind !== "subcircuit" || !component.data || !("cachedPorts" in component.data)) return [];
  const impacts: ReimportPortImpact[] = [];
  for (const connection of circuit.connections) {
    for (const [endpoint, direction] of [[connection.source, "output"], [connection.target, "input"]] as const) {
      if (endpoint.component !== component.id) continue;
      const oldPort = oldPorts.find((port) => port.name === endpoint.port && port.direction === direction);
      if (!oldPort || !component.data.cachedPorts.some((port) => port.name === oldPort.name && port.direction === oldPort.direction && port.width === oldPort.width)) continue;
      const newPort = newPorts.find((port) => port.name === endpoint.port) ?? null;
      if (newPort?.direction === oldPort.direction && newPort.width === oldPort.width) continue;
      impacts.push({ ownerDefinitionId, componentId: component.id, connectionId: connection.id,
        portName: endpoint.port, oldPort, newPort });
    }
  }
  return impacts;
}

/** 已连接且失配的旧签名留作悬空端点依据；无连线 Port 与兼容 Port 更新到新签名。 */
function replacementCachedPorts(
  circuit: ProjectFileCircuit,
  componentId: string,
  cachedPorts: readonly PortSpec[],
  newPorts: readonly PortSpec[],
): PortSpec[] {
  const connectedPortNames = new Set(circuit.connections.flatMap((connection) => [
    ...(connection.source.component === componentId ? [connection.source.port] : []),
    ...(connection.target.component === componentId ? [connection.target.port] : []),
  ]));
  return [
    ...cachedPorts.flatMap((port) => {
      const replacement = newPorts.find((candidate) => candidate.name === port.name);
      if (!connectedPortNames.has(port.name)) return replacement ? [{ ...replacement }] : [];
      return [replacement?.direction === port.direction && replacement.width === port.width ? { ...replacement } : { ...port }];
    }),
    ...newPorts.filter((port) => !cachedPorts.some((old) => old.name === port.name)).map((port) => ({ ...port })),
  ];
}

/**
 * 判断旧显式顺序能否继续用于新接口，避免把悬空的缓存端口误认成有效接口。
 * @param previous 旧使用处保存的端口顺序，可省略。
 * @param cached 更新后的使用处缓存端口。
 * @param actual 新定义真实发布的端口。
 * @returns 可保留的顺序副本；无顺序或缓存与真实接口不兼容时返回 undefined。
 */
export function compatiblePortOrder(previous: readonly string[] | undefined, cached: readonly PortSpec[], actual: readonly PortSpec[]): string[] | undefined {
  if (!previous || cached.length !== actual.length || cached.some((port) => !actual.some((item) =>
    item.name === port.name && item.direction === port.direction && item.width === port.width))) return undefined;
  const names = new Set(actual.map((port) => port.name));
  const retained = previous.filter((name) => names.has(name));
  return [...retained, ...actual.map((port) => port.name).filter((name) => !retained.includes(name))];
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
