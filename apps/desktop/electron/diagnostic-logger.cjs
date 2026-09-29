const fs = require("node:fs/promises");
const path = require("node:path");

const EVENTS = new Set([
  "app_start", "app_ready", "app_quit", "app_error", "renderer_gone",
  "engine_spawn", "engine_spawn_failed", "engine_process_error", "engine_exit",
  "engine_timeout", "engine_protocol_error", "engine_stderr", "engine_write_failed",
]);
const NUMERIC_FIELDS = new Set([
  "epoch", "code", "exitCode", "stderrBytes", "pendingRequests", "timeoutMs", "durationMs",
]);
const ENUM_FIELDS = {
  level: new Set(["info", "warn", "error"]),
  platform: new Set(["win32", "linux", "darwin"]),
  operation: new Set(["startup", "open_project", "save_project", "window_create", "uncaught_exception", "unhandled_rejection"]),
  reason: new Set([
    "stdout_error", "response_too_large", "invalid_json", "invalid_response",
    "clean-exit", "abnormal-exit", "killed", "crashed", "oom", "launch-failed", "integrity-failure",
  ]),
};

/**
 * 创建仅写本机的有界诊断日志。字段白名单阻止工程、路径、协议全文和原始 stderr 落盘。
 * @param {{directory: string, maxFileBytes?: number, maxFiles?: number, maxQueuedEntries?: number}} options 日志目录；默认每文件 1 MiB、共 3 文件、最多排队 128 条。
 * @returns {{log: (event: string, fields?: object) => boolean, flush: () => Promise<void>, filePath: string, status: () => {disabled: boolean, droppedEntries: number}}} 写入失败后停用日志但不抛出 I/O 异常；flush 等待已接收日志写完。
 */
function createDiagnosticLogger(options) {
  const filePath = path.join(options.directory, "circuit-platform.log");
  const maxFileBytes = boundedInteger(options.maxFileBytes, 1024 * 1024, 256, 16 * 1024 * 1024);
  const maxFiles = boundedInteger(options.maxFiles, 3, 1, 10);
  const maxQueuedEntries = boundedInteger(options.maxQueuedEntries, 128, 1, 1024);
  const queue = [];
  let draining = null;
  let initialized = false;
  let currentBytes = 0;
  let disabled = false;
  let droppedEntries = 0;

  // 同一实例只运行一个写入循环，保证轮转与追加的顺序；失败时停止重试，避免磁盘故障反复干扰主进程。
  async function drain() {
    try {
      if (!initialized) {
        await fs.mkdir(options.directory, { recursive: true });
        currentBytes = await fs.stat(filePath).then((stat) => stat.size, (error) => {
          if (error.code === "ENOENT") return 0;
          throw error;
        });
        initialized = true;
      }
      while (queue.length > 0) {
        const line = queue.shift();
        const bytes = Buffer.byteLength(line);
        if (currentBytes + bytes > maxFileBytes) {
          await rotate();
          currentBytes = 0;
        }
        await fs.appendFile(filePath, line, { encoding: "utf8", mode: 0o600 });
        currentBytes += bytes;
      }
    } catch {
      disabled = true;
      droppedEntries += queue.length + 1;
      queue.length = 0;
    }
  }

  async function rotate() {
    if (maxFiles === 1) {
      await fs.rm(filePath, { force: true });
      return;
    }
    await fs.rm(`${filePath}.${maxFiles - 1}`, { force: true });
    for (let index = maxFiles - 2; index >= 0; index -= 1) {
      const source = index === 0 ? filePath : `${filePath}.${index}`;
      try {
        await fs.rename(source, `${filePath}.${index + 1}`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }

  /** 接收受支持事件；队列满、记录过大或日志已停用时返回 false，不阻塞业务。 */
  function log(event, fields = {}) {
    if (!EVENTS.has(event)) return false;
    if (disabled || queue.length >= maxQueuedEntries) {
      droppedEntries += 1;
      return false;
    }
    const line = `${JSON.stringify({ timestamp: new Date().toISOString(), event, ...safeFields(fields) })}\n`;
    if (Buffer.byteLength(line) > maxFileBytes) {
      droppedEntries += 1;
      return false;
    }
    queue.push(line);
    startDrain();
    return true;
  }

  function startDrain() {
    if (draining || disabled || queue.length === 0) return;
    draining = drain().finally(() => {
      draining = null;
      startDrain();
    });
  }

  /** 等待当前已接收的日志写完；写入失败不会拒绝 Promise。 */
  async function flush() {
    while (draining) await draining;
  }

  return {
    log,
    flush,
    filePath,
    /** 返回日志退化状态和丢弃条数，不暴露工程或运行时内容。 */
    status: () => ({ disabled, droppedEntries }),
  };
}

function safeFields(fields) {
  const safe = {};
  if (!fields || typeof fields !== "object") return safe;
  for (const [key, value] of Object.entries(fields)) {
    if (NUMERIC_FIELDS.has(key) && typeof value === "number" && Number.isFinite(value)) {
      safe[key] = value;
    } else if (key === "packaged" && typeof value === "boolean") {
      safe[key] = value;
    } else if (Object.hasOwn(ENUM_FIELDS, key) && ENUM_FIELDS[key].has(value)) {
      safe[key] = value;
    } else if (key === "code" && typeof value === "string" && /^[A-Z][A-Z0-9_]{0,31}$/.test(value)) {
      safe[key] = value;
    } else if (key === "signal" && typeof value === "string" && /^SIG[A-Z0-9]{1,12}$/.test(value)) {
      safe[key] = value;
    } else if (key === "version" && typeof value === "string" && /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]{1,32})?$/.test(value)) {
      safe[key] = value;
    }
  }
  return safe;
}

function boundedInteger(value, fallback, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

module.exports = { createDiagnosticLogger };
