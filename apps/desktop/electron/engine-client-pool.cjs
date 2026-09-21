const { EngineClient, PROCESS_EXITED_MESSAGE_PREFIX } = require("./engine-client.cjs");

/** 默认单文档键；旧版渲染层仍通过这个键工作。 */
const DEFAULT_DOCUMENT_KEY = "default";

/**
 * 按文档键持有独立的 EngineClient。
 *
 * Pool 只负责承载边界：请求如何编码、requestId 如何匹配以及进程死亡如何收敛仍由
 * EngineClient 负责。每个键只创建一份客户端，因此客户端内部的行缓冲、待处理请求、
 * 死亡原因和进程代号天然不会跨文档共享。
 */
class EngineClientPool {
  /**
   * @param {string} enginePath 引擎可执行文件路径。
   * @param {{ spawnArgs?: readonly string[], createClient?: (enginePath: string, spawnArgs: readonly string[], documentKey: string) => EngineClient }} [options]
   */
  constructor(enginePath, options = {}) {
    this.enginePath = enginePath;
    this.spawnArgs = options.spawnArgs ?? [];
    this.createClient = options.createClient ?? ((path, args) => new EngineClient(path, args));
    /** @type {Map<string, EngineClient>} */
    this.clients = new Map();
    this.closed = false;
  }

  /**
   * 取得文档对应的客户端；这里只创建客户端对象，不会启动子进程。
   * @param {string} documentKey 稳定的文档键。
   * @returns {EngineClient} 文档专属客户端。
   */
  clientFor(documentKey) {
    const key = requireDocumentKey(documentKey);
    if (this.closed) throw new Error("C++ 引擎客户端池已关闭");
    let client = this.clients.get(key);
    if (client === undefined) {
      client = this.createClient(this.enginePath, this.spawnArgs, key);
      this.clients.set(key, client);
    }
    return client;
  }

  /**
   * 把一条业务请求路由到指定文档；业务消息本身不增加文档字段，避免改变共享协议。
   * @param {string} documentKey 文档键。
   * @param {Record<string, unknown>} message 不含 requestId 的协议消息。
   * @returns {Promise<Record<string, unknown>>} 对应客户端的响应。
   */
  request(documentKey, message) {
    return this.clientFor(documentKey).request(message);
  }

  /**
   * 对单个文档执行健康检查。恢复只清除该文档客户端的死亡记录，不影响其他键。
   * @param {string} documentKey 文档键。
   * @returns {Promise<{status: "ok" | "error" | "unavailable", message?: string, engine?: string, processEpoch?: number}>} 健康状态。
   */
  async checkHealth(documentKey) {
    if (documentKey === undefined) return this.checkProbeHealth();
    const client = this.clientFor(documentKey);
    client.restart();
    return healthResponse(client);
  }

  /** `health` 是面向调用方的短别名，保留 `checkHealth` 以便与现有命名一致。 */
  health(documentKey) {
    return this.checkHealth(documentKey);
  }

  /**
   * 没有文档时使用一次性的探针客户端；探针完成后立即回收，不进入业务客户端 Map。
   * @returns {Promise<{status: "ok" | "error" | "unavailable", message?: string, engine?: string, processEpoch?: number}>} 探针状态。
   */
  async checkProbeHealth() {
    if (this.closed) throw new Error("C++ 引擎客户端池已关闭");
    const probe = this.createClient(this.enginePath, this.spawnArgs, "<probe>");
    try {
      probe.restart();
      return await healthResponse(probe);
    } finally {
      probe.close();
    }
  }

  /**
   * 关闭一个文档并释放对应进程；不存在的键视为幂等成功。
   * @param {string} documentKey 文档键。
   */
  close(documentKey) {
    const key = requireDocumentKey(documentKey);
    const client = this.clients.get(key);
    if (client === undefined) return;
    this.clients.delete(key);
    client.close();
  }

  /** 按文档关闭的语义别名，供工作区生命周期调用。 */
  closeDocument(documentKey) {
    this.close(documentKey);
  }

  /** 关闭全部文档客户端，应用退出时调用；每个客户端独立收敛自己的请求。 */
  closeAll() {
    if (this.closed) return;
    this.closed = true;
    const clients = [...this.clients.values()];
    this.clients.clear();
    for (const client of clients) client.close();
  }

  /** 应用退出时的语义别名。 */
  shutdown() {
    this.closeAll();
  }

  /** @returns {readonly string[]} 当前已创建客户端的文档键。 */
  documentKeys() {
    return [...this.clients.keys()];
  }
}

/**
 * 执行健康请求并把协议响应转换为 Electron IPC 的稳定结果。
 * @param {EngineClient} client 要检查的客户端。
 * @returns {Promise<{status: "ok" | "error" | "unavailable", message?: string, engine?: string, processEpoch?: number}>} 健康结果。
 */
async function healthResponse(client) {
  try {
    const response = await client.request({ type: "health_check" });
    if (response.type === "health_check_result") {
      return {
        status: "ok",
        engine: response.engine,
        processEpoch: client.epoch,
      };
    }
    return { status: "error", message: response.message || "C++ 引擎返回了错误" };
  } catch (error) {
    return {
      status: error?.code === "ENOENT" ? "unavailable" : "error",
      message: error?.code === "ENOENT"
        ? "尚未找到 C++ 引擎，请先执行 pnpm build:engine"
        : error instanceof Error ? error.message : "无法连接到 C++ 引擎",
    };
  }
}

/** @param {unknown} value @returns {string} 通过校验的文档键。 */
function requireDocumentKey(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError("documentKey 必须是非空字符串");
  }
  return value;
}

module.exports = {
  DEFAULT_DOCUMENT_KEY,
  EngineClientPool,
  PROCESS_EXITED_MESSAGE_PREFIX,
  requireDocumentKey,
};
