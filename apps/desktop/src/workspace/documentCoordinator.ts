import {
  parseProjectFile,
  projectPathIdentity,
  type ParsedProjectFile,
} from "../project-file/index.ts";
import type { EditorCommand, EditorSnapshot } from "../editor/index.ts";
import type {
  CircuitDocument,
  InputBit,
  InputKey,
  WorkspaceSnapshot,
} from "./index.ts";
import type {
  DocumentRuntime,
  DocumentRuntimeSnapshot,
  DocumentViewState,
} from "./documentRuntime.ts";
import { createDocumentRuntime } from "./documentRuntime.ts";
import type { EngineAdapter } from "./index.ts";

/** 项目文件读取桥接；解析和路径身份仍由渲染层负责。 */
export interface CoordinatorProjectReader {
  readProjectFile(path: string): Promise<
    | { ok: true; content: string }
    | { ok: false; reason: string; code?: string }
  >;
}

/** 创建运行时的输入；`documentKey` 贯穿到 Electron 的按文档引擎桥接。 */
export interface DocumentRuntimeFactoryContext {
  documentKey: string;
  path: string | null;
  parsed: ParsedProjectFile | null;
}

/** 协调器注入的运行时工厂；生产代码和测试替身共享这个窄 seam。 */
export type DocumentRuntimeFactory = (context: DocumentRuntimeFactoryContext) => DocumentRuntime | Promise<DocumentRuntime>;

/**
 * 生产环境使用的按键运行时工厂。
 *
 * 每次打开都从 `forDocument(documentKey)` 取得独立 Electron adapter，并为该运行时创建独立
 * EditorSession；协调器随后负责健康检查和加载。测试通常直接注入自己的 factory。
 * @returns 可传给 `createDocumentCoordinator` 的运行时工厂。
 */
export function createWindowDocumentRuntimeFactory(): DocumentRuntimeFactory {
  return ({ documentKey, path, parsed }) => {
    const bridge = (window as unknown as {
      circuitPlatform: {
        forDocument(key: string): unknown;
      };
    }).circuitPlatform.forDocument(documentKey) as EngineAdapter & {
      closeDocument(): Promise<{ ok: true }>;
    };
    return createDocumentRuntime({
      adapter: bridge,
      runtimeId: documentKey,
      disposeEngine: async () => {
        await bridge.closeDocument();
      },
      project: path === null ? undefined : { path },
      initialEditor: {
        document: parsed?.document ?? { components: [], connections: [] },
        bindings: { components: {}, connections: {} },
      },
    });
  };
}

/** 标签栏只消费的文档摘要，不暴露运行时对象或引擎身份。 */
export interface DocumentTabSnapshot {
  key: string;
  path: string | null;
  displayName: string;
  isDirty: boolean;
  saveError: string | null;
  openError: string | null;
  engineState: WorkspaceSnapshot["engineState"];
  simulationState: WorkspaceSnapshot["simulationState"];
}

/** 多文档协调器的只读快照；active 是当前唯一投影到 UI 的运行时。 */
export interface DocumentCoordinatorSnapshot {
  tabs: readonly DocumentTabSnapshot[];
  activeKey: string | null;
  active: DocumentRuntimeSnapshot | null;
  /** 最近一次打开动作的错误；失败不会修改 tabs 或 active。 */
  openError: string | null;
}

export type CoordinatorOpenResult =
  | { ok: true; key: string; duplicate: boolean }
  | { ok: false; error: string };

export type CoordinatorCloseResult =
  | { ok: true; key: string; activeKey: string | null }
  | { ok: false; reason: "not-found" | "unsaved-changes"; key: string };

export interface DocumentCoordinatorOptions {
  /** 打开已保存 Project 时使用的读文件桥接。 */
  reader: CoordinatorProjectReader;
  /** 每份文档独立创建的运行时；不得在协调器外共享 Workspace/EditorSession。 */
  runtimeFactory: DocumentRuntimeFactory;
  /** 测试可显式指定平台；省略时沿用 projectPathIdentity 的当前平台规则。 */
  pathIdentity?: (path: string) => string;
  /** 测试或产品可覆写路径解析；默认使用项目文件的唯一解析实现。 */
  parse?: (raw: unknown) => ReturnType<typeof parseProjectFile>;
}

interface RuntimeRecord {
  key: string;
  identity: string | null;
  runtime: DocumentRuntime;
  unsubscribe: () => void;
  snapshot: DocumentRuntimeSnapshot;
}

function circuitDocumentOf(parsed: ParsedProjectFile): CircuitDocument {
  return {
    components: parsed.document.components.map((component) => ({
      id: component.id,
      kind: component.kind,
      ...(component.ports !== undefined ? { ports: component.ports } : {}),
    })),
    connections: parsed.document.connections.map((connection) => ({
      id: connection.id,
      source: { componentId: connection.source.componentId, port: connection.source.port },
      target: { componentId: connection.target.componentId, port: connection.target.port },
    })),
  };
}

function cloneRuntimeSnapshot(snapshot: DocumentRuntimeSnapshot): DocumentRuntimeSnapshot {
  return {
    ...snapshot,
    workspace: {
      ...snapshot.workspace,
      inputValues: { ...snapshot.workspace.inputValues },
      signals: { ...snapshot.workspace.signals },
      waveform: snapshot.workspace.waveform.map((point) => ({ ...point, signals: { ...point.signals } })),
    },
    editor: snapshot.editor === null ? null : {
      ...snapshot.editor,
      document: {
        components: snapshot.editor.document.components.map((component) => ({ ...component, position: { ...component.position } })),
        connections: snapshot.editor.document.connections.map((connection) => ({ ...connection })),
      },
      selection: snapshot.editor.selection ? { ...snapshot.editor.selection } : null,
    },
    project: { ...snapshot.project },
    view: {
      ...snapshot.view,
      viewport: { ...snapshot.view.viewport, visibleRect: { ...snapshot.view.viewport.visibleRect } },
      selection: snapshot.view.selection ? { ...snapshot.view.selection } : null,
    },
  };
}

function tabOf(record: RuntimeRecord): DocumentTabSnapshot {
  return {
    key: record.key,
    path: record.snapshot.project.path,
    displayName: record.snapshot.project.displayName,
    isDirty: record.snapshot.project.isDirty,
    saveError: record.snapshot.project.saveError,
    openError: record.snapshot.project.openError,
    engineState: record.snapshot.workspace.engineState,
    simulationState: record.snapshot.workspace.simulationState,
  };
}

/**
 * 创建多文档协调器。
 *
 * 协调器只维护标签顺序、路径索引和活动投影；项目内容、撤销栈、视图状态与引擎绑定全部
 * 留在对应 DocumentRuntime 中。路径查重在任何读文件或运行时工厂调用之前完成。
 * @param options 文件读取、解析和运行时工厂依赖。
 * @returns 可由 Vue 或无头测试直接驱动的命令与只读快照。
 */
export function createDocumentCoordinator(options: DocumentCoordinatorOptions) {
  const identityOf = options.pathIdentity ?? ((path: string) => projectPathIdentity(path));
  const parse = options.parse ?? parseProjectFile;
  const records: RuntimeRecord[] = [];
  const byKey = new Map<string, RuntimeRecord>();
  const byIdentity = new Map<string, string>();
  const opening = new Map<string, Promise<CoordinatorOpenResult>>();
  const listeners = new Set<(snapshot: DocumentCoordinatorSnapshot) => void>();
  let activeKey: string | null = null;
  let openError: string | null = null;
  let sequence = 1;

  function nextKey(): string {
    let key = `document-${sequence++}`;
    while (byKey.has(key)) key = `document-${sequence++}`;
    return key;
  }

  function snapshot(): DocumentCoordinatorSnapshot {
    const active = activeKey === null ? null : byKey.get(activeKey)?.snapshot ?? null;
    return {
      tabs: records.map(tabOf),
      activeKey,
      active: active === null ? null : cloneRuntimeSnapshot(active),
      openError,
    };
  }

  function publish(): DocumentCoordinatorSnapshot {
    const current = snapshot();
    for (const listener of [...listeners]) listener(current);
    return current;
  }

  function updateRecord(record: RuntimeRecord, next: DocumentRuntimeSnapshot): void {
    record.snapshot = cloneRuntimeSnapshot(next);
    publish();
  }

  async function activate(key: string): Promise<boolean> {
    const next = byKey.get(key);
    if (next === undefined) return false;
    if (activeKey === key) return true;
    const previous = activeKey === null ? undefined : byKey.get(activeKey);
    // 切换只暂停前一份运行时；恢复时由用户显式 resume，不会偷偷自动运行。
    if (previous?.snapshot.workspace.simulationState === "running") {
      try { previous.snapshot = cloneRuntimeSnapshot(await previous.runtime.pause()); } catch { /* 切换仍应可完成。 */ }
    }
    activeKey = key;
    openError = null;
    publish();
    return true;
  }

  async function openProject(path: string): Promise<CoordinatorOpenResult> {
    const identity = identityOf(path);
    const existingKey = byIdentity.get(identity);
    if (existingKey !== undefined) {
      await activate(existingKey);
      return { ok: true, key: existingKey, duplicate: true };
    }
    const pending = opening.get(identity);
    if (pending !== undefined) return pending;

    const operation = (async (): Promise<CoordinatorOpenResult> => {
      // 再次检查竞态：另一条路径写法可能在本次读取期间先完成。
      const racedKey = byIdentity.get(identity);
      if (racedKey !== undefined) {
        await activate(racedKey);
        return { ok: true, key: racedKey, duplicate: true };
      }
      openError = null;
      const file = await options.reader.readProjectFile(path);
      if (!file.ok) {
        openError = file.reason;
        publish();
        return { ok: false, error: file.reason };
      }
      let raw: unknown;
      try { raw = JSON.parse(file.content); } catch (error) {
        const message = `项目文件不是合法的 JSON：${error instanceof Error ? error.message : "解析失败"}`;
        openError = message;
        publish();
        return { ok: false, error: message };
      }
      const parsed = parse(raw);
      if (!parsed.ok) {
        const message = `项目文件校验失败：${parsed.errors[0]?.message ?? "未知原因"}`;
        openError = message;
        publish();
        return { ok: false, error: message };
      }

      const key = nextKey();
      let runtime: DocumentRuntime | undefined;
      try {
        runtime = await options.runtimeFactory({ documentKey: key, path, parsed: parsed.value });
        const health = await runtime.checkEngine();
        if (health.workspace.engineState !== "ready") {
          throw new Error(health.workspace.operationError ?? "仿真引擎不可用，无法打开项目。");
        }
        await runtime.openCircuit(circuitDocumentOf(parsed.value), { inputValues: parsed.value.inputValues });
        const loaded = runtime.snapshot();
        if (loaded.workspace.operationError !== null || loaded.workspace.engineState !== "ready") {
          throw new Error(loaded.workspace.operationError ?? "打开项目失败。");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "打开项目失败。";
        openError = message;
        publish();
        try { runtime?.destroy(); } catch { /* 打开失败的隔离清理。 */ }
        return { ok: false, error: message };
      }
      if (runtime === undefined) return { ok: false, error: "打开项目失败。" };
      // 路径身份是协调器的权威；运行时仍保留自己的项目、视图和历史。
      const withPath = runtime.setProjectPath(path);
      const record: RuntimeRecord = {
        key,
        identity,
        runtime,
        unsubscribe: () => undefined,
        snapshot: cloneRuntimeSnapshot(withPath),
      };
      record.unsubscribe = runtime.subscribe((next) => updateRecord(record, next));
      records.push(record);
      byKey.set(key, record);
      byIdentity.set(identity, key);
      activeKey = key;
      openError = null;
      publish();
      return { ok: true, key, duplicate: false };
    })();
    opening.set(identity, operation);
    try { return await operation; } finally { opening.delete(identity); }
  }

  async function newDocument(): Promise<string> {
    const key = nextKey();
    const runtime = await options.runtimeFactory({ documentKey: key, path: null, parsed: null });
    try {
      const health = await runtime.checkEngine();
      if (health.workspace.engineState !== "ready") {
        throw new Error(health.workspace.operationError ?? "仿真引擎不可用，无法新建文档。");
      }
      await runtime.openCircuit({ components: [], connections: [] });
    } catch (error) {
      runtime.destroy();
      throw error;
    }
    const record: RuntimeRecord = {
      key,
      identity: null,
      runtime,
      unsubscribe: () => undefined,
      snapshot: cloneRuntimeSnapshot(runtime.snapshot()),
    };
    record.unsubscribe = runtime.subscribe((next) => updateRecord(record, next));
    records.push(record);
    byKey.set(key, record);
    activeKey = key;
    openError = null;
    publish();
    return key;
  }

  async function close(key: string, options: { discard?: boolean } = {}): Promise<CoordinatorCloseResult> {
    const record = byKey.get(key);
    if (record === undefined) return { ok: false, reason: "not-found", key };
    if (record.snapshot.project.isDirty && options.discard !== true) return { ok: false, reason: "unsaved-changes", key };
    const index = records.indexOf(record);
    record.unsubscribe();
    record.runtime.destroy();
    records.splice(index, 1);
    byKey.delete(key);
    if (record.identity !== null) byIdentity.delete(record.identity);
    if (activeKey === key) {
      const replacement = records[index] ?? records[index - 1] ?? records[0];
      activeKey = replacement?.key ?? null;
    }
    publish();
    return { ok: true, key, activeKey };
  }

  async function dispatchEditor(command: EditorCommand): Promise<EditorSnapshot | null> {
    const record = activeKey === null ? undefined : byKey.get(activeKey);
    return record?.runtime.dispatchEditor(command) ?? null;
  }

  function activeRuntime(): DocumentRuntime | null {
    return activeKey === null ? null : byKey.get(activeKey)?.runtime ?? null;
  }

  const coordinator = {
    snapshot,
    subscribe(listener: (snapshot: DocumentCoordinatorSnapshot) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    openProject,
    openRecent: openProject,
    newDocument,
    activate,
    close,
    activeRuntime,
    dispatchEditor,
    async start() { return activeRuntime()?.start() ?? null; },
    async pause() { return activeRuntime()?.pause() ?? null; },
    async resume() { return activeRuntime()?.resume() ?? null; },
    async step() { return activeRuntime()?.step() ?? null; },
    async reset() { return activeRuntime()?.reset() ?? null; },
    async setInputBit(key: InputKey, index: number, bit: InputBit) { return activeRuntime()?.setInputBit(key, index, bit) ?? null; },
    async setSelection(selection: DocumentViewState["selection"]) { return activeRuntime()?.setSelection(selection) ?? null; },
    setViewport(viewport: DocumentViewState["viewport"]) { return activeRuntime()?.setViewport(viewport) ?? null; },
    setActiveRailPage(page: DocumentViewState["activeRailPage"]) { return activeRuntime()?.setActiveRailPage(page) ?? null; },
    setBottomTab(tab: DocumentViewState["bottomTab"]) { return activeRuntime()?.setBottomTab(tab) ?? null; },
    async checkEngine() { return activeRuntime()?.checkEngine() ?? null; },
  };
  return coordinator;
}

export type DocumentCoordinator = ReturnType<typeof createDocumentCoordinator>;
