/**
 * 一个信号值的逐位文本：每一位取 `0` / `1` / `X`，长度等于所在端口的位宽。
 *
 * 这里是宽 `string` 而不是字面量联合：位宽让合法取值的集合不再有限，协议只保证形状与
 * 逐位字符，真正的校验在引擎与 `isSignal` 里。需要编译期约束的前端内部类型另用更窄的联合。
 */
export type Signal = string;

/** 端口方向。 */
export type PortDirection = "input" | "output";

/** 位区间：端口在其宿主元件的那条多位端口上占据的连续位范围，两端都包含。 */
export interface BitRange {
  msb: number;
  lsb: number;
}

/**
 * 一个端口的声明。位宽与位区间的唯一权威来源是引擎：`add_component` 可以携带这份清单，
 * `component_added` 与 `port_width_set` 回传该 Component 实际的清单，前端不再内置一份
 * 无人校验的副本。位宽为 1 且没有位区间的端口与引入位宽之前完全等价。
 */
export interface PortSpec {
  name: string;
  direction: PortDirection;
  /** 位宽，至少为 1。 */
  width: number;
  /** 可选的位区间；省略表示这个端口不落在某条宿主总线的某一段上。 */
  bitRange?: BitRange;
}

/** 电路中一个输出端口的当前信号；`ticked` 用它一次带回全部读数。 */
export interface SignalSnapshot {
  componentId: number;
  port: string;
  value: Signal;
}

export type ComponentKindName =
  | "input"
  | "output"
  | "and"
  | "or"
  | "nand"
  | "nor"
  | "xor"
  | "xnor"
  | "not"
  | "clock"
  | "d_flip_flop"
  /** 拆线器：一条多位输入按位区间拆成若干条分支输出。端口清单由前端生成。 */
  | "splitter"
  /** 合线器：若干条位区间输入按位区间合并成一条多位输出。端口清单由前端生成。 */
  | "merger";

export interface HealthCheckRequest {
  type: "health_check";
  requestId: string;
}

export interface HealthCheckResponse {
  type: "health_check_result";
  requestId: string;
  status: "ok";
  engine: string;
}

export interface ComponentAddedResponse {
  type: "component_added";
  requestId: string;
  componentId: number;
  /** 该 Component 实际的端口清单；省略请求里的清单时就是引擎回退到的内置定义。 */
  ports: readonly PortSpec[];
}

export interface ConnectionAddedResponse {
  type: "connection_added";
  requestId: string;
  connectionId: number;
}

export interface ComponentRemovedResponse {
  type: "component_removed";
  requestId: string;
  componentId: number;
}

export interface ConnectionRemovedResponse {
  type: "connection_removed";
  requestId: string;
  connectionId: number;
}

export interface InputSetResponse {
  type: "input_set";
  requestId: string;
}

export interface SettledResponse {
  type: "settled";
  requestId: string;
  status: "ok";
}

export interface TickedResponse {
  type: "ticked";
  requestId: string;
  /** 本次推进之后的累计步数。 */
  step: number;
  /** 电路中每一个输出端口的当前值；接收端由前端沿 Connection 推导。 */
  signals: readonly SignalSnapshot[];
}

export interface AddComponentRequest {
  type: "add_component";
  requestId: string;
  kind: ComponentKindName;
  /**
   * 可选的端口清单；省略时引擎回退到内置定义。
   * 前端只在数据驱动的元件上才自己生成清单，内置类型一律省略，否则就重建了本字段要消灭的第二份定义。
   */
  ports?: readonly PortSpec[];
}

export interface SetPortWidthRequest {
  type: "set_port_width";
  requestId: string;
  componentId: number;
  /**
   * 替换后的**整份**端口清单，与 `add_component` 的可选清单同构。
   * 整体替换而不是按端口下发：改一个分支的位区间会让其余分支必须重算，按单端口的形状表达不出一次合法的整体变更。
   */
  ports: readonly PortSpec[];
}

export interface AddConnectionRequest {
  type: "add_connection";
  requestId: string;
  sourceComponentId: number;
  sourcePort: string;
  targetComponentId: number;
  targetPort: string;
}

export interface RemoveComponentRequest {
  type: "remove_component";
  requestId: string;
  componentId: number;
}

export interface RemoveConnectionRequest {
  type: "remove_connection";
  requestId: string;
  connectionId: number;
}

export interface SetInputRequest {
  type: "set_input";
  requestId: string;
  componentId: number;
  value: Signal;
}

export interface SettleRequest {
  type: "settle";
  requestId: string;
}

export interface TickRequest {
  type: "tick";
  requestId: string;
}

export interface ResetRequest {
  type: "reset";
  requestId: string;
}

export interface ResetDoneResponse {
  type: "reset_done";
  requestId: string;
  status: "ok";
}

export interface GetSignalRequest {
  type: "get_signal";
  requestId: string;
  componentId: number;
  port: string;
}

export type EngineRequest =
  | HealthCheckRequest
  | AddComponentRequest
  | SetPortWidthRequest
  | AddConnectionRequest
  | RemoveComponentRequest
  | RemoveConnectionRequest
  | SetInputRequest
  | SettleRequest
  | TickRequest
  | ResetRequest
  | GetSignalRequest;

export interface ErrorResponse {
  type: "error";
  requestId: string;
  code: string;
  message: string;
}

export interface PortWidthSetResponse {
  type: "port_width_set";
  requestId: string;
  componentId: number;
  /** 替换后的端口清单，与 `component_added` 同一结构。 */
  ports: readonly PortSpec[];
  /**
   * 因**本次改宽**而转为悬空的 Connection 身份，即改宽前不悬空、改宽后悬空的那些。
   * 改宽前就因为端点缺失而悬空的连接不在其中；改宽后重新匹配、恢复有效的连接同样不在其中。
   */
  danglingConnectionIds: readonly number[];
}

export interface SignalResponse {
  type: "signal_result";
  requestId: string;
  value: Signal;
}

export type EngineResponse =
  | HealthCheckResponse
  | ComponentAddedResponse
  | ConnectionAddedResponse
  | ComponentRemovedResponse
  | ConnectionRemovedResponse
  | InputSetResponse
  | SettledResponse
  | TickedResponse
  | ResetDoneResponse
  | PortWidthSetResponse
  | SignalResponse
  | ErrorResponse;

/**
 * 创建发送给 C++ 引擎的健康检查请求。
 * @param requestId 用于匹配请求和响应的调用方身份。
 * @returns 一个可发送给引擎的健康检查请求。
 */
export function createHealthCheck(requestId: string): HealthCheckRequest {
  return {
    type: "health_check",
    requestId,
  };
}

/**
 * 创建删除 Component 的请求。
 * @param requestId 用于匹配请求和响应的调用方身份。
 * @param componentId 要删除的 Component 身份。
 * @returns 一个可发送给 C++ 引擎的删除 Component 请求。
 */
export function createRemoveComponent(
  requestId: string,
  componentId: number,
): RemoveComponentRequest {
  return {
    type: "remove_component",
    requestId,
    componentId,
  };
}

/**
 * 创建删除 Connection 的请求。
 * @param requestId 用于匹配请求和响应的调用方身份。
 * @param connectionId 要删除的 Connection 身份。
 * @returns 一个可发送给 C++ 引擎的删除 Connection 请求。
 */
export function createRemoveConnection(
  requestId: string,
  connectionId: number,
): RemoveConnectionRequest {
  return {
    type: "remove_connection",
    requestId,
    connectionId,
  };
}

/**
 * 创建推进仿真一个 tick 的请求。
 * @param requestId 用于匹配请求和响应的调用方身份。
 * @returns 一个可发送给 C++ 引擎的推进请求。
 */
export function createTick(requestId: string): TickRequest {
  return {
    type: "tick",
    requestId,
  };
}

/**
 * 创建把仿真恢复到初始状态的重置请求。
 * @param requestId 用于匹配请求和响应的调用方身份。
 * @returns 一个可发送给 C++ 引擎的重置请求。
 */
export function createReset(requestId: string): ResetRequest {
  return {
    type: "reset",
    requestId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRequestWithType(value: unknown, type: string): value is Record<string, unknown> {
  return isRecord(value) && value.type === type && typeof value.requestId === "string";
}

function isValidId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * 判断未知值是否为删除 Component 请求。
 * @param value 待检查的未知值。
 * @returns 当 value 包含有效的请求身份和 Component 身份时返回 true。
 */
export function isRemoveComponentRequest(value: unknown): value is RemoveComponentRequest {
  return isRequestWithType(value, "remove_component") && isValidId(value.componentId);
}

/**
 * 判断未知值是否为删除 Connection 请求。
 * @param value 待检查的未知值。
 * @returns 当 value 包含有效的请求身份和 Connection 身份时返回 true。
 */
export function isRemoveConnectionRequest(value: unknown): value is RemoveConnectionRequest {
  return isRequestWithType(value, "remove_connection") && isValidId(value.connectionId);
}

/**
 * 判断未知值是否为删除 Component 的成功响应。
 * @param value 待检查的未知值。
 * @returns 当 value 是带有 Component 身份的删除成功响应时返回 true。
 */
export function isComponentRemovedResponse(value: unknown): value is ComponentRemovedResponse {
  return isRequestWithType(value, "component_removed") && isValidId(value.componentId);
}

/**
 * 判断未知值是否为删除 Connection 的成功响应。
 * @param value 待检查的未知值。
 * @returns 当 value 是带有 Connection 身份的删除成功响应时返回 true。
 */
export function isConnectionRemovedResponse(value: unknown): value is ConnectionRemovedResponse {
  return isRequestWithType(value, "connection_removed") && isValidId(value.connectionId);
}

/**
 * 创建替换一个 Component 端口清单的请求。
 * @param requestId 用于匹配请求和响应的调用方身份。
 * @param componentId 要替换端口清单的 Component 身份。
 * @param ports 替换后的整份端口清单。
 * @returns 一个可发送给 C++ 引擎的改宽请求。
 */
export function createSetPortWidth(
  requestId: string,
  componentId: number,
  ports: readonly PortSpec[],
): SetPortWidthRequest {
  return {
    type: "set_port_width",
    requestId,
    componentId,
    ports,
  };
}

/**
 * 判断未知值是否属于项目当前支持的信号值。
 * @param value 待检查的未知值。
 * @returns 当 value 是非空且只含 `0` / `1` / `X` 的字符串时返回 true。
 */
export function isSignal(value: unknown): value is Signal {
  return typeof value === "string" && /^[01X]+$/.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * 判断未知值是否为一份合法的位区间。
 * @param value 待检查的未知值。
 * @returns 当 value 是两个非负整数且 `msb >= lsb` 时返回 true。
 */
export function isBitRange(value: unknown): value is BitRange {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.msb) &&
    isNonNegativeInteger(value.lsb) &&
    value.msb >= value.lsb
  );
}

/**
 * 判断未知值是否为一份合法的端口声明。
 * @param value 待检查的未知值。
 * @returns 当 value 带有端口名、方向、至少为 1 的位宽与可选的合法位区间时返回 true。
 */
export function isPortSpec(value: unknown): value is PortSpec {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    (value.direction === "input" || value.direction === "output") &&
    typeof value.width === "number" &&
    Number.isSafeInteger(value.width) &&
    value.width >= 1 &&
    (value.bitRange === undefined || isBitRange(value.bitRange))
  );
}

/**
 * 判断未知值是否为一份合法的端口清单。
 * @param value 待检查的未知值。
 * @returns 当 value 是数组且每一项都是合法的端口声明时返回 true。
 */
export function isPortList(value: unknown): value is readonly PortSpec[] {
  return Array.isArray(value) && value.every(isPortSpec);
}

/**
 * 判断未知值是否为添加 Component 的成功响应。
 * @param value 待检查的未知值。
 * @returns 当 value 带有 Component 身份与该元件实际的端口清单时返回 true。
 */
export function isComponentAddedResponse(value: unknown): value is ComponentAddedResponse {
  return isRequestWithType(value, "component_added") && isValidId(value.componentId) && isPortList(value.ports);
}

/**
 * 判断未知值是否为替换端口清单的成功响应。
 * @param value 待检查的未知值。
 * @returns 当 value 带有 Component 身份、替换后的端口清单与悬空连接身份列表时返回 true。
 */
export function isPortWidthSetResponse(value: unknown): value is PortWidthSetResponse {
  return (
    isRequestWithType(value, "port_width_set") &&
    isValidId(value.componentId) &&
    isPortList(value.ports) &&
    Array.isArray(value.danglingConnectionIds) &&
    value.danglingConnectionIds.every(isValidId)
  );
}

function isSignalSnapshot(value: unknown): value is SignalSnapshot {
  return (
    isRecord(value) &&
    isValidId(value.componentId) &&
    typeof value.port === "string" &&
    isSignal(value.value)
  );
}

/**
 * 判断未知值是否为一次推进的响应。
 * @param value 待检查的未知值。
 * @returns 当 value 带有非负步数和全部合法的输出端口快照时返回 true。
 */
export function isTickedResponse(value: unknown): value is TickedResponse {
  return (
    isRequestWithType(value, "ticked") &&
    typeof value.step === "number" &&
    Number.isSafeInteger(value.step) &&
    value.step >= 0 &&
    Array.isArray(value.signals) &&
    value.signals.every(isSignalSnapshot)
  );
}

/**
 * 判断未知值是否为一次重置的成功响应。
 * @param value 待检查的未知值。
 * @returns 当 value 是带有成功状态的重置响应时返回 true。
 */
export function isResetDoneResponse(value: unknown): value is ResetDoneResponse {
  return isRequestWithType(value, "reset_done") && value.status === "ok";
}
