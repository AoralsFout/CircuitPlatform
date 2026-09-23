import { computed, reactive, ref, shallowRef, watch, type ComputedRef, type Ref } from "vue";
import type { ComponentKindName, PortSpec } from "@circuit-platform/protocol";
import type { EmbeddedDefinitionSnapshot } from "./useWorkspace.ts";
import { projectPathIdentity } from "../project-file/paths.ts";
import { readRecentProjects, type RecentProject } from "../project-file/recent-projects.ts";
import type { EditorComponentId, EditorSelection, Point, WireColorId } from "../editor/index.ts";
import { useEditorState } from "./useEditorState.ts";
import { useWorkspace, type WorkspaceBinding } from "./useWorkspace.ts";
import type { TickScheduler } from "../workspace/index.ts";
import type { DocumentTabSnapshot } from "../workspace/documentCoordinator.ts";

type EditorBinding = ReturnType<typeof useEditorState>;
type PendingAction = "open" | "new" | "load-example" | "close" | null;

/** 下钻只记录最近一跳；父文档和来源元件都按运行时键/稳定 Editor ID 寻址。 */
export interface DrillDownSource {
  parentKey: string;
  componentId: EditorComponentId;
}

/** 保存到另一标签已占用路径时冻结的、按运行时键寻址的冲突快照。 */
export interface PendingSaveConflict {
  sourceKey: string;
  targetKey: string;
  targetPath: string;
  sourceDisplayName: string;
  targetDisplayName: string;
  targetIsDirty: boolean;
}

interface DocumentController {
  key: string;
  hasDocument: boolean;
  /** 关闭或工作区卸载后设为 true；迟到的文件/引擎响应不得重新挂回标签集合。 */
  disposed: boolean;
  binding: WorkspaceBinding;
  editor: EditorBinding;
  stopPathWatch: () => void;
}

interface DefinitionTab {
  key: string;
  parentKey: string;
  definitionId: string;
  displayName: string;
  returnKey: string;
  sourceComponentId?: EditorComponentId;
}

const mutableWorkspaceRefs = new Set(["state", "editorState", "projectPath", "isDirty", "saveError", "openError", "pendingFileAction", "pendingDefinitionDeletion", "pendingReimport", "recentProjects", "staleSubcircuits", "needsReload", "projectVersion"]);
const mutableEditorRefs = new Set(["showDetails", "showSidebar", "activeRailPage", "bottomTab", "zoom"]);

/**
 * `useDocumentWorkspace` 的依赖注入选项。
 *
 * 生产环境通常省略全部选项；测试或基准可以为每个文档提供独立的连续运行与恢复调度器，
 * 以验证文档之间没有共享调度状态。
 */
export interface DocumentWorkspaceOptions {
  /** 测试可注入可控 tick 调度器；生产环境省略时每份文档各自创建默认调度器。 */
  scheduler?: TickScheduler;
  /** 需要验证调度器隔离时，为每个文档键创建一个独立调度器。 */
  schedulerFactory?: (documentKey: string) => TickScheduler;
  /** 测试可注入可控恢复重试调度器。 */
  recoveryScheduler?: TickScheduler;
  /** 为每个文档创建独立的恢复重试调度器。 */
  recoverySchedulerFactory?: (documentKey: string) => TickScheduler;
}

/**
 * 将现有单文档组合层提升为按文档键的活动投影。
 *
 * 每个 Controller 都拥有独立的 `useWorkspace`、EditorSession 和 `useEditorState`；返回 facade
 * 只把活动 Controller 投影给 App，因此旧组件无需了解运行时集合，也不会把编辑器历史或视图
 * refs 共享到另一份 Project。文件路径索引在这里先于读文件执行，协调器的标签 seam 由
 * `tabs`/`activeDocumentKey` 暴露给 TopBar。
 * @param options 调度器依赖注入；省略时生产路径为每份文档创建默认调度器。
 * @returns 与旧 `useWorkspace` + `useEditorState` 兼容的活动文档 facade，以及标签、激活和关闭操作。
 * @throws facade 被销毁后，迟到的文件/引擎结果会被丢弃；调用方不得再依赖已关闭文档的状态。
 */
export function useDocumentWorkspace(options: DocumentWorkspaceOptions = {}): any {
  // Keep nested per-document refs intact; `ref()` deep-unpacks binding/editor refs inside records.
  const records = shallowRef<DocumentController[]>([]);
  const activeKey = ref<string | null>(null);
  const activeDefinitionKey = ref<string | null>(null);
  const definitionTabs = shallowRef<DefinitionTab[]>([]);
  const sequence = ref(1);
  const temporarySequence = ref(1);
  const pathKeys = new Map<string, string>();
  const drillDownSources = reactive(new Map<string, DrillDownSource>());
  const pendingAction = ref<PendingAction>(null);
  const pendingPath = ref<string | null>(null);
  const pendingCloseKey = ref<string | null>(null);
  const actionError = ref<string | null>(null);
  const opening = new Map<string, Promise<boolean>>();
  const controllers = new Set<DocumentController>();
  let disposed = false;
  const pendingSaveConflict = ref<PendingSaveConflict | null>(null);
  function readSharedRecentProjects(): RecentProject[] {
    try { return readRecentProjects(window.localStorage); } catch { return []; }
  }

  const recentProjects = shallowRef<RecentProject[]>(readSharedRecentProjects());

  function syncRecentProjects(): void {
    recentProjects.value = readSharedRecentProjects();
  }

  /** 广播已确认写盘的子 Project 版本；仅更新仍打开父文档的 stale 投影。 */
  function publishSuccessfulSave(record: DocumentController): void {
    const path = record.binding.projectPath.value;
    const version = record.binding.projectVersion.value;
    if (path === null || version === null) return;
    const identity = projectPathIdentity(path);
    for (const candidate of records.value) {
      if (candidate === record || candidate.disposed || !candidate.hasDocument) continue;
      candidate.binding.markSubcircuitsStale(identity, version);
    }
  }
  // Tab activation is serialized so a rapid A → B → C sequence cannot let an
  // older pause finish after a newer activation and publish the wrong active view.
  let activationChain: Promise<void> = Promise.resolve();

  function platform(): {
    pickOpenPath(): Promise<{ ok: true; path: string } | { ok: false; reason: string }>;
    pickSavePath(options?: { defaultPath?: string }): Promise<{ ok: true; path: string } | { ok: false; reason: string }>;
  } {
    return (window as unknown as { circuitPlatform: ReturnType<typeof platform> }).circuitPlatform;
  }

  function createController(assignTemporaryName = true): DocumentController {
    const key = `document-${sequence.value++}`;
    const temporaryName = assignTemporaryName ? `未命名 ${temporarySequence.value++}` : undefined;
    const scheduler = options.schedulerFactory?.(key) ?? options.scheduler;
    const recoveryScheduler = options.recoverySchedulerFactory?.(key) ?? options.recoveryScheduler;
    // Keep the production path's narrow facade explicit; test-only scheduler injection
    // adds no shared coordination state and remains scoped to this controller.
    const binding = scheduler === undefined && recoveryScheduler === undefined
      ? useWorkspace({ documentKey: key, temporaryName })
      : useWorkspace({ documentKey: key, temporaryName, scheduler, recoveryScheduler });
    const editor = useEditorState(
      binding.state,
      binding.editorState,
      binding.select,
      binding.moveComponent,
      binding.updatePlacement,
      binding.editRoute,
      binding.createConnection,
      binding.setPortWidthCommand,
    );
    const stopPathWatch = watch(binding.projectPath, (next, previous) => {
      if (previous !== null) pathKeys.delete(projectPathIdentity(previous));
      if (next !== null) pathKeys.set(projectPathIdentity(next), key);
    });
    const controller = { key, hasDocument: false, disposed: false, binding, editor, stopPathWatch };
    controllers.add(controller);
    return controller;
  }

  function ensureController(): DocumentController {
    const current = records.value[0];
    if (current !== undefined) return current;
    const created = createController();
    records.value = [created];
    activeKey.value = null;
    return created;
  }

  const active = computed(() => {
    const key = activeKey.value;
    return records.value.find((record) => record.key === key) ?? records.value[0] ?? null;
  });

  function setActive(record: DocumentController): void {
    if (disposed || record.disposed) return;
    activeKey.value = record.key;
    activeDefinitionKey.value = null;
    actionError.value = null;
  }

  /** Pause the previous live document before publishing a new active document. */
  function activateRecord(record: DocumentController): Promise<void> {
    const operation = activationChain.then(async () => {
      if (disposed || record.disposed) return;
      // The initial empty controller is projected while activeKey is null. It still
      // needs an explicit key when its first Project becomes a real document.
      if (activeKey.value === record.key) {
        activeDefinitionKey.value = null;
        return;
      }
      const previous = active.value;
      if (previous?.hasDocument && previous.binding.state.value.simulationState === "running") {
        await previous.binding.pause();
      }
      if (disposed || record.disposed) return;
      setActive(record);
    });
    activationChain = operation.catch(() => undefined);
    return operation;
  }

  async function openProject(path: string): Promise<boolean> {
    if (disposed) return false;
    const identity = projectPathIdentity(path);
    const existingKey = pathKeys.get(identity);
    if (existingKey !== undefined) {
      const existing = records.value.find((record) => record.key === existingKey);
      if (existing) await activateRecord(existing);
      return existing !== undefined;
    }
    const waiting = opening.get(identity);
    if (waiting !== undefined) return waiting;
    const operation = (async () => {
      const current = active.value;
      const record = current?.hasDocument === false ? current : createController(false);
      await record.binding.bootstrap();
      if (disposed || record.disposed) return false;
      const opened = await record.binding.openProjectFromPath(path);
      if (disposed || record.disposed) return false;
      if (!opened) {
        actionError.value = record.binding.openError.value;
        if (record !== current) void disposeController(record);
        return false;
      }
      if (disposed || record.disposed) return false;
      record.hasDocument = true;
      records.value = records.value.includes(record) ? [...records.value] : [...records.value, record];
      pathKeys.set(identity, record.key);
      syncRecentProjects();
      await activateRecord(record);
      return true;
    })();
    opening.set(identity, operation);
    try { return await operation; } finally { opening.delete(identity); }
  }

  /** 打开父文档拥有的定义；已有标签按父键和定义 ID 复用，不读取源文件。 */
  async function openEmbeddedDefinition(definitionId: string, sourceComponentId?: EditorComponentId): Promise<boolean> {
    const parent = active.value;
    if (!parent?.hasDocument || parent.binding.getEmbeddedDefinition(definitionId) === null) return false;
    const existing = definitionTabs.value.find((tab) => tab.parentKey === parent.key && tab.definitionId === definitionId);
    if (existing) {
      activeDefinitionKey.value = existing.key;
      return true;
    }
    const key = `definition:${parent.key}:${encodeURIComponent(definitionId)}`;
    const snapshot = parent.binding.getEmbeddedDefinition(definitionId)!;
    const returnKey = activeDefinitionKey.value ?? parent.key;
    definitionTabs.value = [...definitionTabs.value, {
      key, parentKey: parent.key, definitionId, displayName: snapshot.displayName, returnKey,
      ...(sourceComponentId ? { sourceComponentId } : {}),
    }];
    if (parent.binding.state.value.simulationState === "running") await parent.binding.pause();
    activeDefinitionKey.value = key;
    return true;
  }

  /** 从父画布的具体使用处下钻；实例信号仍留在父画布检查器。 */
  async function openSubcircuit(componentId: EditorComponentId): Promise<boolean> {
    const component = active.value?.binding.editorState.value?.document.components.find((candidate) => candidate.id === componentId);
    const definitionId = component?.kind === "subcircuit" ? component.data?.subcircuit?.definitionId : undefined;
    return definitionId ? openEmbeddedDefinition(definitionId, componentId) : false;
  }

  const activeDefinition = computed<EmbeddedDefinitionSnapshot & { key: string; missing: boolean } | null>(() => {
    const tab = definitionTabs.value.find((candidate) => candidate.key === activeDefinitionKey.value);
    if (!tab) return null;
    const parent = records.value.find((record) => record.key === tab.parentKey);
    void parent?.binding.editorState.value;
    const snapshot = parent?.binding.getEmbeddedDefinition(tab.definitionId);
    return snapshot ? { ...snapshot, key: tab.key, missing: false } : {
      key: tab.key, definitionId: tab.definitionId, displayName: tab.displayName,
      circuit: { components: [], connections: [] }, missing: true,
    };
  });

  /** 将一个子文档切回其仍打开的父文档，并选择、居中、聚焦最近来源。 */
  async function returnToParent(): Promise<boolean> {
    const definitionTab = definitionTabs.value.find((tab) => tab.key === activeDefinitionKey.value);
    if (definitionTab) {
      const parent = records.value.find((record) => record.key === definitionTab.parentKey && record.hasDocument);
      if (!parent) return false;
      const returnTab = definitionTabs.value.find((tab) => tab.key === definitionTab.returnKey);
      activeDefinitionKey.value = returnTab?.key ?? null;
      if (!returnTab && definitionTab.sourceComponentId) await parent.editor.revealComponent(definitionTab.sourceComponentId);
      return true;
    }
    const child = active.value;
    const source = child ? drillDownSources.get(child.key) : undefined;
    if (!child || !source) return false;
    const parent = records.value.find((record) => record.key === source.parentKey && record.hasDocument);
    if (!parent) {
      drillDownSources.delete(child.key);
      return false;
    }
    await activateRecord(parent);
    const revealed = await parent.editor.revealComponent(source.componentId);
    if (!revealed) drillDownSources.delete(child.key);
    return revealed;
  }

  async function createNewDocument(): Promise<boolean> {
    if (disposed) return false;
    const current = active.value;
    const record = current?.hasDocument === false ? current : createController();
    await record.binding.bootstrap();
    if (disposed || record.disposed) return false;
    await record.binding.requestNew();
    if (disposed || record.disposed) return false;
    if (record.binding.editorState.value === null) {
      actionError.value = record.binding.openError.value ?? "新建文档失败。";
      if (record !== current) void disposeController(record);
      return false;
    }
    if (disposed || record.disposed) return false;
    record.hasDocument = true;
    records.value = records.value.includes(record) ? [...records.value] : [...records.value, record];
    await activateRecord(record);
    return true;
  }

  /** 把示例作为一份新的普通未保存文档加入标签集合，而不是替换或绕过协调器。 */
  async function loadExampleDocument(): Promise<boolean> {
    if (disposed) return false;
    const current = active.value;
    const record = current?.hasDocument === false ? current : createController();
    await record.binding.bootstrap();
    if (disposed || record.disposed) return false;
    await record.binding.requestLoadExample();
    if (disposed || record.disposed) return false;
    if (record.binding.editorState.value === null) {
      actionError.value = record.binding.openError.value ?? "加载示例失败。";
      if (record !== current) void disposeController(record);
      return false;
    }
    record.hasDocument = true;
    records.value = records.value.includes(record) ? [...records.value] : [...records.value, record];
    await activateRecord(record);
    return true;
  }

  async function requestOpen(): Promise<void> {
    const picked = await platform().pickOpenPath();
    if (picked.ok) await openProject(picked.path);
    else if (picked.reason !== "canceled") actionError.value = picked.reason;
  }

  async function requestOpenRecent(path: string): Promise<void> {
    await openProject(path);
  }

  async function requestNew(): Promise<void> {
    await createNewDocument();
  }

  async function confirmPendingFileAction(): Promise<void> {
    const action = pendingAction.value;
    const path = pendingPath.value;
    const closeKey = pendingCloseKey.value;
    pendingAction.value = null;
    pendingPath.value = null;
    pendingCloseKey.value = null;
    if (action === "open") {
      if (path !== null) await openProject(path);
      else {
        const picked = await platform().pickOpenPath();
        if (picked.ok) await openProject(picked.path);
      }
    } else if (action === "new") await createNewDocument();
    else if (action === "close" && closeKey !== null) await closeTab(closeKey, true);
  }

  function cancelPendingFileAction(): void {
    pendingAction.value = null;
    pendingPath.value = null;
    pendingCloseKey.value = null;
  }

  function findRecord(key: string): DocumentController | undefined {
    return records.value.find((record) => record.key === key && record.hasDocument);
  }

  /** 只在写入成功后移除冲突目标，确保取消/失败不会丢失标签或引擎。 */
  function disposeController(record: DocumentController): Promise<void> {
    if (record.disposed) return Promise.resolve();
    record.disposed = true;
    record.stopPathWatch();
    return record.binding.dispose();
  }

  async function discardRecord(record: DocumentController): Promise<void> {
    clearDrillDownSources(record.key);
    definitionTabs.value = definitionTabs.value.filter((tab) => tab.parentKey !== record.key);
    if (activeDefinitionKey.value && !definitionTabs.value.some((tab) => tab.key === activeDefinitionKey.value)) activeDefinitionKey.value = null;
    const next = records.value.filter((candidate) => candidate !== record);
    const path = record.binding.projectPath.value;
    if (path !== null && pathKeys.get(projectPathIdentity(path)) === record.key) {
      pathKeys.delete(projectPathIdentity(path));
    }
    const disposing = disposeController(record);
    records.value = next;
    await disposing;
  }

  /** 关闭确认通过后才调用：取消确认不会改变任何来源记录。 */
  function clearDrillDownSources(key: string): void {
    drillDownSources.delete(key);
    for (const [childKey, source] of drillDownSources) {
      if (source.parentKey === key) drillDownSources.delete(childKey);
    }
  }

  /** 保存活动标签；无路径时统一走另存为，以便先检查已打开路径冲突。 */
  async function saveProject(): Promise<boolean> {
    if (pendingSaveConflict.value !== null) return false;
    const record = active.value;
    if (!record?.hasDocument) return false;
    if (record.binding.projectPath.value === null) return saveProjectAs();
    const succeeded = await record.binding.save();
    if (succeeded) publishSuccessfulSave(record);
    return succeeded;
  }

  /** 打开另存为对话框并在任何写盘前检查路径身份冲突。 */
  async function saveProjectAs(): Promise<boolean> {
    if (pendingSaveConflict.value !== null) return false;
    const record = active.value;
    if (!record?.hasDocument) return false;
    const dialog = await platform().pickSavePath({
      defaultPath: record.binding.projectPath.value ?? record.binding.projectName.value ?? "未命名电路.circuit.json",
    });
    if (!dialog.ok) {
      if (dialog.reason !== "canceled") record.binding.setSaveError(dialog.reason);
      return false;
    }
    const targetIdentity = projectPathIdentity(dialog.path);
    const target = records.value.find((candidate) =>
      candidate.hasDocument && candidate.key !== record.key && candidate.binding.projectPath.value !== null &&
      projectPathIdentity(candidate.binding.projectPath.value) === targetIdentity);
    if (target !== undefined) {
      pendingSaveConflict.value = {
        sourceKey: record.key,
        targetKey: target.key,
        targetPath: dialog.path,
        sourceDisplayName: record.binding.projectName.value ?? `未命名 ${record.key}`,
        targetDisplayName: target.binding.projectName.value ?? target.key,
        targetIsDirty: target.binding.isDirty.value,
      };
      return false;
    }
    const succeeded = await record.binding.saveToPath(dialog.path);
    if (succeeded) {
      pathKeys.set(targetIdentity, record.key);
      syncRecentProjects();
      publishSuccessfulSave(record);
    }
    return succeeded;
  }

  /**
   * 确认已打开路径的覆盖合并；源/目标均按运行时键重新解析，标签切换不会重定向操作。
   * 写盘失败时目标仍保留，只有成功后才提交身份切换后的标签删除。
   */
  async function confirmSaveConflict(): Promise<boolean> {
    const conflict = pendingSaveConflict.value;
    if (conflict === null) return false;
    pendingSaveConflict.value = null;
    const source = findRecord(conflict.sourceKey);
    const target = findRecord(conflict.targetKey);
    if (!source || !target || target.binding.projectPath.value === null ||
      projectPathIdentity(target.binding.projectPath.value) !== projectPathIdentity(conflict.targetPath)) {
      source?.binding.setSaveError("保存冲突目标已改变，请重新选择路径。");
      return false;
    }
    // Re-enter the serialized activation chain in case the modal remained open
    // while the user requested another tab; never publish a direct unsynchronized switch.
    await activateRecord(source);
    const succeeded = await source.binding.saveToPath(conflict.targetPath);
    if (!succeeded) return false;
    pathKeys.set(projectPathIdentity(conflict.targetPath), source.key);
    syncRecentProjects();
    publishSuccessfulSave(source);
    await discardRecord(target);
    return true;
  }

  function cancelSaveConflict(): void {
    pendingSaveConflict.value = null;
  }

  async function closeTab(key: string, discard = false): Promise<void> {
    if (disposed || pendingSaveConflict.value !== null) return;
    const definitionTab = definitionTabs.value.find((tab) => tab.key === key);
    if (definitionTab) {
      definitionTabs.value = definitionTabs.value.filter((tab) => tab.key !== key);
      if (activeDefinitionKey.value === key) activeDefinitionKey.value = null;
      return;
    }
    const index = records.value.findIndex((record) => record.key === key);
    const record = records.value[index];
    if (!record || !record.hasDocument) return;
    if (record.binding.isDirty.value && !discard) {
      pendingAction.value = "close";
      pendingCloseKey.value = key;
      return;
    }
    clearDrillDownSources(key);
    definitionTabs.value = definitionTabs.value.filter((tab) => tab.parentKey !== key);
    if (activeDefinitionKey.value && !definitionTabs.value.some((tab) => tab.key === activeDefinitionKey.value)) activeDefinitionKey.value = null;
    const next = records.value.filter((candidate) => candidate.key !== key);
    const identity = record.binding.projectPath.value;
    if (identity !== null && pathKeys.get(projectPathIdentity(identity)) === key) pathKeys.delete(projectPathIdentity(identity));
    const wasActive = activeKey.value === key;
    const disposing = disposeController(record);
    if (wasActive) {
      await disposing;
    }
    records.value = next;
    if (wasActive) {
      const replacement = next[index] ?? next[index - 1] ?? next[0];
      activeKey.value = replacement?.key ?? null;
      if (records.value.length === 0) ensureController();
      return;
    }
    if (records.value.length === 0) ensureController();
    await disposing;
  }

  async function activateTab(key: string): Promise<void> {
    if (disposed) return Promise.resolve();
    const definitionTab = definitionTabs.value.find((tab) => tab.key === key);
    if (definitionTab) {
      const parent = records.value.find((record) => record.key === definitionTab.parentKey && record.hasDocument);
      if (!parent) return;
      await activateRecord(parent);
      activeDefinitionKey.value = key;
      return;
    }
    const record = records.value.find((candidate) => candidate.key === key && candidate.hasDocument);
    if (!record) return;
    const previous = active.value;
    await activateRecord(record);
    if (!previous || previous.key === record.key) return;
    const source = drillDownSources.get(previous.key);
    if (!source || source.parentKey !== record.key) return;
    const revealed = await record.editor.revealComponent(source.componentId);
    if (!revealed) drillDownSources.delete(previous.key);
  }

  const tabs = computed<readonly DocumentTabSnapshot[]>(() => [...records.value
    .filter((record) => record.hasDocument)
    .map((record) => ({
      key: record.key,
      path: record.binding.projectPath.value,
      displayName: record.binding.projectName.value ?? `未命名 ${record.key.replace("document-", "")}`,
      isDirty: record.binding.isDirty.value,
      saveError: record.binding.saveError.value,
      openError: record.binding.openError.value,
      engineState: record.binding.state.value.engineState,
      simulationState: record.binding.state.value.simulationState,
      needsReload: record.binding.needsReload.value,
      staleSubcircuitCount: record.binding.staleSubcircuits.value.length,
    })), ...definitionTabs.value.map((tab) => {
      const parent = records.value.find((record) => record.key === tab.parentKey);
      void parent?.binding.editorState.value;
      const definition = parent?.binding.getEmbeddedDefinition(tab.definitionId);
      return {
        key: tab.key, kind: "definition" as const, path: null,
        displayName: definition?.displayName ?? tab.displayName,
        isDirty: false, saveError: null, openError: null,
        engineState: parent?.binding.state.value.engineState ?? "unavailable",
        simulationState: "stopped" as const,
      };
    })]);

  const refNames = new Set([...mutableWorkspaceRefs, "canSave", "projectName", "saveState", "recentProjects", "libraryTree", "exportFeedback"]);
  const editorRefNames = new Set(["showDetails", "showSidebar", "activeRailPage", "bottomTab", "zoom", "viewport", "interaction"]);

  function projectRef(name: string): ComputedRef<unknown> {
    return computed({
      get: () => {
        const record = active.value;
        const value = record?.binding[name as keyof WorkspaceBinding] as unknown;
        if (name === "openError") return actionError.value ?? (value as Ref<unknown> | undefined)?.value ?? null;
        if (value && typeof value === "object" && "value" in value) return (value as Ref<unknown> | ComputedRef<unknown>).value;
        return value;
      },
      set: (value) => {
        const record = active.value;
        const target = record?.binding[name as keyof WorkspaceBinding] as unknown;
        if (target && typeof target === "object" && "value" in target) (target as Ref<unknown>).value = value;
      },
    });
  }

  function editorRef(name: string): ComputedRef<unknown> {
    return computed({
      get: () => {
        const value = active.value?.editor[name as keyof EditorBinding] as unknown;
        return value && typeof value === "object" && "value" in value ? (value as Ref<unknown>).value : value;
      },
      set: (value) => {
        const target = active.value?.editor[name as keyof EditorBinding] as unknown;
        if (target && typeof target === "object" && "value" in target) (target as Ref<unknown>).value = value;
      },
    });
  }

  const workspaceFacade = new Proxy({}, {
    get(_target, property: string) {
      if (property === "editor") return editorFacade;
      if (property === "tabs") return tabs;
      if (property === "activeDocumentKey") return computed(() => activeDefinitionKey.value ?? activeKey.value);
      if (property === "activeDefinition") return activeDefinition;
      if (property === "openEmbeddedDefinition") return openEmbeddedDefinition;
      if (property === "activateTab") return activateTab;
      if (property === "openSubcircuit") return openSubcircuit;
      if (property === "returnToParent") return returnToParent;
      if (property === "canReturnToParent") return computed(() => {
        if (activeDefinitionKey.value !== null) return true;
        const record = active.value;
        const source = record ? drillDownSources.get(record.key) : undefined;
        return Boolean(source && records.value.some((candidate) => candidate.key === source.parentKey && candidate.hasDocument));
      });
      if (property === "closeTab") return closeTab;
      if (property === "dispose") return disposeWorkspace;
      if (property === "save") return saveProject;
      if (property === "saveAs") return saveProjectAs;
      if (property === "pendingSaveConflict") return computed(() => pendingSaveConflict.value);
      if (property === "recentProjects") return recentProjects;
      if (property === "confirmSaveConflict") return confirmSaveConflict;
      if (property === "cancelSaveConflict") return cancelSaveConflict;
      if (property === "requestOpen") return requestOpen;
      if (property === "requestOpenRecent") return requestOpenRecent;
      if (property === "requestNew") return requestNew;
      if (property === "requestLoadExample") return async () => { await loadExampleDocument(); };
      if (property === "confirmPendingFileAction") return confirmPendingFileAction;
      if (property === "cancelPendingFileAction") return cancelPendingFileAction;
      if (property === "pendingFileAction") return computed(() => pendingAction.value);
      if (property === "openError") return projectRef("openError");
      if (refNames.has(property)) return projectRef(property);
      return (...args: unknown[]) => {
        const method = active.value?.binding[property as keyof WorkspaceBinding];
        return typeof method === "function" ? Reflect.apply(method, active.value?.binding, args) : undefined;
      };
    },
  }) as any;

  const editorFacade = new Proxy({}, {
    get(_target, property: string) {
      if (editorRefNames.has(property)) return editorRef(property);
      const value = active.value?.editor[property as keyof EditorBinding] as unknown;
      if (value !== undefined && typeof value !== "function") return editorRef(property);
      return (...args: unknown[]) => {
        const method = active.value?.editor[property as keyof EditorBinding];
        return typeof method === "function" ? Reflect.apply(method, active.value?.editor, args) : undefined;
      };
    },
  }) as any;

  ensureController();

  /**
   * 释放整个文档集合。它与单标签关闭共用每个 controller 的 dispose 路径，
   * 且只允许执行一次；卸载期间尚未完成的 open/new 在 await 后由 disposed guard 丢弃。
   */
  function disposeWorkspace(): void {
    if (disposed) return;
    disposed = true;
    pendingAction.value = null;
    pendingPath.value = null;
    pendingCloseKey.value = null;
    pendingSaveConflict.value = null;
    activeKey.value = null;
    activeDefinitionKey.value = null;
    definitionTabs.value = [];
    pathKeys.clear();
    drillDownSources.clear();
    for (const record of controllers) void disposeController(record);
    records.value = [];
    controllers.clear();
  }

  return workspaceFacade;
}
