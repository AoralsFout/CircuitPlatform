import {
  parseProjectFile,
  projectPathIdentity,
  rebaseProjectFileReferences,
  serializeProjectFile,
  type ParsedProjectFile,
} from "../project-file/index.ts";
import {
  readRecentProjects,
  rememberRecentProject,
  type KeyValueStorage,
  type RecentProject,
} from "../project-file/recent-projects.ts";
import type { CommandResult, EditorCommand } from "../editor/index.ts";
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

/** 多文档保存所需的最小文件桥；冲突确认完成前不会调用 writeProjectFile。 */
export interface CoordinatorProjectWriter {
  pickSavePath(options?: { defaultPath?: string }): Promise<{ ok: true; path: string } | { ok: false; reason: string }>;
  writeProjectFile(path: string, content: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  storage?: KeyValueStorage | null;
}

/** 创建运行时的输入；`documentKey` 贯穿到 Electron 的按文档引擎桥接。 */
export interface DocumentRuntimeFactoryContext {
  documentKey: string;
  path: string | null;
  parsed: ParsedProjectFile | null;
  /** 未保存文档的展示名；已保存文档不需要临时名称。 */
  temporaryName?: string;
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
  return ({ documentKey, path, parsed, temporaryName }) => {
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
      temporaryName,
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
  recentProjects: readonly RecentProject[];
  pendingSaveConflict: CoordinatorSaveConflict | null;
}

/** 保存目标已被另一标签占用时的稳定冲突描述。 */
export interface CoordinatorSaveConflict {
  sourceKey: string;
  targetKey: string;
  targetPath: string;
  sourceDisplayName: string;
  targetDisplayName: string;
  targetIsDirty: boolean;
}

export type CoordinatorOpenResult =
  | { ok: true; key: string; duplicate: boolean }
  | { ok: false; error: string };

export type CoordinatorNewDocumentResult =
  | { ok: true; key: string }
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
  /** 保存/另存为桥接；省略时协调器仍可用于只读打开和仿真。 */
  writer?: CoordinatorProjectWriter;
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
  let temporarySequence = 1;
  let disposed = false;
  let recentProjects: RecentProject[] = readRecentProjects(options.writer?.storage);
  let pendingSaveConflict: CoordinatorSaveConflict | null = null;

  function nextKey(): string {
    let key = `document-${sequence++}`;
    while (byKey.has(key)) key = `document-${sequence++}`;
    return key;
  }

  function nextTemporaryName(): string {
    return `未命名 ${temporarySequence++}`;
  }

  function snapshot(): DocumentCoordinatorSnapshot {
    const active = activeKey === null ? null : byKey.get(activeKey)?.snapshot ?? null;
    return {
      tabs: records.map(tabOf),
      activeKey,
      active: active === null ? null : cloneRuntimeSnapshot(active),
      openError,
      recentProjects: [...recentProjects],
      pendingSaveConflict,
    };
  }

  function publish(): DocumentCoordinatorSnapshot {
    const current = snapshot();
    for (const listener of [...listeners]) listener(current);
    return current;
  }

  function updateRecord(record: RuntimeRecord, next: DocumentRuntimeSnapshot): void {
    if (record.identity !== null && byIdentity.get(record.identity) === record.key) byIdentity.delete(record.identity);
    record.snapshot = cloneRuntimeSnapshot(next);
    record.identity = next.project.path === null ? null : identityOf(next.project.path);
    if (record.identity !== null) byIdentity.set(record.identity, record.key);
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
    if (disposed) return { ok: false, error: "文档协调器已释放。" };
    const identity = identityOf(path);
    const existingKey = byIdentity.get(identity);
    if (existingKey !== undefined) {
      await activate(existingKey);
      return { ok: true, key: existingKey, duplicate: true };
    }
    const pending = opening.get(identity);
    if (pending !== undefined) return pending;

    const operation = (async (): Promise<CoordinatorOpenResult> => {
      if (disposed) return { ok: false, error: "文档协调器已释放。" };
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
        if (disposed) {
          runtime.destroy();
          return { ok: false, error: "文档协调器已释放。" };
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

  async function newDocument(): Promise<CoordinatorNewDocumentResult> {
    if (disposed) return { ok: false, error: "文档协调器已释放。" };
    const key = nextKey();
    const temporaryName = nextTemporaryName();
    let runtime: DocumentRuntime | undefined;
    try {
      runtime = await options.runtimeFactory({ documentKey: key, path: null, parsed: null, temporaryName });
      const health = await runtime.checkEngine();
      if (health.workspace.engineState !== "ready") {
        throw new Error(health.workspace.operationError ?? "仿真引擎不可用，无法新建文档。");
      }
      const opened = await runtime.openCircuit({ components: [], connections: [] });
      if (opened.workspace.operationError !== null || opened.workspace.engineState !== "ready") {
        throw new Error(opened.workspace.operationError ?? "新建文档失败。");
      }
      if (disposed) {
        runtime.destroy();
        return { ok: false, error: "文档协调器已释放。" };
      }
    } catch (error) {
      try { runtime?.destroy(); } catch { /* 新建失败的隔离清理。 */ }
      const message = error instanceof Error ? error.message : "新建文档失败。";
      openError = message;
      publish();
      return { ok: false, error: message };
    }
    if (runtime === undefined) {
      const error = "新建文档失败。";
      openError = error;
      publish();
      return { ok: false, error };
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
    return { ok: true, key };
  }

  async function close(key: string, options: { discard?: boolean } = {}): Promise<CoordinatorCloseResult> {
    if (pendingSaveConflict !== null) return { ok: false, reason: "unsaved-changes", key };
    const record = byKey.get(key);
    if (record === undefined) return { ok: false, reason: "not-found", key };
    if (record.snapshot.project.isDirty && options.discard !== true) return { ok: false, reason: "unsaved-changes", key };
    const index = records.indexOf(record);
    record.unsubscribe();
    record.runtime.destroy();
    records.splice(index, 1);
    byKey.delete(key);
    if (record.identity !== null && byIdentity.get(record.identity) === key) byIdentity.delete(record.identity);
    if (activeKey === key) {
      const replacement = records[index] ?? records[index - 1] ?? records[0];
      activeKey = replacement?.key ?? null;
    }
    publish();
    return { ok: true, key, activeKey };
  }

  function activeRecord(): RuntimeRecord | undefined {
    return activeKey === null ? undefined : byKey.get(activeKey);
  }

  function serializeForTarget(record: RuntimeRecord, targetPath: string): { ok: true; content: string } | { ok: false; error: string } {
    if (record.snapshot.editor === null) return { ok: false, error: "编辑器尚未准备好，无法保存。" };
    const file = serializeProjectFile({
      document: record.snapshot.editor.document,
      inputValues: record.snapshot.workspace.inputValues,
    });
    let prepared = file;
    if (record.snapshot.project.path !== null && identityOf(record.snapshot.project.path) !== identityOf(targetPath)) {
      const rebased = rebaseProjectFileReferences(file, record.snapshot.project.path, targetPath);
      if (!rebased.ok) return { ok: false, error: rebased.error.message };
      prepared = rebased.value;
    }
    const content = JSON.stringify(prepared);
    const validation = parse(JSON.parse(content));
    return validation.ok
      ? { ok: true, content }
      : { ok: false, error: `项目文件校验失败：${validation.errors[0]?.message ?? "未知原因"}` };
  }

  async function commitSave(record: RuntimeRecord, targetPath: string): Promise<boolean> {
    if (options.writer === undefined) {
      record.runtime.setSaveError("当前运行环境不支持项目文件保存。");
      return false;
    }
    const serialized = serializeForTarget(record, targetPath);
    if (!serialized.ok) {
      record.runtime.setSaveError(serialized.error);
      return false;
    }
    const result = await options.writer.writeProjectFile(targetPath, serialized.content);
    if (!result.ok) {
      record.runtime.setSaveError(result.reason);
      return false;
    }
    record.runtime.setProjectPath(targetPath);
    record.runtime.setSaveError(null);
    record.runtime.setDirty(false);
    recentProjects = rememberRecentProject(options.writer.storage, recentProjects, targetPath);
    return true;
  }

  /** 保存活动标签；没有路径时转入另存为。 */
  async function save(): Promise<boolean> {
    if (pendingSaveConflict !== null) return false;
    const record = activeRecord();
    if (record === undefined) return false;
    if (record.snapshot.project.path === null) return saveAs();
    return commitSave(record, record.snapshot.project.path);
  }

  /** 另存为先解析路径身份，再决定是否进入冲突确认，写盘始终发生在确认之后。 */
  async function saveAs(): Promise<boolean> {
    if (options.writer === undefined || pendingSaveConflict !== null) return false;
    const source = activeRecord();
    if (source === undefined) return false;
    const dialog = await options.writer.pickSavePath({ defaultPath: source.snapshot.project.path ?? source.snapshot.project.displayName });
    if (!dialog.ok) {
      if (dialog.reason !== "canceled") source.runtime.setSaveError(dialog.reason);
      return false;
    }
    const targetIdentity = identityOf(dialog.path);
    const target = records.find((candidate) => candidate.key !== source.key && candidate.identity === targetIdentity);
    if (target !== undefined) {
      pendingSaveConflict = {
        sourceKey: source.key,
        targetKey: target.key,
        targetPath: dialog.path,
        sourceDisplayName: source.snapshot.project.displayName,
        targetDisplayName: target.snapshot.project.displayName,
        targetIsDirty: target.snapshot.project.isDirty,
      };
      publish();
      return false;
    }
    return commitSave(source, dialog.path);
  }

  /** 确认冲突后仅提交记录中的源/目标运行时；写入失败不会关闭目标标签。 */
  async function confirmSaveConflict(): Promise<boolean> {
    const conflict = pendingSaveConflict;
    if (conflict === null) return false;
    pendingSaveConflict = null;
    const source = byKey.get(conflict.sourceKey);
    const target = byKey.get(conflict.targetKey);
    if (source === undefined || target === undefined || target.identity !== identityOf(conflict.targetPath)) {
      source?.runtime.setSaveError("保存冲突目标已改变，请重新选择路径。");
      publish();
      return false;
    }
    activeKey = source.key;
    const succeeded = await commitSave(source, conflict.targetPath);
    if (!succeeded) return false;
    await close(target.key, { discard: true });
    activeKey = source.key;
    publish();
    return true;
  }

  /** 取消冲突确认，不读取文档、不写盘、不改变标签。 */
  function cancelSaveConflict(): void {
    if (pendingSaveConflict === null) return;
    pendingSaveConflict = null;
    publish();
  }

  async function dispatchEditor(command: EditorCommand): Promise<CommandResult | null> {
    const record = activeKey === null ? undefined : byKey.get(activeKey);
    const result = await (record?.runtime.dispatchEditor(command) ?? Promise.resolve(null));
    if (record !== undefined && result?.ok) record.runtime.setDirty(true);
    return result;
  }

  /** 释放协调器拥有的全部文档运行时；清理失败不会阻断其他文档的释放。 */
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const record of [...records]) {
      record.unsubscribe();
      try {
        record.runtime.dispose();
      } catch {
        try { record.runtime.destroy(); } catch { /* 继续释放其他文档。 */ }
      }
    }
    records.length = 0;
    byKey.clear();
    byIdentity.clear();
    opening.clear();
    activeKey = null;
    openError = null;
    listeners.clear();
  }

  function activeRuntime(): DocumentRuntime | null {
    return activeKey === null ? null : byKey.get(activeKey)?.runtime ?? null;
  }

  const coordinator = {
    snapshot,
    subscribe(listener: (snapshot: DocumentCoordinatorSnapshot) => void) {
      if (disposed) return () => undefined;
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
    dispose,
    async start() { return activeRuntime()?.start() ?? null; },
    async pause() { return activeRuntime()?.pause() ?? null; },
    async resume() { return activeRuntime()?.resume() ?? null; },
    async step() { return activeRuntime()?.step() ?? null; },
    async reset() { return activeRuntime()?.reset() ?? null; },
    async setInputBit(key: InputKey, index: number, bit: InputBit) {
      const record = activeRecord();
      if (record === undefined) return null;
      const next = await record.runtime.setInputBit(key, index, bit);
      record.runtime.setDirty(true);
      return next;
    },
    async setSelection(selection: DocumentViewState["selection"]) { return activeRuntime()?.setSelection(selection) ?? null; },
    setViewport(viewport: DocumentViewState["viewport"]) { return activeRuntime()?.setViewport(viewport) ?? null; },
    setActiveRailPage(page: DocumentViewState["activeRailPage"]) { return activeRuntime()?.setActiveRailPage(page) ?? null; },
    setBottomTab(tab: DocumentViewState["bottomTab"]) { return activeRuntime()?.setBottomTab(tab) ?? null; },
    async checkEngine() { return activeRuntime()?.checkEngine() ?? null; },
    save,
    saveAs,
    confirmSaveConflict,
    cancelSaveConflict,
  };
  return coordinator;
}

export type DocumentCoordinator = ReturnType<typeof createDocumentCoordinator>;
