import type { ComponentKindName, PortSpec } from "@circuit-platform/protocol";
import type { EditorComponentData, EditorComponentKind, SubcircuitComponentData, SubcircuitDiagnostic, SubcircuitStatus } from "../editor/component.ts";
import type { EditorComponent, EditorConnection, EditorDocument, Point } from "../editor/index.ts";
import type { ProjectFileComponent, ProjectFileData } from "./index.ts";
import { projectPathIdentity, resolveProjectReference, type PathPlatform } from "./paths.ts";

/** 供层次解析模块使用的最小子 Project 读取器；实现可以接文件、内存图或测试夹具。 */
export interface HierarchyProjectReader {
  read(identity: string): Promise<
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
  reader: HierarchyProjectReader;
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
  visibleSubcircuits: Record<string, SubcircuitComponentData>;
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
    visibleSubcircuits: {},
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
  Object.assign(target.visibleSubcircuits, source.visibleSubcircuits);
  target.diagnostics.push(...source.diagnostics);
}

/**
 * 递归解析并展平一份 Project。
 * @param input 顶层 Project 身份、已校验文件数据和可注入的子 Project 读取器。
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
    visibleSubcircuits: {},
    diagnostics: [],
  };
  await flattenOccurrence(input.root, rootIdentity, [], [], false, undefined, output, input.reader, platform);
  const rootDocument = documentForProject(input.root, output);

  return {
    document: rootDocument,
    circuit: { components: output.components, connections: output.connections },
    sources: {
      components: output.componentSources,
      connections: output.connectionSources,
      ownedConnections: output.ownedConnections,
      ports: output.portSources,
    },
    diagnostics: output.diagnostics,
  };
}

function documentForProject(project: ProjectFileData, output: MutableOutput): EditorDocument {
  const components = project.circuit.components.map((entry) => {
    const component = editorComponentFor(entry);
    const resolved = output.visibleSubcircuits[entry.id];
    if (resolved !== undefined) {
      return { ...component, ports: clonePorts(resolved.cachedPorts), data: { subcircuit: resolved } } as unknown as EditorComponent;
    }
    if (entry.kind === "subcircuit") {
      const data = subcircuitDataOf(entry);
      if (data !== undefined) return { ...component, ports: clonePorts(data.cachedPorts), data: { subcircuit: { ...data, status: "unresolved" as SubcircuitStatus } } } as unknown as EditorComponent;
    }
    return component;
  });
  const connections = project.circuit.connections.map((entry) => editorConnectionFor(entry));
  // EditorComponent 的层次字段由 editor/component.ts 定义；旧 EditorDocument 类型将在
  // #45 接入编辑器侧 kind 时自然收窄，这里保持当前分支可独立测试。
  return { components, connections } as unknown as EditorDocument;
}

function editorComponentFor(entry: ProjectFileComponent): EditorComponent {
  const data = subcircuitDataOf(entry);
  return {
    id: entry.id,
    kind: entry.kind as EditorComponent["kind"],
    displayName: entry.displayName,
    position: { ...entry.position },
    lifecycle: "active",
    ...(entry.ports !== undefined ? { ports: clonePorts(entry.ports) } : {}),
    ...(data !== undefined ? { data: { subcircuit: data } } : {}),
  } as unknown as EditorComponent;
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
  ownerId: string | undefined,
  output: MutableOutput,
  reader: HierarchyProjectReader,
  platform: PathPlatform | undefined,
): Promise<OccurrenceProjection> {
  const interfaceResult = omitBoundary
    ? await interfaceFor(project, identity, undefined, stack, output, reader, platform)
    : null;
  const projection: OccurrenceProjection = { inputs: new Map(), outputs: new Map(), components: [], connections: [] };
  const componentById = new Map(project.circuit.components.map((component) => [component.id, component]));
  const endpointSource = new Map<string, SourceExpression[]>();
  const endpointTarget = new Map<string, FlatEndpoint[]>();
  const boundaryOutputNames = new Map<string, string>();

  for (const component of project.circuit.components) {
    if (component.kind === "subcircuit") {
      const data = subcircuitDataOf(component);
      const childIdentity = data === undefined ? null : resolveProjectReference(data.reference, identity, platform);
      const childKey = childIdentity === null ? null : projectPathIdentity(childIdentity, platform);
      if (data === undefined || childKey === null) {
        const diagnostic = diagnosticFor("subcircuit-data-invalid", "Subcircuit 缺少有效引用数据。", identity, component.id, [...stack, identity]);
        output.diagnostics.push(diagnostic);
        updateVisibleSubcircuit(output, component.id, unresolvedData(data, diagnostic));
        continue;
      }
      const childResult = await readChild(reader, childKey);
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
        component.id,
        childOutput,
        reader,
        platform,
      );
      if (childOutput.diagnostics.length > 0) {
        output.diagnostics.push(...childOutput.diagnostics);
        updateVisibleSubcircuit(output, component.id, unresolvedData(data, childOutput.diagnostics[0]!));
        continue;
      }
      mergeOutput(output, childOutput);
      const subData: SubcircuitComponentData = {
        ...(data ?? { reference: "", cachedPorts: [] }),
        reference: data?.reference ?? "",
        cachedPorts: childInterface.ports,
        ...(data?.portOrder !== undefined ? { portOrder: [...data.portOrder] } : {}),
        status: "resolved" as SubcircuitStatus,
        targetIdentity: childKey,
      };
      // 子树已写入全局 Circuit；此处只为父连接建立边界 Endpoint 映射。
      endpointSource.set(component.id, []);
      for (const [port, sources] of child.outputs) {
        // 允许子电路直接把 Input 透传到 Output：边界上的 input expression
        // 在当前 occurrence 中收敛为同一组内部目标，父层即可继续生成真实 flat wire。
        const resolvedSources = sources.flatMap((source) => source.kind === "flat"
          ? [source]
          : (child.inputs.get(source.port) ?? []).map((endpoint) => ({ kind: "flat" as const, endpoint })));
        endpointSource.set(`${component.id}:${port}`, resolvedSources);
        if (occurrencePath.length === 0) {
          const portMap = output.portSources[component.id] ??= {};
          portMap[port] = {
            outputSources: resolvedSources
            .filter((source): source is { kind: "flat"; endpoint: FlatEndpoint } => source.kind === "flat")
            .map((source) => ({ ...source.endpoint })),
          };
        }
      }
      for (const [port, targets] of child.inputs) {
        endpointTarget.set(`${component.id}:${port}`, [...targets]);
        if (occurrencePath.length === 0) {
          const portMap = output.portSources[component.id] ??= {};
          portMap[port] = { inputTargets: targets.map((target) => ({ ...target })) };
        }
      }
      // 将采用的解析状态写回顶层可见文档（仅顶层 Component 需要展示）。
      if (occurrencePath.length === 0) updateVisibleSubcircuit(output, component.id, subData);
      continue;
    }

    const isBoundary = omitBoundary && (component.kind === "input" || component.kind === "output");
    const flatId = flatIdFor(occurrencePath, component.id);
    if (!isBoundary) {
      output.components.push({ id: flatId, kind: component.kind as ComponentKindName, ...(component.ports ? { ports: clonePorts(component.ports) } : {}) });
      projection.components.push(flatId);
      if (occurrencePath.length === 0) addSource(output.componentSources, component.id, flatId);
      if (ownerId !== undefined) addSource(output.componentSources, ownerId, flatId);
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

  for (const connection of project.circuit.connections) {
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
    const sources = resolveConnectionSources(connection.source.component, connection.source.port, endpointSource, endpointTarget);
    const targets = resolveConnectionTargets(connection.target.component, connection.target.port, endpointSource, endpointTarget, boundaryOutputNames);
    for (const source of sources) {
      for (const target of targets) {
        if (source.kind === "input" && target.kind === "flat") {
          addInputTarget(projection.inputs, source.port, target.endpoint);
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
        const flatConnectionId = addFlatConnection(output, flatIdFor(occurrencePath, connection.id), source.endpoint, target.endpoint, ownerId);
        projection.connections.push(flatConnectionId);
        if (occurrencePath.length === 0) addSource(output.connectionSources, connection.id, flatConnectionId);
        if (ownerId !== undefined) addSource(output.ownedConnections, ownerId, flatConnectionId);
      }
    }
  }
  return projection;
}

function resolveConnectionSources(componentId: string, port: string, sources: Map<string, SourceExpression[]>, targets: Map<string, FlatEndpoint[]>): SourceExpression[] {
  const direct = sources.get(`${componentId}:${port}`) ?? sources.get(componentId);
  if (direct !== undefined) return direct;
  return (targets.get(`${componentId}:${port}`) ?? []).map((endpoint) => ({ kind: "flat", endpoint }));
}

function resolveConnectionTargets(componentId: string, port: string, sources: Map<string, SourceExpression[]>, targets: Map<string, FlatEndpoint[]>, boundaryOutputNames: ReadonlyMap<string, string>): Array<{ kind: "flat"; endpoint: FlatEndpoint } | { kind: "output"; port: string }> {
  const direct = targets.get(`${componentId}:${port}`);
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

async function readChild(reader: HierarchyProjectReader, identity: string) {
  try {
    return await reader.read(identity);
  } catch (error) {
    return { ok: false as const, code: "project-read-failed", message: error instanceof Error ? error.message : "读取子 Project 失败。" };
  }
}

function subcircuitDataOf(entry: ProjectFileComponent): SubcircuitComponentData | undefined {
  if (entry.kind !== "subcircuit" || entry.data === undefined || !("reference" in entry.data)) return undefined;
  return {
    reference: entry.data.reference,
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

function addFlatConnection(output: MutableOutput, baseId: string, source: FlatEndpoint, target: FlatEndpoint, ownerId: string | undefined): string {
  const existing = output.connections.filter((connection) => connection.id === baseId || connection.id.startsWith(`${baseId}#`)).length;
  const id = existing === 0 ? baseId : `${baseId}#${existing}`;
  output.connections.push({ id, source: { ...source }, target: { ...target } });
  if (ownerId !== undefined) addSource(output.ownedConnections, ownerId, id);
  return id;
}

function addInputTarget(map: Map<string, readonly FlatEndpoint[]>, port: string, endpoint: FlatEndpoint): void {
  map.set(port, [...(map.get(port) ?? []), endpoint]);
}

function addOutputSource(map: Map<string, readonly SourceExpression[]>, port: string, source: SourceExpression): void {
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
