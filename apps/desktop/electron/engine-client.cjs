const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");

/**
 * 维护 Electron 主进程到 C++ 引擎的一条 JSON Lines 长连接。
 * 客户端负责请求身份匹配、行缓冲和进程异常收敛；不解释领域响应内容。
 */
class EngineClient {
  constructor(enginePath) {
    this.enginePath = enginePath;
    this.engine = null;
    this.buffer = "";
    this.pending = new Map();
    this.closed = false;
    this.requestTimeoutMs = 5000;
  }

  ensureProcess() {
    if (this.engine) return this.engine;
    if (this.closed) throw new Error("C++ 引擎客户端已关闭");

    const engine = spawn(this.enginePath, [], { stdio: ["pipe", "pipe", "pipe"] });
    this.engine = engine;
    engine.stdout.on("data", (chunk) => this.handleOutput(chunk.toString()));
    engine.on("error", (error) => this.handleProcessFailure(error));
    engine.on("exit", (code, signal) => {
      this.engine = null;
      this.buffer = "";
      this.rejectPending(new Error(`C++ 引擎已退出（code=${code}, signal=${signal ?? "none"}）`));
    });
    return engine;
  }

  /**
   * 发送一条请求并等待同 requestId 的响应。
   * @param {Record<string, unknown>} message 不含 requestId 的协议消息。
   * @returns {Promise<Record<string, unknown>>} 引擎返回的 JSON 对象。
   */
  request(message) {
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

module.exports = { EngineClient };
