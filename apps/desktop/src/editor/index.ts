import type { ComponentKindName } from "@circuit-platform/protocol";

export type EditorComponentId = string;
export type EditorConnectionId = string;
export type EngineComponentId = number;
export type EngineConnectionId = number;

export interface Point {
  x: number;
  y: number;
}

export interface EditorComponent {
  id: EditorComponentId;
  kind: ComponentKindName;
  displayName: string;
  position: Point;
  lifecycle: "active" | "deleted";
}

export type EditorEndpointSide = "source" | "target";

export interface EditorEndpoint {
  componentId: EditorComponentId;
  port: string;
  point: Point;
}

export interface EditorConnection {
  id: EditorConnectionId;
  source: EditorEndpoint;
  target: EditorEndpoint;
  lifecycle: "visible" | "hidden" | "deleted";
  danglingEndpoints: readonly EditorEndpointSide[];
  hiddenReason?: "pending-operation";
}

export interface EditorDocument {
  components: readonly EditorComponent[];
  connections: readonly EditorConnection[];
}

/** 初始编辑器文档和当前 C++ 运行时绑定；绑定只在模块内部使用。 */
export interface EditorInitialState {
  document: EditorDocument;
  bindings: EditorBindings;
}

export interface EditorBindings {
  components: Readonly<Partial<Record<EditorComponentId, EngineComponentId>>>;
  connections: Readonly<Partial<Record<EditorConnectionId, EngineConnectionId>>>;
}

export interface EngineError {
  code: string;
  message: string;
  retryable: boolean;
}

export type EngineResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: EngineError };

/** 编辑器只依赖这组窄操作，协议字段和 Electron 通道由 adapter 隐藏。 */
export interface CircuitEnginePort {
  addComponent(
    kind: ComponentKindName,
  ): Promise<EngineResult<{ componentId: EngineComponentId }>>;
  addConnection(input: {
    sourceComponentId: EngineComponentId;
    sourcePort: string;
    targetComponentId: EngineComponentId;
    targetPort: string;
  }): Promise<EngineResult<{ connectionId: EngineConnectionId }>>;
  removeComponent(
    componentId: EngineComponentId,
  ): Promise<EngineResult<{ componentId: EngineComponentId }>>;
  removeConnection(
    connectionId: EngineConnectionId,
  ): Promise<EngineResult<{ connectionId: EngineConnectionId }>>;
}

export type EditorSelection =
  | { kind: "component"; id: EditorComponentId }
  | { kind: "connection"; id: EditorConnectionId }
  | null;

export type EditorCommand =
  | { type: "select"; selection: EditorSelection }
  | { type: "delete-selected" }
  | { type: "delete-component"; componentId: EditorComponentId }
  | { type: "delete-connection"; connectionId: EditorConnectionId }
  | { type: "undo" }
  | { type: "redo" };

export interface EditorSnapshot {
  document: EditorDocument;
  selection: EditorSelection;
  operation: "idle" | "busy" | "recovery-required";
  canUndo: boolean;
  canRedo: boolean;
  error: EngineError | null;
}

export type CommandResult =
  | { ok: true; snapshot: EditorSnapshot }
  | { ok: false; error: EngineError; snapshot: EditorSnapshot };

export interface EditorSession {
  /** 返回不包含任何 C++ engine ID 的编辑器快照。 */
  snapshot(): EditorSnapshot;
  /** 分发编辑器命令；并发结构命令会以稳定 busy 错误拒绝。 */
  dispatch(command: EditorCommand): Promise<CommandResult>;
  /** 订阅快照变化，并返回取消订阅函数。 */
  subscribe(listener: (snapshot: EditorSnapshot) => void): () => void;
}

export interface EditorSessionOptions {
  /** 结构提交后发布仍然有效的运行时绑定；仅供工作区组合层同步仿真身份。 */
  onBindingsChanged?(bindings: EditorBindings): void;
}

interface MutableDocument {
  components: Map<EditorComponentId, EditorComponent>;
  connections: Map<EditorConnectionId, EditorConnection>;
}

interface DeleteComponentFrame {
  type: "delete-component";
  componentId: EditorComponentId;
  selectionBefore: EditorSelection;
  kind: ComponentKindName;
  danglingConnectionIds: EngineConnectionId[];
  connectionPlans: Array<{
    id: EditorConnectionId;
    source: EditorConnection["source"];
    target: EditorConnection["target"];
  }>;
}

interface DeleteConnectionFrame {
  type: "delete-connection";
  connectionId: EditorConnectionId;
  selectionBefore: EditorSelection;
  source: EditorConnection["source"];
  target: EditorConnection["target"];
}

type HistoryFrame = DeleteComponentFrame | DeleteConnectionFrame;

const busyError: EngineError = {
  code: "editor_busy",
  message: "编辑器正在处理上一个操作。",
  retryable: true,
};

const noSelectionError: EngineError = {
  code: "nothing_selected",
  message: "没有选中的元件或连接。",
  retryable: false,
};

const recoveryError = (message: string): EngineError => ({
  code: "editor_recovery_required",
  message,
  retryable: true,
});

function cloneVisibleDocument(document: MutableDocument): EditorDocument {
  const isAttached = (componentId: EditorComponentId): boolean =>
    document.components.get(componentId)?.lifecycle === "active";
  return {
    components: [...document.components.values()]
      .filter((component) => component.lifecycle === "active")
      .map((component) => ({ ...component, position: { ...component.position } })),
    connections: [...document.connections.values()]
      .filter((connection) => connection.lifecycle === "visible")
      .map((connection) => ({
        ...connection,
        source: { ...connection.source, point: { ...connection.source.point } },
        target: { ...connection.target, point: { ...connection.target.point } },
        danglingEndpoints: [
          ...(!isAttached(connection.source.componentId) ? ["source" as const] : []),
          ...(!isAttached(connection.target.componentId) ? ["target" as const] : []),
        ],
      })),
  };
}

function toMutableDocument(document: EditorDocument): MutableDocument {
  return {
    components: new Map(
      document.components.map((component) => [
        component.id,
        { ...component, position: { ...component.position } },
      ]),
    ),
    connections: new Map(
      document.connections.map((connection) => [
        connection.id,
        {
          ...connection,
          source: { ...connection.source, point: { ...connection.source.point } },
          target: { ...connection.target, point: { ...connection.target.point } },
          danglingEndpoints: [...connection.danglingEndpoints],
        },
      ]),
    ),
  };
}

function cloneBindings(bindings: EditorBindings): {
  components: Partial<Record<EditorComponentId, EngineComponentId>>;
  connections: Partial<Record<EditorConnectionId, EngineConnectionId>>;
} {
  return {
    components: { ...bindings.components },
    connections: { ...bindings.connections },
  };
}

function normalizeThrown(error: unknown): EngineError {
  if (typeof error === "object" && error !== null) {
    const candidate = error as Partial<EngineError>;
    if (typeof candidate.code === "string" && typeof candidate.message === "string") {
      return {
        code: candidate.code,
        message: candidate.message,
        retryable: candidate.retryable ?? true,
      };
    }
  }
  return {
    code: "engine_operation_failed",
    message: error instanceof Error ? error.message : "仿真引擎操作失败。",
    retryable: true,
  };
}

function failed<T>(error: EngineError): EngineResult<T> {
  return { ok: false, error };
}

function notify(listeners: Set<(snapshot: EditorSnapshot) => void>, snapshot: EditorSnapshot): void {
  for (const listener of listeners) listener(snapshot);
}

function isAlreadyAbsent(error: EngineError): boolean {
  return error.code === "component_not_found" || error.code === "connection_not_found";
}

/** 创建固定 AND 示例的稳定编辑器文档，返回不包含引擎身份的初始可见结构。 */
export function createAndDemoDocument(): EditorDocument {
  return {
    components: [
      { id: "input-a", kind: "input", displayName: "输入 A", position: { x: 110, y: 100 }, lifecycle: "active" },
      { id: "input-b", kind: "input", displayName: "输入 B", position: { x: 110, y: 340 }, lifecycle: "active" },
      { id: "and-gate", kind: "and", displayName: "AND 门", position: { x: 440, y: 220 }, lifecycle: "active" },
      { id: "output", kind: "output", displayName: "输出", position: { x: 800, y: 240 }, lifecycle: "active" },
    ],
    connections: [
      { id: "wire-a", source: { componentId: "input-a", port: "out", point: { x: 210, y: 150 } }, target: { componentId: "and-gate", port: "in1", point: { x: 435, y: 250 } }, lifecycle: "visible", danglingEndpoints: [] },
      { id: "wire-b", source: { componentId: "input-b", port: "out", point: { x: 210, y: 405 } }, target: { componentId: "and-gate", port: "in2", point: { x: 435, y: 290 } }, lifecycle: "visible", danglingEndpoints: [] },
      { id: "wire-output", source: { componentId: "and-gate", port: "out", point: { x: 585, y: 270 } }, target: { componentId: "output", port: "in", point: { x: 805, y: 270 } }, lifecycle: "visible", danglingEndpoints: [] },
    ],
  };
}

function visibleSnapshot(
  document: MutableDocument,
  selection: EditorSelection,
  operation: EditorSnapshot["operation"],
  undoStack: readonly HistoryFrame[],
  redoStack: readonly HistoryFrame[],
  error: EngineError | null,
): EditorSnapshot {
  return {
    document: cloneVisibleDocument(document),
    selection: selection ? { ...selection } : null,
    operation,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    error: error ? { ...error } : null,
  };
}

function setComponentDeleted(document: MutableDocument, id: EditorComponentId): void {
  const component = document.components.get(id);
  if (!component) return;
  component.lifecycle = "deleted";
}

function restoreComponent(document: MutableDocument, id: EditorComponentId): void {
  const component = document.components.get(id);
  if (!component) return;
  component.lifecycle = "active";
}

/**
 * 创建编辑器深模块。
 * @param initial 固定示例或加载后的编辑器文档及初始引擎绑定。
 * @param engine 只负责元件/连接增删的异步引擎 seam。
 * @returns 只暴露稳定本地 ID 和编辑器命令的会话接口。
 */
export function createEditorSession(
  initial: EditorInitialState,
  engine: CircuitEnginePort,
  options: EditorSessionOptions = {},
): EditorSession {
  const document = toMutableDocument(initial.document);
  const bindings = cloneBindings(initial.bindings);
  const listeners = new Set<(snapshot: EditorSnapshot) => void>();
  const undoStack: HistoryFrame[] = [];
  const redoStack: HistoryFrame[] = [];
  let selection: EditorSelection = null;
  let operation: EditorSnapshot["operation"] = "idle";
  let error: EngineError | null = null;

  function isLiveConnection(connection: EditorConnection): boolean {
    return connection.lifecycle === "visible" &&
      document.components.get(connection.source.componentId)?.lifecycle === "active" &&
      document.components.get(connection.target.componentId)?.lifecycle === "active";
  }

  function publishBindings(): void {
    options.onBindingsChanged?.({
      components: Object.fromEntries(
        [...document.components.values()]
          .filter((component) => component.lifecycle === "active")
          .flatMap((component) => {
            const engineId = bindings.components[component.id];
            return engineId === undefined ? [] : [[component.id, engineId]];
          }),
      ),
      connections: Object.fromEntries(
        [...document.connections.values()]
          .filter(isLiveConnection)
          .flatMap((connection) => {
            const engineId = bindings.connections[connection.id];
            return engineId === undefined ? [] : [[connection.id, engineId]];
          }),
      ),
    });
  }

  function currentSnapshot(): EditorSnapshot {
    return visibleSnapshot(document, selection, operation, undoStack, redoStack, error);
  }

  function publish(): EditorSnapshot {
    const snapshot = currentSnapshot();
    notify(listeners, snapshot);
    return snapshot;
  }

  function fail(errorValue: EngineError): CommandResult {
    error = errorValue;
    operation = "idle";
    const snapshot = publish();
    return { ok: false, error: errorValue, snapshot };
  }

  function enterRecovery(errorValue: EngineError): CommandResult {
    error = errorValue;
    operation = "recovery-required";
    const snapshot = publish();
    return { ok: false, error: errorValue, snapshot };
  }

  function beginOperation(): boolean {
    if (operation !== "idle") return false;
    error = null;
    operation = "busy";
    publish();
    return true;
  }

  function finishOperation(): EditorSnapshot {
    operation = "idle";
    return publish();
  }

  function call<T>(action: () => Promise<EngineResult<T>>): Promise<EngineResult<T>> {
    return action().catch((thrown) => failed(normalizeThrown(thrown)));
  }

  function requireComponent(id: EditorComponentId): EditorComponent | null {
    const component = document.components.get(id);
    return component && component.lifecycle === "active" ? component : null;
  }

  function makeDeleteComponentFrame(componentId: EditorComponentId): DeleteComponentFrame | null {
    const component = requireComponent(componentId);
    if (!component) return null;
    const connectionPlans = [...document.connections.values()]
      .filter(
        (connection) =>
          isLiveConnection(connection) &&
          (connection.source.componentId === componentId || connection.target.componentId === componentId),
      )
      .map((connection) => ({
        id: connection.id,
        source: { ...connection.source, point: { ...connection.source.point } },
        target: { ...connection.target, point: { ...connection.target.point } },
      }));
    return {
      type: "delete-component",
      componentId,
      selectionBefore: selection ? { ...selection } : null,
      kind: component.kind,
      danglingConnectionIds: connectionPlans
        .map((connection) => bindings.connections[connection.id])
        .filter((id): id is EngineConnectionId => id !== undefined),
      connectionPlans,
    };
  }

  async function compensateNewComponent(
    componentId: EngineComponentId,
    connectionIds: readonly EngineConnectionId[],
  ): Promise<EngineError | null> {
    for (const connectionId of [...connectionIds].reverse()) {
      const removed = await call(() => engine.removeConnection(connectionId));
      if (!removed.ok && !isAlreadyAbsent(removed.error)) return removed.error;
    }
    const removedComponent = await call(() => engine.removeComponent(componentId));
    return removedComponent.ok || isAlreadyAbsent(removedComponent.error)
      ? null
      : removedComponent.error;
  }

  async function deleteComponent(frame: DeleteComponentFrame): Promise<CommandResult> {
    const componentEngineId = bindings.components[frame.componentId];
    if (componentEngineId === undefined) return fail(recoveryError("选中的元件没有有效引擎绑定。"));
    setComponentDeleted(document, frame.componentId);
    publish();

    const removed = await call(() => engine.removeComponent(componentEngineId));
    if (!removed.ok) {
      restoreComponent(document, frame.componentId);
      return fail(removed.error);
    }

    undoStack.push(frame);
    redoStack.length = 0;
    selection = null;
    publishBindings();
    return { ok: true, snapshot: finishOperation() };
  }

  async function deleteConnection(frame: DeleteConnectionFrame): Promise<CommandResult> {
    const connection = document.connections.get(frame.connectionId);
    if (!connection || connection.lifecycle === "deleted") return fail(noSelectionError);
    const connectionEngineId = bindings.connections[frame.connectionId];
    const wasLive = isLiveConnection(connection);
    connection.lifecycle = "hidden";
    connection.hiddenReason = "pending-operation";
    publish();

    if (connectionEngineId !== undefined) {
      const removed = await call(() => engine.removeConnection(connectionEngineId));
      if (!removed.ok) {
        connection.lifecycle = "visible";
        delete connection.hiddenReason;
        return fail(removed.error);
      }
      delete bindings.connections[frame.connectionId];
    } else if (wasLive) {
      connection.lifecycle = "visible";
      delete connection.hiddenReason;
      return fail(recoveryError("选中的有效连接没有引擎绑定。"));
    }

    connection.lifecycle = "deleted";
    delete connection.hiddenReason;
    undoStack.push(frame);
    redoStack.length = 0;
    selection = null;
    publishBindings();
    return { ok: true, snapshot: finishOperation() };
  }

  async function undoDeleteComponent(frame: DeleteComponentFrame): Promise<CommandResult> {
    const addedComponent = await call(() => engine.addComponent(frame.kind));
    if (!addedComponent.ok) return fail(addedComponent.error);
    const newComponentId = addedComponent.value.componentId;
    const newConnectionIds: EngineConnectionId[] = [];

    for (const connection of frame.connectionPlans) {
      const sourceComponentId =
        connection.source.componentId === frame.componentId
          ? newComponentId
          : bindings.components[connection.source.componentId];
      const targetComponentId =
        connection.target.componentId === frame.componentId
          ? newComponentId
          : bindings.components[connection.target.componentId];
      if (sourceComponentId === undefined || targetComponentId === undefined) {
        const compensationError = await compensateNewComponent(newComponentId, newConnectionIds);
        return compensationError
          ? enterRecovery(compensationError)
          : fail(recoveryError("撤销所需的连接端点没有有效引擎绑定。"));
      }

      const addedConnection = await call(() =>
        engine.addConnection({
          sourceComponentId,
          sourcePort: connection.source.port,
          targetComponentId,
          targetPort: connection.target.port,
        }),
      );
      if (!addedConnection.ok) {
        const compensationError = await compensateNewComponent(newComponentId, newConnectionIds);
        return compensationError
          ? enterRecovery(compensationError)
          : fail(addedConnection.error);
      }
      newConnectionIds.push(addedConnection.value.connectionId);
    }

    let removedOldConnection = false;
    for (const oldConnectionId of frame.danglingConnectionIds) {
      const removed = await call(() => engine.removeConnection(oldConnectionId));
      if (!removed.ok && !isAlreadyAbsent(removed.error)) {
        const compensationError = await compensateNewComponent(newComponentId, newConnectionIds);
        if (compensationError) return enterRecovery(compensationError);
        return removedOldConnection
          ? enterRecovery(recoveryError("清理旧悬空连接时只完成了部分操作，需要重新加载编辑器。"))
          : fail(removed.error);
      }
      removedOldConnection = true;
    }

    bindings.components[frame.componentId] = newComponentId;
    frame.connectionPlans.forEach((connection, index) => {
      bindings.connections[connection.id] = newConnectionIds[index];
    });
    restoreComponent(document, frame.componentId);
    selection = frame.selectionBefore;
    undoStack.pop();
    redoStack.push(frame);
    publishBindings();
    return { ok: true, snapshot: finishOperation() };
  }

  async function undoDeleteConnection(frame: DeleteConnectionFrame): Promise<CommandResult> {
    const connection = document.connections.get(frame.connectionId);
    if (!connection) return fail(recoveryError("撤销所需的连接不存在。"));
    const sourceActive = document.components.get(frame.source.componentId)?.lifecycle === "active";
    const targetActive = document.components.get(frame.target.componentId)?.lifecycle === "active";
    if (!sourceActive || !targetActive) {
      connection.lifecycle = "visible";
      delete connection.hiddenReason;
      delete bindings.connections[frame.connectionId];
      selection = frame.selectionBefore;
      undoStack.pop();
      redoStack.push(frame);
      publishBindings();
      return { ok: true, snapshot: finishOperation() };
    }
    const sourceComponentId = bindings.components[frame.source.componentId];
    const targetComponentId = bindings.components[frame.target.componentId];
    if (sourceComponentId === undefined || targetComponentId === undefined) {
      return fail(recoveryError("撤销所需的连接端点没有有效引擎绑定。"));
    }
    const added = await call(() =>
      engine.addConnection({
        sourceComponentId,
        sourcePort: frame.source.port,
        targetComponentId,
        targetPort: frame.target.port,
      }),
    );
    if (!added.ok) return fail(added.error);
    bindings.connections[frame.connectionId] = added.value.connectionId;
    connection.lifecycle = "visible";
    delete connection.hiddenReason;
    selection = frame.selectionBefore;
    undoStack.pop();
    redoStack.push(frame);
    publishBindings();
    return { ok: true, snapshot: finishOperation() };
  }

  async function undo(): Promise<CommandResult> {
    const frame = undoStack[undoStack.length - 1];
    if (!frame) return fail({ code: "nothing_to_undo", message: "没有可撤销的操作。", retryable: false });
    if (frame.type === "delete-component") return undoDeleteComponent(frame);
    return undoDeleteConnection(frame);
  }

  async function redo(): Promise<CommandResult> {
    const frame = redoStack[redoStack.length - 1];
    if (!frame) return fail({ code: "nothing_to_redo", message: "没有可重做的操作。", retryable: false });
    const remainingRedo = redoStack.slice(0, -1);
    if (frame.type === "delete-component") {
      const refreshed = makeDeleteComponentFrame(frame.componentId);
      if (!refreshed) return fail(recoveryError("重做所需的元件不存在。"));
      const result = await deleteComponent(refreshed);
      if (result.ok) redoStack.push(...remainingRedo);
      return result;
    }
    const connection = document.connections.get(frame.connectionId);
    if (!connection) return fail(recoveryError("重做所需的连接不存在。"));
    const result = await deleteConnection({
      ...frame,
      source: { ...connection.source },
      target: { ...connection.target },
    });
    if (result.ok) redoStack.push(...remainingRedo);
    return result;
  }

  async function dispatch(command: EditorCommand): Promise<CommandResult> {
    if (operation === "recovery-required") {
      const errorValue = error ?? recoveryError("编辑器需要重新加载后才能继续结构编辑。");
      return { ok: false, error: errorValue, snapshot: currentSnapshot() };
    }
    if (operation === "busy") {
      return { ok: false, error: busyError, snapshot: currentSnapshot() };
    }
    if (!beginOperation()) return { ok: false, error: busyError, snapshot: currentSnapshot() };

    if (command.type === "select") {
      selection = command.selection;
      return { ok: true, snapshot: finishOperation() };
    }
    if (command.type === "undo") return undo();
    if (command.type === "redo") return redo();
    if (command.type === "delete-selected") {
      if (!selection) return fail(noSelectionError);
      if (selection.kind === "component") {
        const frame = makeDeleteComponentFrame(selection.id);
        if (!frame) return fail(noSelectionError);
        return deleteComponent(frame);
      }
      const connection = document.connections.get(selection.id);
      if (!connection) return fail(noSelectionError);
      return deleteConnection({
        type: "delete-connection",
        connectionId: selection.id,
        selectionBefore: { ...selection },
        source: { ...connection.source },
        target: { ...connection.target },
      });
    }
    if (command.type === "delete-component") {
      const frame = makeDeleteComponentFrame(command.componentId);
      if (!frame) return fail(noSelectionError);
      return deleteComponent(frame);
    }
    const connection = document.connections.get(command.connectionId);
    if (!connection) return fail(noSelectionError);
    return deleteConnection({
      type: "delete-connection",
      connectionId: command.connectionId,
      selectionBefore: selection ? { ...selection } : null,
      source: { ...connection.source },
      target: { ...connection.target },
    });
  }

  publishBindings();
  return {
    snapshot: currentSnapshot,
    dispatch,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
