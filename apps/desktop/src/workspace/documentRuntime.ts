import {
  createEditorSession,
  type CircuitEnginePort,
  type EditorCommand,
  type EditorInitialState,
  type EditorSelection,
  type EditorSession,
  type EditorSnapshot,
  type EditorBindings,
} from "../editor/index.ts";
import { createProtocolEnginePort } from "../editor/protocolEnginePort.ts";
import { createViewportState, type ViewportState } from "../canvas/viewport.ts";
import { projectDisplayName } from "../project-file/recent-projects.ts";
import { projectPathIdentity } from "../project-file/paths.ts";
import { createEngineCallQueue, type EngineCallQueue } from "./engineQueue.ts";
import {
  createWorkspace,
  type CircuitDocument,
  type EngineAdapter,
  type InputBit,
  type InputKey,
  type OpenCircuitOptions,
  type TickScheduler,
  type Workspace,
  type WorkspaceSnapshot,
} from "./index.ts";

/** 项目文件操作中需要由界面显示确认的动作。 */
export type PendingFileAction = "open" | "new" | "load-example";

/** 文档运行时持有的项目身份与保存/打开状态；这些状态不会进入项目文件。 */
export interface DocumentProjectState {
  /** 已保存项目的原始路径；未保存文档为 null。 */
  path: string | null;
  /** 用于标签和顶栏的名称；未保存文档由运行时工厂分配临时名称。 */
  displayName: string;
  /** 该文档的稳定身份；保存后从临时身份切换为路径身份。 */
  identity: string;
  isDirty: boolean;
  saveError: string | null;
  openError: string | null;
  pendingFileAction: PendingFileAction | null;
}

/** 只属于一份文档的观看状态，不会写入 Project 或 EditorSession 历史。 */
export interface DocumentViewState {
  viewport: ViewportState;
  selection: EditorSelection;
  activeRailPage: "components" | "inputs" | "layers" | "settings";
  bottomTab: "inspector" | "outputs" | "waveform";
}

/** Vue 和多文档协调器消费的运行时只读快照；不含任何引擎 ID 或协议响应。 */
export interface DocumentRuntimeSnapshot {
  /** 运行时实例身份，在未保存文档中也保持唯一。 */
  runtimeId: string;
  /** 销毁后为 false；销毁本身不清除最后一份可展示快照。 */
  active: boolean;
  workspace: WorkspaceSnapshot;
  editor: EditorSnapshot | null;
  project: DocumentProjectState;
  view: DocumentViewState;
}

/** 创建运行时所需的依赖；生产环境传入一个 Electron EngineAdapter，测试可传 fake。 */
export interface DocumentRuntimeOptions {
  /** 引擎 adapter；已传入 workspace 时可以省略。 */
  adapter?: EngineAdapter;
  /** 已构造的工作区；主要用于协调器或测试替换工作区 seam。 */
  workspace?: Workspace;
  /** EditorSession 的测试替身；未传入时由 initialEditor 创建。 */
  editor?: EditorSession;
  /** 要在运行时中创建的编辑器初始文档；不传表示首启尚无文档。 */
  initialEditor?: EditorInitialState;
  /** 自定义结构端口；省略时由 adapter 和共享队列创建。 */
  editorEngine?: CircuitEnginePort;
  /** 工作区与 EditorSession 共用的单文档引擎调用队列。 */
  queue?: EngineCallQueue;
  /** 连续推进调度器；传给新建工作区。 */
  scheduler?: TickScheduler;
  /** 项目状态初值；路径身份按现有路径规则规范化。 */
  project?: Partial<Pick<DocumentProjectState, "path" | "displayName" | "isDirty" | "saveError" | "openError" | "pendingFileAction">>;
  /** 视图状态初值；每次工厂调用都会复制一份。 */
  view?: Partial<DocumentViewState>;
  /** 未保存文档的展示序号；通常由协调器按打开顺序传入。 */
  temporaryName?: string;
  /** 运行时身份；省略时由工厂分配。 */
  runtimeId?: string;
}

/** 面向协调器的窄运行时接口；调用方不需要接触 Workspace 的引擎绑定或协议响应。 */
export interface DocumentRuntime {
  snapshot(): DocumentRuntimeSnapshot;
  subscribe(listener: (snapshot: DocumentRuntimeSnapshot) => void): () => void;
  checkEngine(): Promise<DocumentRuntimeSnapshot>;
  loadCircuit(document: CircuitDocument, options?: OpenCircuitOptions): Promise<DocumentRuntimeSnapshot>;
  openCircuit(document: CircuitDocument, options?: OpenCircuitOptions): Promise<DocumentRuntimeSnapshot>;
  rebuildCircuit(document: CircuitDocument): Promise<DocumentRuntimeSnapshot>;
  refreshReadings(): Promise<DocumentRuntimeSnapshot>;
  start(): Promise<DocumentRuntimeSnapshot>;
  pause(): Promise<DocumentRuntimeSnapshot>;
  resume(): Promise<DocumentRuntimeSnapshot>;
  step(): Promise<DocumentRuntimeSnapshot>;
  reset(): Promise<DocumentRuntimeSnapshot>;
  setInputBit(key: InputKey, index: number, bit: InputBit): Promise<DocumentRuntimeSnapshot>;
  dispatchEditor(command: EditorCommand): Promise<EditorSnapshot | null>;
  setProjectPath(path: string | null): DocumentRuntimeSnapshot;
  setDirty(isDirty: boolean): DocumentRuntimeSnapshot;
  setSaveError(message: string | null): DocumentRuntimeSnapshot;
  setOpenError(message: string | null): DocumentRuntimeSnapshot;
  setPendingFileAction(action: PendingFileAction | null): DocumentRuntimeSnapshot;
  setViewport(viewport: ViewportState): DocumentRuntimeSnapshot;
  setSelection(selection: EditorSelection): Promise<DocumentRuntimeSnapshot>;
  setActiveRailPage(page: DocumentViewState["activeRailPage"]): DocumentRuntimeSnapshot;
  setBottomTab(tab: DocumentViewState["bottomTab"]): DocumentRuntimeSnapshot;
  /** 取消连续运行、释放订阅，并使所有迟到的异步结果失效。 */
  destroy(): void;
  /** destroy 的生命周期别名，供协调器按资源语义释放运行时。 */
  dispose(): void;
}

let nextRuntimeSequence = 1;

function cloneViewport(viewport: ViewportState): ViewportState {
  return {
    x: viewport.x,
    y: viewport.y,
    zoom: viewport.zoom,
    visibleRect: { ...viewport.visibleRect },
  };
}

function cloneProject(project: DocumentProjectState): DocumentProjectState {
  return { ...project };
}

function cloneView(view: DocumentViewState): DocumentViewState {
  return { ...view, viewport: cloneViewport(view.viewport), selection: view.selection ? { ...view.selection } : null };
}

function temporaryIdentity(runtimeId: string): string {
  return `temporary:${runtimeId}`;
}

function projectStateOf(
  runtimeId: string,
  options: DocumentRuntimeOptions,
): DocumentProjectState {
  const path = options.project?.path ?? null;
  const displayName = options.project?.displayName ?? (path ? projectDisplayName(path) : options.temporaryName ?? `未命名 ${runtimeId}`);
  return {
    path,
    displayName,
    identity: path ? projectPathIdentity(path) : temporaryIdentity(runtimeId),
    isDirty: options.project?.isDirty ?? false,
    saveError: options.project?.saveError ?? null,
    openError: options.project?.openError ?? null,
    pendingFileAction: options.project?.pendingFileAction ?? null,
  };
}

function viewStateOf(options: DocumentRuntimeOptions): DocumentViewState {
  return {
    viewport: cloneViewport(options.view?.viewport ?? createViewportState()),
    selection: options.view?.selection ? { ...options.view.selection } : null,
    activeRailPage: options.view?.activeRailPage ?? "components",
    bottomTab: options.view?.bottomTab ?? "outputs",
  };
}

/**
 * 创建一份独立文档运行时。
 *
 * 每次调用都创建新的 Workspace、EditorSession、引擎调用队列、项目状态和视图状态；只有
 * 调用方显式传入的 adapter 或 scheduler 是共享的。EditorSession 与 Workspace 复用同一条
 * 队列，保证一份文档的结构提交、输入和 tick 不会交错；不同运行时绝不会共用默认队列。
 * @param options 运行时依赖与初始状态。
 * @returns 只暴露编辑器命令、仿真命令和只读快照的运行时。
 * @throws 未传入 workspace 且未传入 adapter 时抛出配置错误。
 */
export function createDocumentRuntime(options: DocumentRuntimeOptions): DocumentRuntime {
  const runtimeId = options.runtimeId ?? `document-${nextRuntimeSequence++}`;
  const queue = options.queue ?? createEngineCallQueue();
  const workspace = options.workspace ?? (options.adapter
    ? createWorkspace(options.adapter, { queue, scheduler: options.scheduler })
    : null);
  if (workspace === null) throw new Error("创建文档运行时需要 EngineAdapter 或 Workspace。");

  const initialEditorEngine = options.editorEngine ?? (options.adapter ? createProtocolEnginePort(options.adapter, queue) : null);
  if (options.initialEditor && options.editor === undefined && initialEditorEngine === null) {
    throw new Error("创建初始 EditorSession 需要 CircuitEnginePort 或 EngineAdapter。");
  }
  let editor = options.editor ?? (
    options.initialEditor
      ? createEditorSession(
        options.initialEditor,
        initialEditorEngine!,
      )
      : null
  );
  let destroyed = false;
  let editorUnsubscribe: (() => void) | null = null;
  let workspaceUnsubscribe: (() => void) | null = null;
  let project = projectStateOf(runtimeId, options);
  const temporaryDisplayName = options.temporaryName ?? `未命名 ${runtimeId}`;
  let view = viewStateOf(options);
  let workspaceSnapshot = workspace.snapshot();
  let editorSnapshot = editor?.snapshot() ?? null;
  const listeners = new Set<(snapshot: DocumentRuntimeSnapshot) => void>();

  function snapshot(): DocumentRuntimeSnapshot {
    return {
      runtimeId,
      active: !destroyed,
      workspace: workspaceSnapshot,
      editor: editorSnapshot,
      project: cloneProject(project),
      view: cloneView(view),
    };
  }

  function publish(): DocumentRuntimeSnapshot {
    const next = snapshot();
    if (!destroyed) for (const listener of [...listeners]) listener(next);
    return next;
  }

  function syncEditor(next: EditorSnapshot): void {
    if (destroyed) return;
    editorSnapshot = next;
    view = { ...view, selection: next.selection ? { ...next.selection } : null };
    publish();
  }

  function attachEditor(next: EditorSession | null): void {
    editorUnsubscribe?.();
    editorUnsubscribe = null;
    editor = next;
    editorSnapshot = next?.snapshot() ?? null;
    if (editorSnapshot) view = { ...view, selection: editorSnapshot.selection ? { ...editorSnapshot.selection } : null };
    if (next) editorUnsubscribe = next.subscribe(syncEditor);
  }

  attachEditor(editor);
  workspaceUnsubscribe = workspace.subscribe((next) => {
    if (destroyed) return;
    workspaceSnapshot = next;
    publish();
  });

  async function runWorkspace(operation: () => Promise<WorkspaceSnapshot>): Promise<DocumentRuntimeSnapshot> {
    if (destroyed) return snapshot();
    const result = await operation();
    if (destroyed) return snapshot();
    workspaceSnapshot = result;
    return publish();
  }

  async function runCircuitLoad(
    operation: () => Promise<Awaited<ReturnType<Workspace["loadCircuit"]>>>,
  ): Promise<DocumentRuntimeSnapshot> {
    if (destroyed) return snapshot();
    const result = await operation();
    if (destroyed) return snapshot();
    workspaceSnapshot = result.snapshot;
    // 绑定只在运行时内部流转；Vue 只收到 EditorSnapshot，不会看到 Engine ID。
    if (result.bindings !== null && editor !== null) {
      editor.adoptBindings(result.bindings as EditorBindings);
      editorSnapshot = editor.snapshot();
      view = { ...view, selection: editorSnapshot.selection ? { ...editorSnapshot.selection } : null };
    }
    return publish();
  }

  async function dispatchEditor(command: EditorCommand): Promise<EditorSnapshot | null> {
    if (destroyed || editor === null) return editorSnapshot;
    const result = await editor.dispatch(command);
    if (!destroyed) syncEditor(result.snapshot);
    return destroyed ? editorSnapshot : result.snapshot;
  }

  const runtime: DocumentRuntime = {
    snapshot,
    subscribe(listener) {
      if (destroyed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    checkEngine: () => runWorkspace(() => workspace.checkEngine()),
    loadCircuit: (document) => runCircuitLoad(() => workspace.loadCircuit(document)),
    openCircuit: (document, openOptions) => runCircuitLoad(() => workspace.openCircuit(document, openOptions)),
    rebuildCircuit: (document) => runCircuitLoad(() => workspace.rebuildCircuit(document)),
    refreshReadings: () => runWorkspace(() => workspace.refreshReadings()),
    start: () => runWorkspace(() => workspace.start()),
    pause: () => runWorkspace(() => workspace.pause()),
    resume: () => runWorkspace(() => workspace.resume()),
    step: () => runWorkspace(() => workspace.step()),
    reset: () => runWorkspace(() => workspace.reset()),
    setInputBit: (key, index, bit) => runWorkspace(() => workspace.setInputBit(key, index, bit)),
    dispatchEditor,
    setProjectPath(path) {
      if (destroyed) return snapshot();
      project = {
        ...project,
        path,
        identity: path ? projectPathIdentity(path) : project.identity.startsWith("temporary:") ? project.identity : temporaryIdentity(runtimeId),
        displayName: path ? projectDisplayName(path) : temporaryDisplayName,
      };
      return publish();
    },
    setDirty(isDirty) {
      if (destroyed) return snapshot();
      project = { ...project, isDirty };
      return publish();
    },
    setSaveError(message) {
      if (destroyed) return snapshot();
      project = { ...project, saveError: message };
      return publish();
    },
    setOpenError(message) {
      if (destroyed) return snapshot();
      project = { ...project, openError: message };
      return publish();
    },
    setPendingFileAction(action) {
      if (destroyed) return snapshot();
      project = { ...project, pendingFileAction: action };
      return publish();
    },
    setViewport(next) {
      if (destroyed) return snapshot();
      view = { ...view, viewport: cloneViewport(next) };
      return publish();
    },
    async setSelection(selection) {
      if (destroyed) return snapshot();
      if (editor !== null) {
        await dispatchEditor({ type: "select", selection });
        return snapshot();
      }
      view = { ...view, selection: selection ? { ...selection } : null };
      return publish();
    },
    setActiveRailPage(page) {
      if (destroyed) return snapshot();
      view = { ...view, activeRailPage: page };
      return publish();
    },
    setBottomTab(tab) {
      if (destroyed) return snapshot();
      view = { ...view, bottomTab: tab };
      return publish();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      // pause 的同步前半段会取消下一次调度；其迟到 Promise 由 runWorkspace 的生命周期检查丢弃。
      if (workspaceSnapshot.simulationState === "running") void workspace.pause();
      workspaceUnsubscribe?.();
      workspaceUnsubscribe = null;
      editorUnsubscribe?.();
      editorUnsubscribe = null;
      listeners.clear();
    },
    dispose() {
      runtime.destroy();
    },
  };

  return runtime;
}
