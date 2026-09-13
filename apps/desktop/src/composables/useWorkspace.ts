import { readonly, shallowRef, type DeepReadonly, type Ref } from "vue";
import {
  createWorkspace,
  type InputKey,
  type WorkspaceSnapshot,
} from "../workspace";

interface WorkspaceBinding {
  state: DeepReadonly<Ref<WorkspaceSnapshot>>;
  bootstrap(): Promise<void>;
  checkEngine(): Promise<void>;
  runSimulation(): Promise<void>;
  toggleInput(key: InputKey): Promise<void>;
}

/**
 * 将工作区领域模块接入 Vue 响应式系统，并统一处理首次启动与引擎恢复流程。
 * @returns 只读工作区快照，以及供界面触发的异步操作。
 */
export function useWorkspace(): WorkspaceBinding {
  const workspace = createWorkspace(window.circuitPlatform);
  const state = shallowRef(workspace.snapshot());

  async function reflect(operation: () => Promise<WorkspaceSnapshot>): Promise<void> {
    const pending = operation();
    state.value = workspace.snapshot();
    state.value = await pending;
  }

  async function loadDemoWhenReady(): Promise<void> {
    if (state.value.engineState === "ready" && !state.value.labIds) {
      await reflect(() => workspace.loadDemoCircuit());
    }
  }

  async function checkEngine(): Promise<void> {
    await reflect(() => workspace.checkEngine());
    await loadDemoWhenReady();
  }

  async function runSimulation(): Promise<void> {
    await reflect(() => workspace.runSimulation());
  }

  async function toggleInput(key: InputKey): Promise<void> {
    await reflect(() => workspace.toggleInput(key));
  }

  return {
    state: readonly(state),
    bootstrap: checkEngine,
    checkEngine,
    runSimulation,
    toggleInput,
  };
}
