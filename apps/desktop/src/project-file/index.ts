/**
 * 项目文件 v1（`.circuit.json`）的序列化与校验：编辑器文档与 v1 JSON 互相转换的纯实现。
 *
 * 这是 Phase 5 唯一新增的测试缝。校验规则只有这一份实现——渲染层负责序列化与校验，
 * 主进程只做对话框与文件读写，所以本模块不接 Vue、不接 Electron、不做任何 IO：
 * 调用方拿到普通对象，`JSON.stringify` / `JSON.parse` 与落盘都发生在调用方。
 *
 * v1 的既定取舍（规格 #34）：Editor ID 写入文件并作为文件内唯一身份，加载后沿用同一套
 * 身份；Waypoint 以语义形式内联在连接记录上，渲染 Route 不进文件；端口清单只为数据驱动
 * 元件写入，且只是缓存——引擎回传的清单仍是权威；`data` 数据袋 v1 保存 Input 当前值或
 * Subcircuit 的引用与缓存接口；
 * 视口、选中、撤销历史、波形历史与时序状态都是会话状态，不进文件。
 */

import type { ComponentKindName, PortSpec, Signal } from "@circuit-platform/protocol";
import type { EditorComponentKind, EditorComponentData, SubcircuitComponentData } from "../editor/component.ts";
import type { EditorComponent, EditorConnection, EditorDocument, Point } from "../editor/index.ts";
import { isWireColorId, type WireColorId } from "../editor/wire-appearance.ts";
import { relativeProjectReference, resolveProjectReference, type PathPlatform } from "./paths.ts";

export {
  currentPathPlatform,
  normalizeProjectPath,
  projectPathIdentity,
  projectDirectory,
  resolveProjectReference,
  relativeProjectReference,
  type PathPlatform,
  type ProjectPathOptions,
  sameProjectPath,
} from "./paths.ts";

/** 当前实现支持的最高项目文件版本；版本规则由 `parseProjectFile` 执行。 */
export const PROJECT_FILE_VERSION = 1;

/**
 * v1 文件里允许出现的元件类型；文件格式钉死这份清单，新元件类型属于新的文件版本。
 * 若 `ComponentKindName` 未来扩充，这里是必须被有意更新的一处。
 */
const FILE_KINDS = [
  "input",
  "output",
  "and",
  "or",
  "nand",
  "nor",
  "xor",
  "xnor",
  "not",
  "clock",
  "d_flip_flop",
  "splitter",
  "merger",
  "subcircuit",
] as const satisfies readonly EditorComponentKind[];

/**
 * 文件里写端口清单的「数据驱动」元件：Input/Output 的位宽与拆线器/合线器的位区间是用户
 * 可改的数据，必须落盘；内置逻辑门与引擎内置定义的其余元件不写清单，由引擎回退。
 *
 * 注意口径比 `editor/bus-ports.ts` 的数据驱动判定宽——那里关心的是「引擎没有内置定义」，
 * 这里关心的是「清单是否属于必须进文件的用户数据」。
 */
const FILE_DATA_DRIVEN_KINDS: readonly ComponentKindName[] = ["input", "output", "splitter", "merger"];

/** 项目文件 v1 的类型形状；只描述序列化结果，解析前的实际数据一律按 `unknown` 校验。 */
export interface ProjectFileData {
  version: number;
  circuit: {
    components: readonly ProjectFileComponent[];
    connections: readonly ProjectFileConnection[];
  };
}

/** 文件里一个元件的记录。 */
export interface ProjectFileComponent {
  id: string;
  kind: EditorComponentKind;
  displayName: string;
  position: { x: number; y: number };
  /** 端口清单缓存，只在数据驱动元件上写入；引擎回传的清单仍是权威。 */
  ports?: readonly PortSpec[];
  /** 按类型扩展的数据袋；v1 支持 Input 当前激励值与 Subcircuit 引用缓存。 */
  data?: ProjectFileComponentData;
}

/** 按元件类型扩展的项目文件数据袋；Subcircuit 的缓存接口随父文件保存。 */
export type ProjectFileComponentData =
  | { value?: string }
  | { reference: string; cachedPorts: readonly PortSpec[]; portOrder?: readonly string[] };

/** 文件里一条连接的记录；端点用元件的 Editor ID 引用。 */
export interface ProjectFileConnection {
  id: string;
  source: { component: string; port: string };
  target: { component: string; port: string };
  /** 语义 Waypoint；渲染 Route 由加载后的端点位置加这份清单推导。 */
  waypoints?: readonly { x: number; y: number }[];
  /** 线材颜色预设的 ID。 */
  color?: WireColorId;
}

/** `serializeProjectFile` 的输入。 */
export interface ProjectSerializationInput {
  document: EditorDocument;
  /**
   * 每个 Input 元件保存时的当前值，键为元件 ID，值是逐位 `0`/`1`/`X` 文本。
   * 与工作区 `inputValues` 同键空间；省略的输入不写 `data`。
   */
  inputValues?: Readonly<Record<string, Signal>>;
}

/** Save As 重定位引用时返回的稳定错误；失败时原文件不会产生部分改写。 */
export interface ProjectFileRebaseError {
  code: "reference-rebase-cross-root";
  message: string;
  componentId: string;
  target: string;
}

export type ProjectFileRebaseResult =
  | { ok: true; value: ProjectFileData }
  | { ok: false; error: ProjectFileRebaseError };

/**
 * 将项目文件中顶层 Subcircuit 的引用从旧父路径重定位到新父路径。
 *
 * 每条引用先按旧父路径解析为目标身份，再按新父路径计算相对写法；所有目标都能
 * 相对化后才一次性返回新文件，因此跨盘符或跨根失败时不会留下半成品修改。
 * @param file 已通过 `parseProjectFile` 的规范化项目文件。
 * @param oldParentProject 原父 Project 路径。
 * @param newParentProject Save As 后的新父 Project 路径。
 * @param platform 路径语义平台。
 * @returns 全部引用重定位后的新文件，或稳定的跨根错误。
 */
export function rebaseProjectFileReferences(
  file: ProjectFileData,
  oldParentProject: string,
  newParentProject: string,
  platform?: PathPlatform,
): ProjectFileRebaseResult {
  const references = file.circuit.components.flatMap((component) => {
    if (component.kind !== "subcircuit" || component.data === undefined || !("reference" in component.data)) return [];
    const target = resolveProjectReference(component.data.reference, oldParentProject, platform);
    const reference = relativeProjectReference(target, newParentProject, platform);
    return [{ component, target, reference }];
  });
  const failed = references.find((item) => item.reference === null);
  if (failed !== undefined) {
    return {
      ok: false,
      error: {
        code: "reference-rebase-cross-root",
        message: `Subcircuit「${failed.component.id}」的目标无法从新父路径计算相对引用：${failed.target}。`,
        componentId: failed.component.id,
        target: failed.target,
      },
    };
  }
  const rebased = new Map(references.map((item) => [item.component.id, item.reference!]));
  return {
    ok: true,
    value: {
      version: file.version,
      circuit: {
        components: file.circuit.components.map((component) => ({
          ...component,
          position: { ...component.position },
          ...(component.ports !== undefined ? { ports: component.ports.map(cloneFilePort) } : {}),
          ...(component.kind === "subcircuit" && component.data !== undefined && "reference" in component.data
            ? {
                data: {
                  ...component.data,
                  reference: rebased.get(component.id)!,
                  cachedPorts: component.data.cachedPorts.map(cloneFilePort),
                  ...(component.data.portOrder !== undefined ? { portOrder: [...component.data.portOrder] } : {}),
                },
              }
            : component.data !== undefined
              ? { data: { ...component.data } }
              : {}),
        })),
        connections: file.circuit.connections.map((connection) => ({
          ...connection,
          source: { ...connection.source },
          target: { ...connection.target },
          ...(connection.waypoints !== undefined ? { waypoints: connection.waypoints.map((point) => ({ ...point })) } : {}),
        })),
      },
    },
  };
}

/** 一次校验失败的单一原因；`code` 供程序分支，`message` 可直接展示。 */
export interface ProjectFileError {
  code: string;
  message: string;
}

/** 解析成功的结果：可直接交给编辑器文档结构的数据，外加 Input 的当前值。 */
export interface ParsedProjectFile {
  /** 文件声明的版本；只可能等于或低于 `PROJECT_FILE_VERSION`。 */
  version: number;
  /**
   * 与编辑器文档同构的数据。
   *
   * 连接端点的 `point` 是占位零点：投影层对已连接端点本来就由元件位置与端口清单重新推导，
   * 持久 point 只对悬空端点有意义。加载路径在拿到引擎回传的权威端口清单后，应重建端点几何
   * 再交给会话——会话的移动命令把持久 point 当作端口偏移使用，占位值不能带进后续编辑。
   */
  document: EditorDocument;
  /** 通过同一份校验规则规范化后的文件结构，供层次解析器读取，不需要调用方回到 raw。 */
  file: ProjectFileData;
  /** Input 元件保存时的当前值，键为元件 ID；重新打开后经既有 `set_input` 路径提交。 */
  inputValues: Readonly<Record<string, Signal>>;
}

export type ProjectFileParseResult =
  | { ok: true; value: ParsedProjectFile }
  | { ok: false; errors: readonly ProjectFileError[] };

/**
 * 把编辑器文档序列化为项目文件 v1 的数据。无校验、无 IO：文档里缺什么就少写什么，
 * 端口清单与输入值的权威来源是调用方（引擎回传值与工作区状态）。
 * @param input 编辑器文档与可选的 Input 当前值。
 * @returns 可直接 `JSON.stringify` 落盘的 v1 文件数据。
 */
export function serializeProjectFile(input: ProjectSerializationInput): ProjectFileData {
  const activeComponentIds = new Set(
    input.document.components
      .filter((component) => component.lifecycle === "active")
      .map((component) => component.id),
  );
  const components: ProjectFileComponent[] = [];
  for (const component of input.document.components) {
    // 快照文档本就只含活动元件，这里按生命周期过滤是防御性的：被删除的结构不属于文件。
    if (component.lifecycle !== "active") continue;
    const ports =
      component.kind !== "subcircuit" && FILE_DATA_DRIVEN_KINDS.includes(component.kind) && component.ports !== undefined
        ? component.ports.map(cloneFilePort)
        : undefined;
    const value = component.kind === "input" ? input.inputValues?.[component.id] : undefined;
    const subcircuit = component.kind === "subcircuit"
      ? (component as EditorComponent & { data?: EditorComponentData }).data?.subcircuit
      : undefined;
    components.push({
      id: component.id,
      kind: component.kind,
      displayName: component.displayName,
      position: { x: component.position.x, y: component.position.y },
      ...(ports !== undefined ? { ports } : {}),
      ...(value !== undefined ? { data: { value } } : {}),
      ...(subcircuit !== undefined ? { data: serializeSubcircuitData(subcircuit) } : {}),
    });
  }

  const connections: ProjectFileConnection[] = [];
  for (const connection of input.document.connections) {
    // hidden 只出现在等待引擎确认的操作过程中，是会话瞬间状态而非文档内容。
    if (connection.lifecycle !== "visible") continue;
    // 端点引用已删除元件的悬空连线不是文件内容：文件用元件 ID 引用端点，而校验规则要求
    // 引用必须可解析（否则保存出的文件永远打不开）；被删元件连同挂在上面的半根线一并留在会话里。
    if (!activeComponentIds.has(connection.source.componentId)) continue;
    if (!activeComponentIds.has(connection.target.componentId)) continue;
    const waypoints = connection.waypoints ?? waypointsOfRoute(connection.route);
    connections.push({
      id: connection.id,
      source: { component: connection.source.componentId, port: connection.source.port },
      target: { component: connection.target.componentId, port: connection.target.port },
      ...(waypoints.length > 0 ? { waypoints: waypoints.map((point) => ({ ...point })) } : {}),
      ...(connection.color !== undefined ? { color: connection.color } : {}),
    });
  }

  return { version: PROJECT_FILE_VERSION, circuit: { components, connections } };
}

/**
 * 校验并解析项目文件数据。任何一条规则失败都整体拒绝并返回全部可展示原因，
 * 不产生半成品文档；成功时返回可直接交给编辑器文档结构的数据。
 * @param raw `JSON.parse` 的结果；本函数不读文件，也不假设编码之外的内容。
 * @returns 成功时携带版本、文档数据与 Input 当前值；失败时携带结构化错误列表。
 */
export function parseProjectFile(raw: unknown): ProjectFileParseResult {
  if (!isRecord(raw)) {
    return { ok: false, errors: [{ code: "root-not-object", message: "项目文件的根必须是 JSON 对象。" }] };
  }

  // 版本是挡在结构校验前面的闸门：缺失、非整数或高于支持版本都直接拒绝，
  // 不再尝试解释更高版本的结构。等于或低于支持版本接受（当前只有 1）。
  const version: unknown = raw.version;
  if (version === undefined) {
    return { ok: false, errors: [{ code: "version-missing", message: "项目文件缺少版本字段 version。" }] };
  }
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return {
      ok: false,
      errors: [
        {
          code: "version-not-integer",
          message: `项目文件的 version 必须是整数，实际是 ${describeValue(version)}。`,
        },
      ],
    };
  }
  if (version > PROJECT_FILE_VERSION) {
    return {
      ok: false,
      errors: [
        {
          code: "version-unsupported",
          message: `项目文件由更新版本的应用保存（version ${version}），当前支持到 version ${PROJECT_FILE_VERSION}。`,
        },
      ],
    };
  }

  const errors: ProjectFileError[] = [];
  const circuit = raw.circuit;
  if (!isRecord(circuit)) {
    errors.push({ code: "circuit-not-object", message: "项目文件缺少 circuit 对象。" });
    return { ok: false, errors };
  }
  const rawComponents = circuit.components;
  if (!Array.isArray(rawComponents)) {
    return { ok: false, errors: [{ code: "components-not-array", message: "circuit.components 必须是数组。" }] };
  }
  const rawConnections = circuit.connections;
  if (!Array.isArray(rawConnections)) {
    return { ok: false, errors: [{ code: "connections-not-array", message: "circuit.connections 必须是数组。" }] };
  }

  const components: EditorComponent[] = [];
  const inputValues: Record<string, Signal> = {};
  // 引用校验只需要「文件里出现过哪些元件 ID」：即便某条元件记录另有缺陷，
  // 悬空引用与它的具体原因也能一次性收集全，用户不必修一个错跑一轮。
  const componentIds = new Set<string>();

  for (const [index, entry] of rawComponents.entries()) {
    const label = `第 ${index + 1} 个元件记录`;
    if (!isRecord(entry)) {
      errors.push({ code: "component-not-object", message: `${label}不是对象。` });
      continue;
    }
    const id = entry.id;
    if (!isNonEmptyString(id)) {
      errors.push({ code: "component-id-invalid", message: `${label}缺少非空字符串的 id。` });
      continue;
    }
    if (componentIds.has(id)) {
      errors.push({ code: "component-id-duplicate", message: `${label}的 id 与前面的元件重复：${id}。` });
      continue;
    }
    componentIds.add(id);
    const kind = entry.kind;
    if (!isNonEmptyString(kind) || !fileKindIs(kind)) {
      errors.push({
        code: "component-kind-unknown",
        message: `${label}（${id}）的 kind ${describeValue(kind)} 不是 v1 支持的元件类型。`,
      });
      continue;
    }

    // 单条记录的多处缺陷一次报完；只有形状全部合法的记录才会进入结果——而只要还有任何
    // 一条错误，整个文件就已经被拒绝了，所以这里的逐项取舍只影响错误清单的完整程度。
    let valid = true;
    const displayName = typeof entry.displayName === "string" ? entry.displayName : null;
    if (displayName === null) {
      valid = false;
      errors.push({ code: "component-display-name-invalid", message: `${label}（${id}）的 displayName 必须是字符串。` });
    }
    const position = isPointShape(entry.position) ? entry.position : null;
    if (position === null) {
      valid = false;
      errors.push({
        code: "component-position-invalid",
        message: `${label}（${id}）的 position 必须是含有限数字 x、y 的对象。`,
      });
    }
    let ports: readonly PortSpec[] | undefined;
    if (entry.ports !== undefined && kind !== "subcircuit" && fileDataDrivenKindIs(kind)) {
      if (!isFilePortList(entry.ports)) {
        valid = false;
        errors.push({
          code: "component-ports-invalid",
          message: `${label}（${id}）的 ports 必须是合法的端口声明清单。`,
        });
      } else {
        ports = entry.ports.map(cloneFilePort);
      }
      // 内置元件文件里多余的清单不在此处理：引擎回退到内置定义（ADR 0020），按未知数据容忍忽略。
    }
    if (entry.data !== undefined && kind === "input") {
      const data = entry.data;
      if (!isRecord(data) || (data.value !== undefined && typeof data.value !== "string")) {
        valid = false;
        errors.push({
          code: "component-data-invalid",
          message: `${label}（${id}）的 data.value 必须是逐位取值的字符串。`,
        });
      } else if (typeof data.value === "string") {
        inputValues[id] = data.value;
      }
    }
    let subcircuitData: SubcircuitComponentData | undefined;
    if (kind === "subcircuit") {
      subcircuitData = parseSubcircuitData(entry.data);
      if (subcircuitData === undefined) {
        valid = false;
        errors.push({
          code: "subcircuit-data-invalid",
          message: `${label}（${id}）的 data 必须包含非空 reference 与合法 cachedPorts。`,
        });
      }
    }
    // `data` 袋在其余类型上未定义（含未来类型），按未知数据容忍忽略。

    if (valid && displayName !== null && position !== null) {
      components.push({
        id,
        kind: kind as EditorComponent["kind"],
        displayName,
        position: { x: position.x, y: position.y },
        lifecycle: "active",
        ...(ports !== undefined ? { ports } : {}),
        ...(subcircuitData !== undefined ? { data: { subcircuit: subcircuitData } } : {}),
      });
    }
  }

  const connections: EditorConnection[] = [];
  const connectionIds = new Set<string>();
  for (const [index, entry] of rawConnections.entries()) {
    const label = `第 ${index + 1} 个连接记录`;
    if (!isRecord(entry)) {
      errors.push({ code: "connection-not-object", message: `${label}不是对象。` });
      continue;
    }
    const id = entry.id;
    if (!isNonEmptyString(id)) {
      errors.push({ code: "connection-id-invalid", message: `${label}缺少非空字符串的 id。` });
      continue;
    }
    if (connectionIds.has(id)) {
      errors.push({ code: "connection-id-duplicate", message: `${label}的 id 与前面的连接重复：${id}。` });
      continue;
    }
    connectionIds.add(id);

    let valid = true;
    const source = parseEndpointShape(entry.source);
    const target = parseEndpointShape(entry.target);
    if (source === null) {
      valid = false;
      errors.push({
        code: "connection-endpoint-invalid",
        message: `${label}（${id}）的 source 必须是含非空 component 与 port 的对象。`,
      });
    }
    if (target === null) {
      valid = false;
      errors.push({
        code: "connection-endpoint-invalid",
        message: `${label}（${id}）的 target 必须是含非空 component 与 port 的对象。`,
      });
    }
    let waypoints: Point[] | undefined;
    if (entry.waypoints !== undefined) {
      const rawWaypoints = Array.isArray(entry.waypoints) ? entry.waypoints : null;
      const points = rawWaypoints?.filter(isPointShape) ?? null;
      if (rawWaypoints === null || points === null || points.length !== rawWaypoints.length) {
        valid = false;
        errors.push({
          code: "connection-waypoints-invalid",
          message: `${label}（${id}）的 waypoints 必须是含有限数字 x、y 的点列表。`,
        });
      } else if (points.length > 0) {
        waypoints = points.map((point) => ({ x: point.x, y: point.y }));
      }
    }
    let color: WireColorId | undefined;
    if (entry.color !== undefined) {
      if (!isWireColorId(entry.color)) {
        valid = false;
        errors.push({
          code: "connection-color-invalid",
          message: `${label}（${id}）的 color ${describeValue(entry.color)} 不是已知的预设色。`,
        });
      } else {
        color = entry.color;
      }
    }
    if (source !== null && !componentIds.has(source.component)) {
      valid = false;
      errors.push({
        code: "connection-endpoint-unresolved",
        message: `${label}（${id}）的端点引用了文件里不存在的元件：${source.component}。`,
      });
    }
    if (target !== null && !componentIds.has(target.component)) {
      valid = false;
      errors.push({
        code: "connection-endpoint-unresolved",
        message: `${label}（${id}）的端点引用了文件里不存在的元件：${target.component}。`,
      });
    }

    if (valid && source !== null && target !== null) {
      // 端点 point 是占位零点，见 `ParsedProjectFile.document` 的契约说明。
      connections.push({
        id,
        source: { componentId: source.component, port: source.port, point: { x: 0, y: 0 } },
        target: { componentId: target.component, port: target.port, point: { x: 0, y: 0 } },
        lifecycle: "visible",
        danglingEndpoints: [],
        ...(waypoints !== undefined ? { waypoints } : {}),
        ...(color !== undefined ? { color } : {}),
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  const document = { components, connections } as unknown as EditorDocument;
  return {
    ok: true,
    value: {
      version,
      document,
      file: serializeProjectFile({ document, inputValues }),
      inputValues,
    },
  };
}

/** 连接只有渲染 Route、没有 Waypoint 投影时的语义回退；与会话移动元件时的推导是同一条规则。 */
function waypointsOfRoute(route: readonly Point[] | undefined): readonly Point[] {
  return route !== undefined && route.length > 2 ? route.slice(1, -1) : [];
}

function cloneFilePort(port: PortSpec): PortSpec {
  return {
    name: port.name,
    direction: port.direction,
    width: port.width,
    ...(port.bitRange ? { bitRange: { ...port.bitRange } } : {}),
  };
}

/** 检查元件类型是否在 v1 文件格式允许的清单内。 */
function fileKindIs(kind: string): kind is EditorComponentKind {
  return (FILE_KINDS as readonly string[]).includes(kind);
}

/** 检查元件类型是否为「端口清单必须进文件」的数据驱动元件。 */
function fileDataDrivenKindIs(kind: ComponentKindName): boolean {
  return FILE_DATA_DRIVEN_KINDS.includes(kind);
}

function serializeSubcircuitData(data: SubcircuitComponentData): ProjectFileComponentData {
  return {
    reference: data.reference,
    cachedPorts: data.cachedPorts.map(cloneFilePort),
    ...(data.portOrder !== undefined ? { portOrder: [...data.portOrder] } : {}),
  };
}

function parseSubcircuitData(value: unknown): SubcircuitComponentData | undefined {
  if (!isRecord(value) || !isNonEmptyString(value.reference) || !isFilePortList(value.cachedPorts)) return undefined;
  const cachedPorts = value.cachedPorts.map(cloneFilePort);
  if (value.portOrder === undefined) return { reference: value.reference, cachedPorts };
  if (!Array.isArray(value.portOrder) || !value.portOrder.every(isNonEmptyString)) return undefined;
  const names = new Set(cachedPorts.map((port) => port.name));
  const order = value.portOrder;
  if (new Set(order).size !== order.length || order.length !== names.size || order.some((name) => !names.has(name))) return undefined;
  return { reference: value.reference, cachedPorts, portOrder: [...order] };
}

function parseEndpointShape(value: unknown): { component: string; port: string } | null {
  if (!isRecord(value) || !isNonEmptyString(value.component) || !isNonEmptyString(value.port)) return null;
  return { component: value.component, port: value.port };
}

/**
 * 端口声明的形状检查，与 `@circuit-platform/protocol` 的 `isPortSpec` 同一形状。
 * 桌面测试不依赖协议包的构建产物，这里保留一份形状镜像；形状若有出入以协议包为准。
 */
function isFilePortList(value: unknown): value is readonly PortSpec[] {
  return Array.isArray(value) && value.every((entry): entry is PortSpec => {
    if (!isRecord(entry)) return false;
    if (typeof entry.name !== "string") return false;
    if (entry.direction !== "input" && entry.direction !== "output") return false;
    if (typeof entry.width !== "number" || !Number.isSafeInteger(entry.width) || entry.width < 1) return false;
    if (entry.bitRange === undefined) return true;
    return (
      isRecord(entry.bitRange) &&
      isNonNegativeInteger(entry.bitRange.msb) &&
      isNonNegativeInteger(entry.bitRange.lsb) &&
      entry.bitRange.msb >= entry.bitRange.lsb
    );
  });
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPointShape(value: unknown): value is { x: number; y: number } {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 把任意校验失败值缩写进展示文案，避免把大对象整段塞给用户。 */
function describeValue(value: unknown): string {
  if (typeof value === "string") return `「${value}」`;
  const text = String(value);
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}
