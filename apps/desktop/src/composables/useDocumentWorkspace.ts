import { computed, ref, shallowRef, watch, type ComputedRef, type Ref } from "vue";
import type { ComponentKindName, PortSpec } from "@circuit-platform/protocol";
import { projectPathIdentity } from "../project-file/paths.ts";
import type { EditorComponentId, EditorSelection, Point, WireColorId } from "../editor/index.ts";
import { useEditorState } from "./useEditorState.ts";
import { useWorkspace, type WorkspaceBinding } from "./useWorkspace.ts";
import type { TickScheduler } from "../workspace/index.ts";
import type { DocumentTabSnapshot } from "../workspace/documentCoordinator.ts";

type EditorBinding = ReturnType<typeof useEditorState>;
type PendingAction = "open" | "new" | "load-example" | "close" | null;

interface DocumentController {
  key: string;
  hasDocument: boolean;
  binding: WorkspaceBinding;
  editor: EditorBinding;
  stopPathWatch: () => void;
}

const mutableWorkspaceRefs = new Set(["state", "editorState", "projectPath", "isDirty", "saveError", "openError", "pendingFileAction", "recentProjects"]);
const mutableEditorRefs = new Set(["showDetails", "showSidebar", "activeRailPage", "bottomTab", "zoom"]);

/**
 * 将现有单文档组合层提升为按文档键的活动投影。
 *
 * 每个 Controller 都拥有独立的 `useWorkspace`、EditorSession 和 `useEditorState`；返回对象
 * 只把活动 Controller 投影给 App，因此旧组件无需了解运行时集合，也不会把编辑器历史或视图
 * refs 共享到另一份 Project。文件路径索引在这里先于读文件执行，协调器的标签 seam 由
 * `tabs`/`activeDocumentKey` 暴露给 TopBar。
 * @returns 与旧 `useWorkspace` + `useEditorState` 兼容的活动文档 facade。
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

export function useDocumentWorkspace(options: DocumentWorkspaceOptions = {}): any {
  // Keep nested per-document refs intact; `ref()` deep-unpacks binding/editor refs inside records.
  const records = shallowRef<DocumentController[]>([]);
  const activeKey = ref<string | null>(null);
  const sequence = ref(1);
  const pathKeys = new Map<string, string>();
  const pendingAction = ref<PendingAction>(null);
  const pendingPath = ref<string | null>(null);
  const pendingCloseKey = ref<string | null>(null);
  const actionError = ref<string | null>(null);
  const opening = new Map<string, Promise<boolean>>();
  // Tab activation is serialized so a rapid A → B → C sequence cannot let an
  // older pause finish after a newer activation and publish the wrong active view.
  let activationChain: Promise<void> = Promise.resolve();

  function platform(): Window["circuitPlatform"] {
    return window.circuitPlatform;
  }

  function createController(): DocumentController {
    const key = `document-${sequence.value++}`;
    const scheduler = options.schedulerFactory?.(key) ?? options.scheduler;
    const recoveryScheduler = options.recoverySchedulerFactory?.(key) ?? options.recoveryScheduler;
    // Keep the production path's narrow facade explicit; test-only scheduler injection
    // adds no shared coordination state and remains scoped to this controller.
    const binding = scheduler === undefined && recoveryScheduler === undefined
      ? useWorkspace({ documentKey: key })
      : useWorkspace({ documentKey: key, scheduler, recoveryScheduler });
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
    return { key, hasDocument: false, binding, editor, stopPathWatch };
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
    activeKey.value = record.key;
    actionError.value = null;
  }

  /** Pause the previous live document before publishing a new active document. */
  function activateRecord(record: DocumentController): Promise<void> {
    const operation = activationChain.then(async () => {
      // The initial empty controller is projected while activeKey is null. It still
      // needs an explicit key when its first Project becomes a real document.
      if (activeKey.value === record.key) return;
      const previous = active.value;
      if (previous?.hasDocument && previous.binding.state.value.simulationState === "running") {
        await previous.binding.pause();
      }
      setActive(record);
    });
    activationChain = operation.catch(() => undefined);
    return operation;
  }

  async function openProject(path: string): Promise<boolean> {
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
      const record = current?.hasDocument === false ? current : createController();
      await record.binding.bootstrap();
      const opened = await record.binding.openProjectFromPath(path);
      if (!opened) {
        actionError.value = record.binding.openError.value;
        if (record !== current) record.binding.dispose();
        return false;
      }
      record.hasDocument = true;
      if (!records.value.includes(record)) records.value = [...records.value, record];
      pathKeys.set(identity, record.key);
      await activateRecord(record);
      return true;
    })();
    opening.set(identity, operation);
    try { return await operation; } finally { opening.delete(identity); }
  }

  async function createNewDocument(): Promise<boolean> {
    const current = active.value;
    const record = current?.hasDocument === false ? current : createController();
    await record.binding.bootstrap();
    await record.binding.requestNew();
    if (record.binding.editorState.value === null) {
      actionError.value = record.binding.openError.value ?? "新建文档失败。";
      if (record !== current) record.binding.dispose();
      return false;
    }
    record.hasDocument = true;
    if (!records.value.includes(record)) records.value = [...records.value, record];
    await activateRecord(record);
    return true;
  }

  async function requestOpen(): Promise<void> {
    const current = active.value;
    if (current?.binding.isDirty.value) {
      pendingAction.value = "open";
      pendingPath.value = null;
      return;
    }
    const picked = await platform().pickOpenPath();
    if (picked.ok) await openProject(picked.path);
    else if (picked.reason !== "canceled") actionError.value = picked.reason;
  }

  async function requestOpenRecent(path: string): Promise<void> {
    const current = active.value;
    if (current?.binding.isDirty.value) {
      pendingAction.value = "open";
      pendingPath.value = path;
      return;
    }
    await openProject(path);
  }

  async function requestNew(): Promise<void> {
    if (active.value?.binding.isDirty.value) {
      pendingAction.value = "new";
      pendingPath.value = null;
      return;
    }
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

  async function closeTab(key: string, discard = false): Promise<void> {
    const index = records.value.findIndex((record) => record.key === key);
    const record = records.value[index];
    if (!record || !record.hasDocument) return;
    if (record.binding.isDirty.value && !discard) {
      pendingAction.value = "close";
      pendingCloseKey.value = key;
      return;
    }
    const next = records.value.filter((candidate) => candidate.key !== key);
    const identity = record.binding.projectPath.value;
    if (identity !== null) pathKeys.delete(projectPathIdentity(identity));
    record.binding.dispose();
    record.stopPathWatch();
    records.value = next;
    if (activeKey.value === key) {
      const replacement = next[index] ?? next[index - 1] ?? next[0];
      activeKey.value = replacement?.key ?? null;
    }
    if (records.value.length === 0) ensureController();
  }

  function activateTab(key: string): Promise<void> {
    const record = records.value.find((candidate) => candidate.key === key && candidate.hasDocument);
    return record ? activateRecord(record) : Promise.resolve();
  }

  const tabs = computed<readonly DocumentTabSnapshot[]>(() => records.value
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
    })));

  const refNames = new Set([...mutableWorkspaceRefs, "canSave", "projectName", "saveState", "recentProjects"]);
  const editorRefNames = new Set(["showDetails", "showSidebar", "activeRailPage", "bottomTab", "zoom", "viewport", "interaction"]);

  function projectRef(name: string): ComputedRef<unknown> {
    return computed({
      get: () => {
        const record = active.value;
        const value = record?.binding[name as keyof WorkspaceBinding] as unknown;
        if (name === "openError") return actionError.value ?? (value as Ref<unknown> | undefined)?.value ?? null;
        return (value as Ref<unknown> | ComputedRef<unknown> | undefined)?.value ?? value;
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
      if (property === "activeDocumentKey") return computed(() => activeKey.value);
      if (property === "activateTab") return activateTab;
      if (property === "closeTab") return closeTab;
      if (property === "requestOpen") return requestOpen;
      if (property === "requestOpenRecent") return requestOpenRecent;
      if (property === "requestNew") return requestNew;
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
  return workspaceFacade;
}
