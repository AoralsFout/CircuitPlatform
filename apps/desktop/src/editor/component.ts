import type { ComponentKindName, PortSpec } from "@circuit-platform/protocol";

/** 编辑器可以展示的元件类型；`subcircuit` 只存在于渲染层，不会进入引擎协议。 */
export type EditorComponentKind = ComponentKindName | "subcircuit";

/** 层次元件的可见解析状态。 */
export type SubcircuitStatus = "resolved" | "unresolved" | "resolving";

/** 层次解析失败的稳定类别与中文展示文案。 */
export interface SubcircuitDiagnostic {
  code: string;
  message: string;
  /** 从顶层 Project 到失败目标的可展示引用链。 */
  chain?: readonly string[];
}

/** Subcircuit 保存在 EditorComponent 上的类型数据。 */
export interface SubcircuitComponentData {
  /** 文件中保存的原始相对引用。 */
  reference: string;
  /** 最近一次采用的有序缓存接口。 */
  cachedPorts: readonly PortSpec[];
  /** 可选的完整、无重复 Port 名顺序。 */
  portOrder?: readonly string[];
  /** 运行时解析状态；未落盘的会话信息不参与序列化。 */
  status?: SubcircuitStatus;
  /** 运行时规范化目标身份；不参与序列化。 */
  targetIdentity?: string;
  /** 运行时诊断；不参与序列化。 */
  diagnostic?: SubcircuitDiagnostic;
}

/** 编辑器元件按类型扩展的数据；当前只有 Subcircuit 使用。 */
export interface EditorComponentData {
  subcircuit?: SubcircuitComponentData;
}
