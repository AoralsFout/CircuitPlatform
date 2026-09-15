/** 将高频指针值合并为每个动画帧最多一次的更新。 */
export interface FrameCoalescer<T> {
  /** 覆盖当前待处理值，并在下一帧应用最新值。 */
  schedule(value: T): void;
  /** 立即应用最新值；适合 pointerup/提交前刷新。 */
  flush(): void;
  /** 丢弃尚未应用的值。 */
  cancel(): void;
}

function requestFrame(callback: FrameRequestCallback): number {
  if (typeof globalThis.requestAnimationFrame === "function") return globalThis.requestAnimationFrame(callback);
  return setTimeout(() => callback(Date.now()), 0) as unknown as number;
}

function cancelFrame(handle: number): void {
  if (typeof globalThis.cancelAnimationFrame === "function") globalThis.cancelAnimationFrame(handle);
  else clearTimeout(handle);
}

/**
 * 创建轻量的 RAF 合并器，保证高频 pointer move 不直接触发多次状态计算。
 * @param apply 每帧最多调用一次的更新函数。
 * @returns 可在 pointer move/up/cancel 生命周期中使用的合并器。
 */
export function createFrameCoalescer<T>(apply: (value: T) => void): FrameCoalescer<T> {
  let pending: T | undefined;
  let frame: number | null = null;

  const flush = (): void => {
    if (frame !== null) cancelFrame(frame);
    frame = null;
    if (pending === undefined) return;
    const value = pending;
    pending = undefined;
    apply(value);
  };

  return {
    schedule(value: T): void {
      pending = value;
      if (frame === null) frame = requestFrame(() => flush());
    },
    flush,
    cancel(): void {
      if (frame !== null) cancelFrame(frame);
      frame = null;
      pending = undefined;
    },
  };
}
