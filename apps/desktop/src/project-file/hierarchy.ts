import type { ComponentKindName, PortSpec } from "@circuit-platform/protocol";
import type { SubcircuitComponentData, SubcircuitDiagnostic } from "../editor/component.ts";
import type { EditorComponent, EditorConnection, EditorDocument, InternalComponentDescriptor, Point } from "../editor/index.ts";
import type { ProjectFileComponent, ProjectFileData } from "./index.ts";
import { projectPathIdentity, type PathPlatform } from "./paths.ts";

/** 旧层次调用方保留的读取器类型；v2 展平只读取 root.definitions，不会调用它。 */
export interface HierarchyProjectReader {
  /**
   * 读取某个使用处采用的子 Project。
   * @param identity 已按目标平台规范化的 Project 身份。
   * @param occurrencePath 从根文档到该使用处的稳定 Editor Component ID 路径；同一文件的不同路径必须可返回不同快照。
   * @returns 已校验的项目数据，或包含稳定机器类别和中文原因的读取失败。
   */
  read(identity: string, occurrencePath?: readonly string[]): Promise<
    | { ok: true; value: ProjectFileData }
    | { ok: false; code: string; message: string }
  >;
}

/** 展平后可直接交给 Workspace 的纯协议 Circuit 投影。 */
export interface FlattenedCircuit {
  components: readonly { id: string; kind: ComponentKindName; ports?: readonly PortSpec[] }[];
  connections: readonly {
    id: string;
    source: { componentId: string; port: string };
    target: { componentId: string; port: string };
  }[];
}

/** 一个顶层 Editor Component 所拥有的扁平 Component 与 Connection 身份。 */
export interface HierarchySourceMap {
  components: Readonly<Record<string, readonly string[]>>;
  connections: Readonly<Record<string, readonly string[]>>;
  ownedConnections: Readonly<Record<string, readonly string[]>>;
  ports: Readonly<Record<string, Readonly<Record<string, {
    inputTargets?: readonly { componentId: string; port: string }[];
    outputSources?: readonly { componentId: string; port: string }[];
  }>>>>;
  /** 每个顶层 Subcircuit 使用处拥有的稳定内部 Component 描述。 */
  internalComponents: Readonly<Record<string, readonly InternalComponentDescriptor[]>>;
}

/** 一次稳定层次解析失败的类别与中文文案。 */
export interface HierarchyDiagnostic extends SubcircuitDiagnostic {
  path: string;
  componentId?: string;
}

/** 解析与展平模块的输入；root 必须已经通过 `parseProjectFile`。 */
export interface FlattenProjectInput {
  rootIdentity: string;
  root: ProjectFileData;
  /** 兼容旧调用方；v2 忽略此项并只读取 root.definitions。 */
  reader?: HierarchyProjectReader;
  platform?: PathPlatform;
}

/** 层次解析与展平的完整结果；不会包含任何引擎数字 ID。 */
export interface FlattenProjectResult {
  /** 顶层可见文档，Subcircuit 保持为一个 Editor Component。 */
  document: EditorDocument;
  /** 仅含协议 ComponentKindName 的扁平 Circuit。 */
  circuit: FlattenedCircuit;
  /** 顶层 Component/Connection/Port 到扁平对象的来源映射。 */
  sources: HierarchySourceMap;
  diagnostics: readonly HierarchyDiagnostic[];
}

interface FlatEndpoint {
  componentId: string;
  port: string;
}

type SourceExpression =
  | { kind: "flat"; endpoint: FlatEndpoint }
  | { kind: "input"; port: string };

interface ProjectInterface {
  ports: readonly PortSpec[];
  inputNames: ReadonlySet<string>;
  outputNames: ReadonlySet<string>;
  componentByPort: ReadonlyMap<string, string>;
}

interface OccurrenceProjection {
  inputs: Map<string, readonly FlatEndpoint[]>;
  outputs: Map<string, readonly SourceExpression[]>;
  inputAliases: Map<string, readonly SourceExpression[]>;
  components: string[];
  connections: string[];
}

interface MutableOutput {
  components: Array<{ id: string; kind: ComponentKindName; ports?: readonly PortSpec[] }>;
  connections: Array<FlattenedCircuit["connections"][number]>;
  componentSources: Record<string, string[]>;
  connectionSources: Record<string, string[]>;
  ownedConnections: Record<string, string[]>;
  portSources: Record<string, Record<string, { inputTargets?: FlatEndpoint[]; outputSources?: FlatEndpoint[] }>>;
  internalComponents: Record<string, InternalComponentDescriptor[]>;
  visibleSubcircuits: Record<string, SubcircuitComponentData>;
  visiblePorts: Record<string, readonly PortSpec[]>;
  diagnostics: HierarchyDiagnostic[];
}

function createMutableOutput(): MutableOutput {
  return {
    components: [],
    connections: [],
    componentSources: {},
    connectionSources: {},
    ownedConnections: {},
    portSources: {},
    internalComponents: {},
    visibleSubcircuits: {},
    visiblePorts: {},
    diagnostics: [],
  };
}

function mergeOutput(target: MutableOutput, source: MutableOutput): void {
  target.components.push(...source.components);
  target.connections.push(...source.connections);
  for (const [key, values] of Object.entries(source.componentSources)) for (const value of values) addSource(target.componentSources, key, value);
  for (const [key, values] of Object.entries(source.connectionSources)) for (const value of values) addSource(target.connectionSources, key, value);
  for (const [key, values] of Object.entries(source.ownedConnections)) for (const value of values) addSource(target.ownedConnections, key, value);
  for (const [componentId, ports] of Object.entries(source.portSources)) {
    const targetPorts = target.portSources[componentId] ??= {};
    for (const [port, sourceValue] of Object.entries(ports)) targetPorts[port] = sourceValue;
  }
  for (const [ownerId, descriptors] of Object.entries(source.internalComponents)) {
    const targetDescriptors = target.internalComponents[ownerId] ??= [];
    for (const descriptor of descriptors) {
      if (!targetDescriptors.some((candidate) => candidate.flatId === descriptor.flatId)) {
        targetDescriptors.push({ ...descriptor, path: [...descriptor.path], ports: clonePorts(descriptor.ports) });
      }
    }
  }
  Object.assign(target.visibleSubcircuits, source.visibleSubcircuits);
  Object.assign(target.visiblePorts, source.visiblePorts);
  target.diagnostics.push(...source.diagnostics);
}

/**
 * 递归解析并展平一份 Project，所有子定义来自同一内存快照。
 * @param input 顶层 Project 身份和已校验文件数据。
 * @returns 顶层 Editor 文档、只含引擎类型的扁平 Circuit、来源映射与诊断；不分配引擎 ID。
 */
export async function flattenProjectHierarchy(input: FlattenProjectInput): Promise<FlattenProjectResult> {
  const platform = input.platform;
  const rootIdentity = projectPathIdentity(input.rootIdentity, platform);
  const output: MutableOutput = {
    components: [],
    connections: [],
    componentSources: {},
    connectionSources: {},
    ownedConnections: {},
    portSources: {},
    internalComponents: {},
    visibleSubcircuits: {},
    visiblePorts: {},
    diagnostics: [],
  };
  const embeddedReader: HierarchyProjectReader = {
    async read(definitionId) {
      const definition = Object.hasOwn(input.root.definitions, definitionId) ? input.root.definitions[definitionId] : undefined;
      return definition === undefined
        ? { ok: false, code: "definition-missing", message: `父 Project 中缺少子电路定义「${definitionId}」。` }
        : { ok: true, value: { ...input.root, circuit: definition.circuit } };
    },
  };
  await flattenOccurrence(input.root, rootIdentity, [], [], false, [], output, embeddedReader, platform);
  const rootDocument = documentForProject(input.root, output);

  return {
    document: rootDocument,
    circuit: { components: output.components, connections: output.connections },
    sources: {
      components: output.componentSources,
      connections: output.connectionSources,
      ownedConnections: output.ownedConnections,
      ports: output.portSources,
      internalComponents: output.internalComponents,
    },
    diagnostics: output.diagnostics,
  };
}

function documentForProject(project: ProjectFileData, output: MutableOutput): EditorDocument {
  const components = project.circuit.components.map((entry) => {
    const component = editorComponentFor(entry);
    const resolved = output.visibleSubcircuits[entry.id];
    if (resolved !== undefined) {
      return { ...component, ports: clonePorts(output.visiblePorts[entry.id] ?? resolved.cachedPorts), data: { subcircuit: resolved } };
    }
    if (entry.kind === "subcircuit") {
      const data = subcircuitDataOf(entry);
      if (data !== undefined) return { ...component, ports: clonePorts(data.cachedPorts), data: { subcircuit: { ...data, status: "unresolved" as const } } };
    }
    return component;
  });
  const connections = project.circuit.connections.map((entry) => editorConnectionFor(entry));
  // 可见根文档保留 Subcircuit；扁平内部对象只存在于投影结果及其来源映射中。
  return { components, connections };
}

function editorComponentFor(entry: ProjectFileComponent): EditorComponent {
  const data = subcircuitDataOf(entry);
  return {
    id: entry.id,
    kind: entry.kind,
    displayName: entry.displayName,
    position: { ...entry.position },
    lifecycle: "active",
    ...(entry.ports !== undefined ? { ports: clonePorts(entry.ports) } : {}),
    ...(data !== undefined ? { data: { subcircuit: data } } : {}),
  };
}

function editorConnectionFor(entry: ProjectFileData["circuit"]["connections"][number]): EditorConnection {
  const point: Point = { x: 0, y: 0 };
  return {
    id: entry.id,
    source: { componentId: entry.source.component, port: entry.source.port, point },
    target: { componentId: entry.target.component, port: entry.target.port, point: { ...point } },
    lifecycle: "visible",
    danglingEndpoints: [],
    ...(entry.waypoints !== undefined ? { waypoints: entry.waypoints.map((item) => ({ ...item })) } : {}),
    ...(entry.color !== undefined ? { color: entry.color } : {}),
  };
}

async function flattenOccurrence(
  project: ProjectFileData,
  identity: string,
  occurrencePath: readonly string[],
  stack: readonly string[],
  omitBoundary: boolean,
  ownerIds: readonly string[],
  output: MutableOutput,
  reader: HierarchyProjectReader,
  platform: PathPlatform | undefined,
): Promise<OccurrenceProjection> {
  const interfaceResult = omitBoundary
    ? await interfaceFor(project, identity, undefined, stack, output, reader, platform)
    : null;
  const projection: OccurrenceProjection = { inputs: new Map(), outputs: new Map(), inputAliases: new Map(), components: [], connections: [] };
  const componentById = new Map(project.circuit.components.map((component) => [component.id, component]));
  const endpointSource = new Map<string, SourceExpression[]>();
  const endpointTarget = new Map<string, FlatEndpoint[]>();
  const boundaryOutputNames = new Map<string, string>();
  const boundaryInputNames = new Map<string, string>();
  const validSubcircuitPorts = new Map<string, readonly PortSpec[]>();

  for (const component of project.circuit.components) {
    if (component.kind === "subcircuit") {
      const data = subcircuitDataOf(component);
      const childKey = data?.definitionId ?? null;
      if (data === undefined || childKey === null) {
        const diagnostic = diagnosticFor("subcircuit-data-invalid", "Subcircuit 缺少有效引用数据。", identity, component.id, [...stack, identity]);
        output.diagnostics.push(diagnostic);
        updateVisibleSubcircuit(output, component.id, unresolvedData(data, diagnostic));
        continue;
      }
      const childResult = await readChild(reader, childKey, [...occurrencePath, component.id]);
      if (!childResult.ok) {
        const diagnostic = diagnosticFor(childResult.code, childResult.message, childKey, component.id, [...stack, identity, childKey]);
        output.diagnostics.push(diagnostic);
        updateVisibleSubcircuit(output, component.id, unresolvedData(data, diagnostic));
        continue;
      }
      if (stack.includes(childKey) || childKey === identity) {
        const chain = [...stack, identity, childKey];
        const diagnostic = diagnosticFor("reference-cycle", `检测到 Subcircuit 引用环：${chain.join(" → ")}`, childKey, component.id, chain);
        output.diagnostics.push(diagnostic);
        updateVisibleSubcircuit(output, component.id, unresolvedData(data, diagnostic));
        continue;
      }
      const childOutput = createMutableOutput();
      const childInterface = await interfaceFor(childResult.value, childKey, data?.portOrder, [...stack, identity], childOutput, reader, platform);
      if (childInterface === null) {
        const diagnostic = outputDiagnosticForComponent(childOutput, component.id) ?? diagnosticFor("interface-invalid", "Subcircuit 接口无效。", childKey, component.id, [...stack, identity, childKey]);
        output.diagnostics.push(...childOutput.diagnostics);
        updateVisibleSubcircuit(output, component.id, unresolvedData(data, diagnostic));
        continue;
      }
      const child = await flattenOccurrence(
        childResult.value,
        childKey,
        [...occurrencePath, component.id],
        [...stack, identity],
        true,
        [...ownerIds, component.id],
        childOutput,
        reader,
        platform,
      );
      if (childOutput.diagnostics.some((diagnostic) => diagnostic.code !== "definition-missing" && diagnostic.code !== "dangling-connection")) {
        output.diagnostics.push(...childOutput.diagnostics);
        updateVisibleSubcircuit(output, component.id, unresolvedData(data, childOutput.diagnostics[0]!));
        continue;
      }
      mergeOutput(output, childOutput);
      validSubcircuitPorts.set(component.id, childInterface.ports);
      const subData: SubcircuitComponentData = {
        ...(data ?? { reference: "", cachedPorts: [] }),
        definitionId: childKey,
        cachedPorts: data?.cachedPorts ?? childInterface.ports,
        ...(data?.portOrder !== undefined ? { portOrder: [...data.portOrder] } : {}),
        status: "resolved",
        targetIdentity: childKey,
      };
      // 子树已写入全局 Circuit；此处只为父连接建立边界 Endpoint 映射。
      endpointSource.set(component.id, []);
      for (const [port, sources] of child.outputs) {
        // 允许子电路直接把 Input 透传到 Output：保留边界 Input 表达式，
        // 由当前层的连接别名把它收敛到实际 flat endpoint，而不是误把 Input 目标当作输出源。
        const resolvedSources = sources.flatMap((source) => resolveAliasedSources(child, source));
        const qualifiedSources = resolvedSources.map((source) => source.kind === "input"
          ? { kind: "input" as const, port: `${component.id}:${source.port}` }
          : source);
        endpointSource.set(`${component.id}:${port}`, qualifiedSources);
        if (occurrencePath.length === 0) {
          const portMap = output.portSources[component.id] ??= {};
          portMap[port] = {
            outputSources: qualifiedSources
            .filter((source): source is { kind: "flat"; endpoint: FlatEndpoint } => source.kind === "flat")
            .map((source) => ({ ...source.endpoint })),
          };
        }
      }
      for (const port of childInterface.ports.filter((item) => item.direction === "input")) {
        const targets = child.inputs.get(port.name) ?? [];
        const boundaryKey = `${component.id}:${port.name}`;
        endpointTarget.set(boundaryKey, [...targets]);
        boundaryInputNames.set(boundaryKey, boundaryKey);
        if (occurrencePath.length === 0) {
          const portMap = output.portSources[component.id] ??= {};
          if (targets.length > 0) portMap[port.name] = { inputTargets: targets.map((target) => ({ ...target })) };
        }
      }
      // 将采用的解析状态写回顶层可见文档（仅顶层 Component 需要展示）。
      if (occurrencePath.length === 0) {
        updateVisibleSubcircuit(output, component.id, subData);
        output.visiblePorts[component.id] = childInterface.ports;
      }
      continue;
    }

    const isBoundary = omitBoundary && (component.kind === "input" || component.kind === "output");
    const flatId = flatIdFor(occurrencePath, component.id);
    if (!isBoundary) {
      output.components.push({ id: flatId, kind: component.kind, ...(component.ports ? { ports: clonePorts(component.ports) } : {}) });
      projection.components.push(flatId);
      if (occurrencePath.length === 0) addSource(output.componentSources, component.id, flatId);
      for (const ownerId of ownerIds) {
        addSource(output.componentSources, ownerId, flatId);
        const descriptors = output.internalComponents[ownerId] ??= [];
        if (!descriptors.some((descriptor) => descriptor.flatId === flatId)) {
          descriptors.push({
            ownerId,
            flatId,
            kind: component.kind,
            displayName: component.displayName,
            path: [...occurrencePath, component.id],
            ports: clonePorts(component.ports ?? []),
          });
        }
      }
      const ports = component.ports ?? [];
      for (const port of ports) {
        const endpoint = { componentId: flatId, port: port.name };
        endpointSource.set(`${component.id}:${port.name}`, [{ kind: "flat", endpoint }]);
        endpointTarget.set(`${component.id}:${port.name}`, [endpoint]);
      }
    } else if (component.kind === "input") {
      const port = component.ports?.find((item) => item.direction === "output");
      if (port !== undefined) endpointSource.set(component.id, [{ kind: "input", port: component.displayName }]);
    } else {
      const port = component.ports?.find((item) => item.direction === "input");
      if (port !== undefined) {
        endpointTarget.set(component.id, []);
        const externalName = [...(interfaceResult?.componentByPort.entries() ?? [])].find(([, id]) => id === component.id)?.[0];
        boundaryOutputNames.set(component.id, externalName ?? component.displayName);
      }
    }
  }

  // 先收集所有嵌套边界输入的来源别名，使连接遍历顺序不会影响多层直通的结果。
  for (const connection of project.circuit.connections) {
    if (hasInvalidSubcircuitEndpoint(connection, componentById, validSubcircuitPorts)) continue;
    const sources = resolveConnectionSources(connection.source.component, connection.source.port, endpointSource, endpointTarget);
    const targets = resolveConnectionTargets(connection.target.component, connection.target.port, endpointSource, endpointTarget, boundaryOutputNames, boundaryInputNames);
    for (const source of sources) {
      for (const target of targets) {
        if (target.kind !== "input") continue;
        if (source.kind === "flat" || source.kind === "input") addSourceExpression(projection.inputAliases, target.port, source);
      }
    }
  }

  for (const connection of project.circuit.connections) {
    if (hasInvalidSubcircuitEndpoint(connection, componentById, validSubcircuitPorts)) {
      output.diagnostics.push(diagnosticFor("dangling-connection", `连接「${connection.id}」的子电路端口缺失或不兼容，已跳过仿真。`, identity, undefined, [...stack, identity]));
      continue;
    }
    // 内置元件的 Port 清单不进 Project 文件（由引擎回传，ADR 0020），但它们的连接端点
    // 仍然是合法且可展平的。按连接中实际出现的 Port 补出普通元件端点，不能因为文件里
    // 没有缓存清单就把穿过 AND/NOT 等内置元件的连接静默丢掉。
    const sourceComponent = componentById.get(connection.source.component);
    const sourceKey = `${connection.source.component}:${connection.source.port}`;
    if (
      sourceComponent !== undefined &&
      sourceComponent.kind !== "subcircuit" &&
      !(omitBoundary && (sourceComponent.kind === "input" || sourceComponent.kind === "output")) &&
      !endpointSource.has(sourceKey)
    ) {
      endpointSource.set(sourceKey, [{
        kind: "flat",
        endpoint: { componentId: flatIdFor(occurrencePath, sourceComponent.id), port: connection.source.port },
      }]);
    }
    const targetComponent = componentById.get(connection.target.component);
    const targetKey = `${connection.target.component}:${connection.target.port}`;
    if (
      targetComponent !== undefined &&
      targetComponent.kind !== "subcircuit" &&
      !(omitBoundary && (targetComponent.kind === "input" || targetComponent.kind === "output")) &&
      !endpointTarget.has(targetKey)
    ) {
      endpointTarget.set(targetKey, [{
        componentId: flatIdFor(occurrencePath, targetComponent.id),
        port: connection.target.port,
      }]);
    }
    const sources = resolveConnectionSources(connection.source.component, connection.source.port, endpointSource, endpointTarget)
      .flatMap((source) => resolveAliasedSources(projection, source));
    const targets = resolveConnectionTargets(connection.target.component, connection.target.port, endpointSource, endpointTarget, boundaryOutputNames, boundaryInputNames);
    for (const source of sources) {
      for (const target of targets) {
        if (source.kind === "input" && target.kind === "flat") {
          addInputTarget(projection.inputs, source.port, target.endpoint);
          continue;
        }
        if (target.kind === "input") {
          // 当前连接只声明了嵌套边界的输入来源；预扫描已将别名写入 projection，
          // 这里不生成虚假的 flat wire，等待其真实源表达式参与后续传播。
          continue;
        }
        if (source.kind === "flat" && target.kind === "output") {
          addOutputSource(projection.outputs, target.port, source);
          continue;
        }
        if (source.kind === "input" && target.kind === "output") {
          addOutputSource(projection.outputs, target.port, source);
          continue;
        }
        if (source.kind !== "flat" || target.kind !== "flat") continue;
        // 与 Component 一样，子树连接使用 occurrence path 前缀；否则两个实例中
        // 同名的内部连接会靠遍历顺序获得 `#1`，实例增删后身份就不稳定。
        const flatConnectionId = addFlatConnection(output, flatIdFor(occurrencePath, connection.id), source.endpoint, target.endpoint, ownerIds);
        projection.connections.push(flatConnectionId);
        if (occurrencePath.length === 0) addSource(output.connectionSources, connection.id, flatConnectionId);
        for (const ownerId of ownerIds) addSource(output.ownedConnections, ownerId, flatConnectionId);
      }
    }
  }
  if (occurrencePath.length === 0) {
    for (const [componentId, data] of Object.entries(output.visibleSubcircuits)) {
      const portMap = output.portSources[componentId] ??= {};
      for (const port of data.cachedPorts) {
        const sourceExpressions = port.direction === "output"
          ? (endpointSource.get(`${componentId}:${port.name}`) ?? [])
          : (projection.inputAliases.get(`${componentId}:${port.name}`) ?? []);
        const outputSources = uniqueFlatEndpoints(
          sourceExpressions.flatMap((source) => resolveAliasedSources(projection, source)),
        );
        if (outputSources.length > 0) {
          portMap[port.name] = { ...portMap[port.name], outputSources };
        }
      }
    }
  }
  return projection;
}

/** 子电路端点必须匹配当前定义的名称、方向和位宽；缺失子树的连接也保持在文档中。 */
function hasInvalidSubcircuitEndpoint(
  connection: ProjectFileData["circuit"]["connections"][number],
  components: ReadonlyMap<string, ProjectFileComponent>,
  validPorts: ReadonlyMap<string, readonly PortSpec[]>,
): boolean {
  for (const [endpoint, direction] of [[connection.source, "output"], [connection.target, "input"]] as const) {
    const component = components.get(endpoint.component);
    if (component?.kind !== "subcircuit") continue;
    const actual = validPorts.get(component.id)?.find((port) => port.name === endpoint.port && port.direction === direction);
    const cached = component.data !== undefined && "cachedPorts" in component.data
      ? component.data.cachedPorts.find((port) => port.name === endpoint.port && port.direction === direction)
      : undefined;
    if (actual === undefined || cached === undefined || actual.width !== cached.width) return true;
  }
  return false;
}

/** 把可读来源收敛为稳定且无重复的扁平端点，供纯边界直通 Port 显示信号。 */
function uniqueFlatEndpoints(sources: readonly SourceExpression[]): FlatEndpoint[] {
  const seen = new Set<string>();
  const result: FlatEndpoint[] = [];
  for (const source of sources) {
    if (source.kind !== "flat") continue;
    const key = `${source.endpoint.componentId}\u0000${source.endpoint.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...source.endpoint });
  }
  return result;
}

function resolveConnectionSources(componentId: string, port: string, sources: Map<string, SourceExpression[]>, targets: Map<string, FlatEndpoint[]>): SourceExpression[] {
  const direct = sources.get(`${componentId}:${port}`) ?? sources.get(componentId);
  if (direct !== undefined) return direct;
  return (targets.get(`${componentId}:${port}`) ?? []).map((endpoint) => ({ kind: "flat", endpoint }));
}

function resolveAliasedSources(projection: Pick<OccurrenceProjection, "inputAliases">, source: SourceExpression, stack: readonly string[] = []): SourceExpression[] {
  if (source.kind === "flat") return [source];
  if (stack.includes(source.port)) return [source];
  const aliases = projection.inputAliases.get(source.port);
  if (aliases === undefined) return [source];
  return aliases.flatMap((alias) => resolveAliasedSources(projection, alias, [...stack, source.port]));
}

function resolveConnectionTargets(
  componentId: string,
  port: string,
  sources: Map<string, SourceExpression[]>,
  targets: Map<string, FlatEndpoint[]>,
  boundaryOutputNames: ReadonlyMap<string, string>,
  boundaryInputNames: ReadonlyMap<string, string>,
): Array<{ kind: "flat"; endpoint: FlatEndpoint } | { kind: "output"; port: string } | { kind: "input"; port: string }> {
  const direct = targets.get(`${componentId}:${port}`);
  const boundaryInput = boundaryInputNames.get(`${componentId}:${port}`);
  if (boundaryInput !== undefined) {
    return [
      ...(direct ?? []).map((endpoint) => ({ kind: "flat" as const, endpoint })),
      { kind: "input" as const, port: boundaryInput },
    ];
  }
  if (direct !== undefined && direct.length > 0) return direct.map((endpoint) => ({ kind: "flat", endpoint }));
  if ((direct !== undefined && direct.length === 0) || (targets.has(componentId) && (targets.get(componentId)?.length ?? 0) === 0)) return [{ kind: "output", port: boundaryOutputNames.get(componentId) ?? port }];
  if (sources.has(componentId) || sources.has(`${componentId}:${port}`)) return [{ kind: "output", port }];
  return [];
}

async function interfaceFor(
  project: ProjectFileData,
  identity: string,
  explicitOrder: readonly string[] | undefined,
  stack: readonly string[],
  output: MutableOutput,
  _reader: HierarchyProjectReader,
  _platform: PathPlatform | undefined,
): Promise<ProjectInterface | null> {
  // Clock 只能存在于顶层运行文档；将含 Clock 的文件作为子电路会让层次接口
  // 失去纯组合语义，因此在边界处整体拒绝，而顶层调用不会进入本函数。
  if (project.circuit.components.some((entry) => entry.kind === "clock")) {
    output.diagnostics.push(diagnosticFor(
      "interface-clock-unsupported",
      "包含 Clock 的 Project 不能作为 Subcircuit。",
      identity,
      undefined,
      [...stack, identity],
    ));
    return null;
  }
  const published = project.circuit.components.filter((entry) => entry.kind === "input" || entry.kind === "output");
  const ports: PortSpec[] = [];
  const componentByPort = new Map<string, string>();
  const inputNames = new Set<string>();
  const outputNames = new Set<string>();
  for (const component of published) {
    if (component.displayName.length === 0) {
      output.diagnostics.push(diagnosticFor("interface-empty-label", "Subcircuit Port 标签不能为空。", identity, component.id, [...stack, identity]));
      continue;
    }
    const port = component.ports?.find((item) => item.direction === (component.kind === "input" ? "output" : "input"));
    if (port === undefined) {
      output.diagnostics.push(diagnosticFor("interface-missing-port-list", `Subcircuit Port「${component.displayName}」缺少权威端口清单。`, identity, component.id, [...stack, identity]));
      continue;
    }
    const name = component.displayName;
    if (componentByPort.has(name)) {
      output.diagnostics.push(diagnosticFor("interface-duplicate-label", `Subcircuit Port 标签重复：${name}。`, identity, component.id, [...stack, identity]));
      continue;
    }
    const external: PortSpec = { name, direction: component.kind === "input" ? "input" : "output", width: port.width };
    ports.push(external);
    componentByPort.set(name, component.id);
    (external.direction === "input" ? inputNames : outputNames).add(name);
  }
  if (ports.length !== published.length) return null;
  const ordered = explicitOrder === undefined
    ? [...ports].sort((left, right) => {
        const a = project.circuit.components.find((entry) => entry.id === componentByPort.get(left.name))!;
        const b = project.circuit.components.find((entry) => entry.id === componentByPort.get(right.name))!;
        return a.position.y - b.position.y || a.id.localeCompare(b.id);
      })
    : orderPorts(ports, explicitOrder, identity, stack, output);
  if (ordered === null) return null;
  return { ports: ordered, inputNames, outputNames, componentByPort };
}

function orderPorts(ports: readonly PortSpec[], order: readonly string[], identity: string, stack: readonly string[], output: MutableOutput): readonly PortSpec[] | null {
  const names = new Set(ports.map((port) => port.name));
  if (order.length !== names.size || new Set(order).size !== order.length || order.some((name) => !names.has(name))) {
    output.diagnostics.push(diagnosticFor("explicit-port-order-invalid", "Subcircuit Port 顺序必须完整且不能重复。", identity, undefined, [...stack, identity]));
    return null;
  }
  return order.map((name) => ports.find((port) => port.name === name)!);
}

async function readChild(reader: HierarchyProjectReader, identity: string, occurrencePath: readonly string[] = []) {
  try {
    return await reader.read(identity, occurrencePath);
  } catch (error) {
    return { ok: false as const, code: "project-read-failed", message: error instanceof Error ? error.message : "读取子 Project 失败。" };
  }
}

function subcircuitDataOf(entry: ProjectFileComponent): SubcircuitComponentData | undefined {
  if (entry.kind !== "subcircuit" || entry.data === undefined || !("definitionId" in entry.data)) return undefined;
  return {
    definitionId: entry.data.definitionId,
    reference: "",
    cachedPorts: entry.data.cachedPorts.map(clonePort),
    ...(entry.data.portOrder !== undefined ? { portOrder: [...entry.data.portOrder] } : {}),
  };
}

function updateVisibleSubcircuit(output: MutableOutput, componentId: string, data: SubcircuitComponentData): void {
  output.visibleSubcircuits[componentId] = data;
}

function unresolvedData(data: SubcircuitComponentData | undefined, diagnostic: HierarchyDiagnostic): SubcircuitComponentData {
  return {
    reference: data?.reference ?? "",
    ...(data?.definitionId !== undefined ? { definitionId: data.definitionId } : {}),
    cachedPorts: data?.cachedPorts ?? [],
    ...(data?.portOrder !== undefined ? { portOrder: [...data.portOrder] } : {}),
    status: "unresolved",
    diagnostic,
  };
}

function outputDiagnosticForComponent(output: MutableOutput, componentId: string): HierarchyDiagnostic | undefined {
  return output.diagnostics.find((diagnostic) => diagnostic.componentId === componentId) ?? output.diagnostics[0];
}

function flatIdFor(path: readonly string[], id: string): string {
  return path.length === 0 ? id : `${path.join("/")}/${id}`;
}

function addFlatConnection(output: MutableOutput, baseId: string, source: FlatEndpoint, target: FlatEndpoint, ownerIds: readonly string[]): string {
  const existing = output.connections.filter((connection) => connection.id === baseId || connection.id.startsWith(`${baseId}#`)).length;
  const id = existing === 0 ? baseId : `${baseId}#${existing}`;
  output.connections.push({ id, source: { ...source }, target: { ...target } });
  for (const ownerId of ownerIds) addSource(output.ownedConnections, ownerId, id);
  return id;
}

function addInputTarget(map: Map<string, readonly FlatEndpoint[]>, port: string, endpoint: FlatEndpoint): void {
  map.set(port, [...(map.get(port) ?? []), endpoint]);
}

function addOutputSource(map: Map<string, readonly SourceExpression[]>, port: string, source: SourceExpression): void {
  map.set(port, [...(map.get(port) ?? []), source]);
}

function addSourceExpression(map: Map<string, readonly SourceExpression[]>, port: string, source: SourceExpression): void {
  map.set(port, [...(map.get(port) ?? []), source]);
}

function addSource(map: Record<string, string[]>, key: string, value: string): void {
  map[key] ??= [];
  if (!map[key]!.includes(value)) map[key]!.push(value);
}

function diagnosticFor(code: string, message: string, path: string, componentId: string | undefined, chain: readonly string[]): HierarchyDiagnostic {
  return { code, message, path, ...(componentId !== undefined ? { componentId } : {}), chain };
}

function clonePort(port: PortSpec): PortSpec {
  return { name: port.name, direction: port.direction, width: port.width, ...(port.bitRange ? { bitRange: { ...port.bitRange } } : {}) };
}

const clonePorts = (ports: readonly PortSpec[]): readonly PortSpec[] => ports.map(clonePort);
