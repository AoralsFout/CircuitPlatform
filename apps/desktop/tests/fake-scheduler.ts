import type { TickScheduler } from "../src/workspace/index.ts";

/**
 * 手动点火的假调度器：注入它就能无头驱动整个连续运行，不必等真实定时器。
 * 同一时刻最多只有一次已排定的推进，因此 `fire()` 也顺带断言了「没有积压」。
 *
 * 这是 `workspace.test.ts` 与 `temporal-e2e.test.ts` 共用的测试替身，不是测试文件本身
 * （文件名不匹配 `*.test.ts`，因此不会被 `pnpm test` 的通配当作用例收集）。
 */
export class FakeScheduler implements TickScheduler {
  scheduled = 0;
  cancelled = 0;
  private pending: { run: () => void; cancelled: boolean } | null = null;

  schedule(_delayMs: number, run: () => void): () => void {
    this.scheduled += 1;
    const entry = { run, cancelled: false };
    this.pending = entry;
    return () => {
      if (entry.cancelled) return;
      entry.cancelled = true;
      this.cancelled += 1;
      if (this.pending === entry) this.pending = null;
    };
  }

  /** 触发已排定的那一次推进；当前没有排定（或已被取消）时返回 false。 */
  fire(): boolean {
    const entry = this.pending;
    this.pending = null;
    if (!entry || entry.cancelled) return false;
    entry.run();
    return true;
  }

  /** 当前还挂着的排定数量；暂停或重置之后必须是 0。 */
  pendingCount(): number {
    return this.pending === null ? 0 : 1;
  }
}

/** 让出宏任务，把工作区里已经排队的微任务全部跑完。 */
export function drain(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
