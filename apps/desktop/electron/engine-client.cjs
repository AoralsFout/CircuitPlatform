const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");

/**
 * 进程死亡错误的稳定消息前缀。
 * Electron IPC 只把 Error 的 message 带到渲染层，渲染层的工作区靠这段文案把「进程死亡」
 * 与普通传输故障区分开（见 `apps/desktop/src/workspace/index.ts` 的
 * `ENGINE_PROCESS_EXITED_MARKER`，两处必须同步修改）。
 */
const PROCESS_EXITED_MESSAGE_PREFIX = "C++ 引擎进程已退出";

/**
 * 维护 Electron 主进程到 C++ 引擎的一条 JSON Lines 长连接。
 * 客户端负责请求身份匹配、行缓冲和进程异常收敛；不解释领域响应内容。
 *
 * 进程死亡后客户端进入不可用状态：后续请求一律以死亡错误失败，**不会**悄悄拉起一个
 * 空电路的新进程——那会让渲染层以为元件还在。重新拉起只由 `restart()` 开启，
 * 生产路径上只有健康检查调用它。
 */
class EngineClient {
  /**
   * @param {string} enginePath 引擎可执行文件路径。
   * @param {readonly string[]} spawnArgs 附带给引擎进程的参数；测试用它运行内联脚本替身。
   */
  constructor(enginePath, spawnArgs = []) {
    this.enginePath = enginePath;
    this.spawnArgs = spawnArgs;
    this.engine = null;
    this.buffer = "";
    this.pending = new Map();
    this.closed = false;
    this.requestTimeoutMs = 5000;
    /** 进程意外退出后记录的失败原因；为 null 表示可以按需拉起进程。 */
    this.deathError = null;
    /**
     * 成功拉起过的进程个数，每次成功 spawn 递增。随健康检查结果回给渲染层，
     * 用于判断「引擎进程是否真的换过」——进程没换时电路还在，不需要重建。
     */
    this.epoch = 0;
    /** 当前这个子进程是否已报告过 spawn 失败；用于让随后的 exit 事件不被当成进程死亡。 */
    this.spawnFailed = false;
  }

  ensureProcess() {
    if (this.engine) return this.engine;
    if (this.closed) throw new Error("C++ 引擎客户端已关闭");
    if (this.deathError) throw this.deathError;
    return this.spawnProcess();
  }

  spawnProcess() {
    const engine = spawn(this.enginePath, [...this.spawnArgs], { stdio: ["pipe", "pipe", "pipe"] });
    this.engine = engine;
    this.spawnFailed = false;
    // 进程退出瞬间的 stdin 写入会产生 EPIPE 一类的流错误；死亡收敛由 exit 事件统一负责，
    // 这里静默吞掉流错误，避免无人处理的 'error' 事件变成未捕获异常。
    engine.stdin.on("error", () => {});
    engine.stdout.on("data", (chunk) => this.handleOutput(chunk.toString()));
    // 'spawn' 事件只在进程真正启动成功后发出：计数因此表示「可服务的进程」换代次数。
    engine.on("spawn", () => {
      this.epoch += 1;
    });
    engine.on("error", (error) => {
      // spawn 失败（例如引擎可执行文件不存在）不是「进程死亡」：引擎从未运行过，
      // 下一次请求仍允许重试拉起，与首启懒加载的语义一致。
      this.spawnFailed = true;
      this.handleProcessFailure(error);
    });
    engine.on("exit", (code, signal) => {
      if (this.closed) return;
      this.engine = null;
      this.buffer = "";
      if (this.spawnFailed) {
        // spawn 已经由 error 事件处理过，这里的 exit 只是收尾，不能记成进程死亡。
        this.spawnFailed = false;
        return;
      }
      const error = new Error(
        `${PROCESS_EXITED_MESSAGE_PREFIX}（code=${code}, signal=${signal ?? "none"}），等待健康检查恢复。`,
      );
      this.deathError = error;
      this.rejectPending(error);
    });
    return engine;
  }

  /**
   * 清除进程死亡记录，让下一次请求重新拉起引擎进程。
   * 只由恢复路径（健康检查）调用；业务请求不经过这里，因此进程死亡后不会在业务请求上
   * 悄悄换一个空电路的新进程。
   */
  restart() {
    this.deathError = null;
  }

  /**
   * 发送一条请求并等待同 requestId 的响应。
   * @param {Record<string, unknown>} message 不含 requestId 的协议消息。
   * @returns {Promise<Record<string, unknown>>} 引擎返回的 JSON 对象；进程已死亡时以死亡错误拒绝。
   */
  async request(message) {
    const requestId = randomUUID();
    const request = { ...message, requestId };
    const engine = this.ensureProcess();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`C++ 引擎请求超时: ${request.type}`));
      }, this.requestTimeoutMs);
      this.pending.set(requestId, { resolve, reject, timeout });
      try {
        engine.stdin.write(`${JSON.stringify(request)}\n`);
      } catch (error) {
        this.pending.delete(requestId);
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  handleOutput(chunk) {
    this.buffer += chunk;
    let lineEnd = this.buffer.indexOf("\n");
    while (lineEnd >= 0) {
      const line = this.buffer.slice(0, lineEnd).trim();
      this.buffer = this.buffer.slice(lineEnd + 1);
      if (line) this.handleLine(line);
      lineEnd = this.buffer.indexOf("\n");
    }
  }

  handleLine(line) {
    let response;
    try {
      response = JSON.parse(line);
    } catch {
      this.rejectPending(new Error("C++ 引擎返回了无效 JSON"));
      return;
    }

    const requestId = response?.requestId;
    const pending = typeof requestId === "string" ? this.pending.get(requestId) : undefined;
    if (!pending) return;
    this.pending.delete(requestId);
    clearTimeout(pending.timeout);
    pending.resolve(response);
  }

  handleProcessFailure(error) {
    this.engine = null;
    this.rejectPending(error);
  }

  rejectPending(error) {
    for (const { reject, timeout } of this.pending.values()) {
      clearTimeout(timeout);
      reject(error);
    }
    this.pending.clear();
  }

  /** 关闭引擎进程，并让所有等待中的请求结束。 */
  close() {
    this.closed = true;
    this.rejectPending(new Error("C++ 引擎客户端已关闭"));
    if (this.engine && !this.engine.killed) this.engine.kill();
    this.engine = null;
  }
}

module.exports = { EngineClient, PROCESS_EXITED_MESSAGE_PREFIX };
