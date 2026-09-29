const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");

/** Electron IPC 仅保留 message；此死亡前缀必须与渲染层工作区的恢复标记同步。 */
const PROCESS_EXITED_MESSAGE_PREFIX = "C++ 引擎进程已退出";
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/**
 * 管理一条 JSON Lines 长连接。进程死亡或通信状态不可信时拒绝全部请求，
 * 仅健康检查通过 restart() 允许下一次请求建立空引擎，避免业务操作静默丢失电路。
 */
class EngineClient {
  /**
   * @param {string} enginePath 引擎路径。
   * @param {readonly string[]} spawnArgs 引擎参数；测试可运行脚本替身。
   * @param {{requestTimeoutMs?: number, maxResponseBytes?: number, onDiagnostic?: (event: string, fields: Record<string, unknown>) => void}} options 有界响应、超时和不含协议内容的诊断回调。
   */
  constructor(enginePath, spawnArgs = [], options = {}) {
    this.enginePath = enginePath;
    this.spawnArgs = spawnArgs;
    this.engine = null;
    this.buffer = "";
    this.pending = new Map();
    this.closed = false;
    this.requestTimeoutMs = positiveInteger(options.requestTimeoutMs, 5000);
    this.maxResponseBytes = positiveInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES);
    this.onDiagnostic = options.onDiagnostic;
    this.deathError = null;
    /** 成功 spawn 的换代次数；健康检查用它通知渲染层重建电路。 */
    this.epoch = 0;
  }

  /** 返回当前进程或惰性启动；已关闭和已死亡状态均拒绝业务请求。 */
  ensureProcess() {
    if (this.closed) throw new Error("C++ 引擎客户端已关闭");
    if (this.deathError) throw this.deathError;
    return this.engine ?? this.spawnProcess();
  }

  /** 启动隐藏的子进程，并以进程身份隔离旧进程的延迟事件。 */
  spawnProcess() {
    const engine = spawn(this.enginePath, [...this.spawnArgs], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.engine = engine;
    let spawned = false;
    let stderrBytes = 0;
    // UTF-8 字符可能跨 chunk；让流内部解码器保留未完整的字节。
    engine.stdout.setEncoding("utf8");
    engine.stdout.on("data", (chunk) => {
      if (this.engine === engine) this.handleOutput(chunk, engine);
    });
    engine.stdout.on("error", () => {
      this.invalidateProcess(engine, "无法读取 C++ 引擎响应", "engine_protocol_error", { reason: "stdout_error" });
    });
    // stderr 必须持续排空，否则管道满后引擎会卡死；只累计字节，不记录原始输出。
    engine.stderr.on("data", (chunk) => {
      stderrBytes = Math.min(Number.MAX_SAFE_INTEGER, stderrBytes + chunk.length);
    });
    engine.stderr.on("error", () => {});
    engine.stdin.on("error", (error) => {
      if (spawned) this.invalidateProcess(engine, "无法写入 C++ 引擎请求", "engine_write_failed", { code: error.code });
    });
    engine.on("spawn", () => {
      spawned = true;
      if (this.engine !== engine || this.closed) return;
      this.epoch += 1;
      this.diagnostic("engine_spawn", { epoch: this.epoch });
    });
    engine.on("error", (error) => {
      if (this.engine !== engine || this.closed) return;
      if (spawned) {
        this.invalidateProcess(engine, "C++ 引擎进程发生异常", "engine_process_error", { code: error.code });
        return;
      }
      // 引擎从未启动的错误允许重试；旧句柄的后续事件不得清除新进程。
      this.engine = null;
      this.buffer = "";
      this.diagnostic("engine_spawn_failed", { code: error.code });
      this.rejectPending(error);
    });
    engine.on("close", () => {
      if (stderrBytes > 0) this.diagnostic("engine_stderr", { stderrBytes });
    });
    engine.on("exit", (code, signal) => {
      if (this.engine !== engine || this.closed) return;
      this.invalidateProcess(
        engine,
        `code=${code}, signal=${signal ?? "none"}`,
        "engine_exit",
        { code, signal, epoch: this.epoch },
        false,
      );
    });
    return engine;
  }

  /** 清除死亡记录；仅恢复路径调用，关闭后的客户端仍不可复用。 */
  restart() {
    this.deathError = null;
  }

  /**
   * 发送不含 requestId 的消息并返回匹配的响应。超时意味着引擎可能已修改状态，
   * 因此终止该进程并拒绝其余等待请求，不能继续把未知状态当作可用电路。
   * @param {Record<string, unknown>} message 协议消息。
   * @returns {Promise<Record<string, unknown>>} 响应；通信失败携带稳定的进程死亡标记。
   */
  async request(message) {
    const requestId = randomUUID();
    const serialized = `${JSON.stringify({ ...message, requestId })}\n`;
    const engine = this.ensureProcess();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.invalidateProcess(engine, "C++ 引擎请求超时", "engine_timeout", {
          timeoutMs: this.requestTimeoutMs,
          pendingRequests: this.pending.size,
        });
      }, this.requestTimeoutMs);
      this.pending.set(requestId, { resolve, reject, timeout });
      try {
        engine.stdin.write(serialized);
      } catch (error) {
        this.invalidateProcess(engine, "无法写入 C++ 引擎请求", "engine_write_failed", { code: error.code });
      }
    });
  }

  /** 消费 UTF-8 文本并限制每条响应的字节数；失去可信边界时立即隔离进程。 */
  handleOutput(chunk, engine = this.engine) {
    if (!engine || this.engine !== engine) return;
    this.buffer += chunk;
    let lineEnd = this.buffer.indexOf("\n");
    while (lineEnd >= 0) {
      const line = this.buffer.slice(0, lineEnd);
      this.buffer = this.buffer.slice(lineEnd + 1);
      if (Buffer.byteLength(line, "utf8") > this.maxResponseBytes) {
        this.invalidateProcess(engine, "C++ 引擎响应超过大小限制", "engine_protocol_error", { reason: "response_too_large" });
        return;
      }
      if (line.trim()) this.handleLine(line, engine);
      if (this.engine !== engine) return;
      lineEnd = this.buffer.indexOf("\n");
    }
    if (Buffer.byteLength(this.buffer, "utf8") > this.maxResponseBytes) {
      this.invalidateProcess(engine, "C++ 引擎响应超过大小限制", "engine_protocol_error", { reason: "response_too_large" });
    }
  }

  /** 验证 JSON 和请求身份；未知身份表示协议失步，不能将结果交给其他请求。 */
  handleLine(line, engine = this.engine) {
    let response;
    try {
      response = JSON.parse(line);
    } catch {
      this.invalidateProcess(engine, "C++ 引擎返回了无效 JSON", "engine_protocol_error", { reason: "invalid_json" });
      return;
    }
    const requestId = response?.requestId;
    const pending = typeof requestId === "string" ? this.pending.get(requestId) : undefined;
    if (!pending || !response || Array.isArray(response) || typeof response.type !== "string") {
      this.invalidateProcess(engine, "C++ 引擎返回了无效响应", "engine_protocol_error", { reason: "invalid_response" });
      return;
    }
    this.pending.delete(requestId);
    clearTimeout(pending.timeout);
    pending.resolve(response);
  }

  /** 原子隔离异常进程，避免 exit、stdout 和健康恢复之间的旧事件污染新进程。 */
  invalidateProcess(engine, reason, event, fields = {}, kill = true) {
    if (!engine || this.engine !== engine || this.closed) return;
    this.engine = null;
    this.buffer = "";
    const error = new Error(`${PROCESS_EXITED_MESSAGE_PREFIX}（${reason}），等待健康检查恢复。`);
    this.deathError = error;
    this.diagnostic(event, fields);
    this.rejectPending(error);
    if (kill && !engine.killed) engine.kill("SIGKILL");
  }

  /** 拒绝全部等待请求并清理超时计时器。 */
  rejectPending(error) {
    for (const { reject, timeout } of this.pending.values()) {
      clearTimeout(timeout);
      reject(error);
    }
    this.pending.clear();
  }

  /** 诊断接收器不可影响引擎行为，也不接收工程内容或原始错误消息。 */
  diagnostic(event, fields) {
    try {
      const result = this.onDiagnostic?.(event, fields);
      if (result && typeof result.catch === "function") result.catch(() => {});
    } catch {}
  }

  /** 关闭进程并结束所有等待请求；重复调用安全。 */
  close() {
    if (this.closed) return;
    this.closed = true;
    this.rejectPending(new Error("C++ 引擎客户端已关闭"));
    const engine = this.engine;
    this.engine = null;
    this.buffer = "";
    if (engine && !engine.killed) engine.kill("SIGKILL");
  }
}

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

module.exports = { EngineClient, PROCESS_EXITED_MESSAGE_PREFIX };
