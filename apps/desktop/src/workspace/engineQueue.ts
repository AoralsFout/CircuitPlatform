/**
 * 引擎调用的串行化队列。
 *
 * 一次仿真会话里同时只有一条引擎请求在飞：运行中的推进、输入提交与结构提交共用这条队列，
 * 后到的请求排队等待，而不是与在飞的那条并发。排队不等于丢弃——每一条请求都会被顺序执行。
 *
 * 队列是**一个共享对象**，不是每个调用方各自的锁：`useWorkspace` 建一条队列，同时交给
 * 工作区与编辑器的引擎端口，两条路径因此排在同一队里。任何一方单独建一条都等于没有串行化。
 */
export interface EngineCallQueue {
  /**
   * 把一次引擎调用排进队列。
   * @param task 真正发出请求的函数；它的成败都不影响后续请求照常出队。
   * @returns 在本次调用完成（成功或失败）后兑现的 Promise。
   */
  enqueue<T>(task: () => Promise<T>): Promise<T>;
}

/**
 * 新建一条引擎调用队列。
 * @returns 严格按入队顺序执行任务的队列。
 */
export function createEngineCallQueue(): EngineCallQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      // 前一条无论成败，后一条都要照常执行，因此两个分支传同一个 task。
      const result = tail.then(task, task);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
