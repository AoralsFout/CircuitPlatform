const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_DOCUMENT_KEY,
  EngineClientPool,
  PROCESS_EXITED_MESSAGE_PREFIX,
} = require("../electron/engine-client-pool.cjs");

/**
 * 每个替身进程维护自己的 Component ID 计数器，因此两个文档都会返回 ID 1；
 * 如果响应被错误路由到另一份客户端，测试会在请求身份上暴露问题。
 */
const FAKE_ENGINE_SCRIPT = `
let buffer = "";
let nextComponentId = 1;
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let lineEnd = buffer.indexOf("\\n");
  while (lineEnd >= 0) {
    const line = buffer.slice(0, lineEnd).trim();
    buffer = buffer.slice(lineEnd + 1);
    if (line) {
      const request = JSON.parse(line);
      if (request.type === "hang") continue;
      const response = request.type === "add_component"
        ? { type: "component_added", componentId: nextComponentId++ }
        : { type: "health_check_result", status: "ok", engine: "pool-fake" };
      response.requestId = request.requestId;
      process.stdout.write(JSON.stringify(response) + "\\n");
      if (request.type === "die") setTimeout(() => process.exit(7), 10);
    }
    lineEnd = buffer.indexOf("\\n");
  }
});
`;

function createPool() {
  return new EngineClientPool(process.execPath, { spawnArgs: ["-e", FAKE_ENGINE_SCRIPT] });
}

async function waitForDeath(pool, documentKey) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await pool.request(documentKey, { type: "probe" });
    } catch (error) {
      if (error instanceof Error && error.message.includes(PROCESS_EXITED_MESSAGE_PREFIX)) return error;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("文档引擎一直没有收敛到死亡错误");
}

test("document requests lazily create isolated clients and preserve local IDs", async () => {
  const pool = createPool();
  try {
    assert.deepEqual(pool.documentKeys(), []);
    const [left, right] = await Promise.all([
      pool.request("left", { type: "add_component", kind: "and" }),
      pool.request("right", { type: "add_component", kind: "and" }),
    ]);
    assert.equal(left.componentId, 1);
    assert.equal(right.componentId, 1);
    assert.deepEqual(pool.documentKeys().sort(), ["left", "right"]);
    assert.equal(pool.clientFor("left").epoch, 1);
    assert.equal(pool.clientFor("right").epoch, 1);
  } finally {
    pool.closeAll();
  }
});

test("health and restart are scoped to one document", async () => {
  const pool = createPool();
  try {
    const first = await pool.checkHealth("left");
    assert.equal(first.status, "ok");
    assert.equal(first.processEpoch, 1);
    await pool.request("left", { type: "die" });
    const death = await waitForDeath(pool, "left");
    assert.match(death.message, /code=7/);

    // 另一份文档的进程和电路仍可用。
    const right = await pool.request("right", { type: "add_component", kind: "and" });
    assert.equal(right.componentId, 1);
    await assert.rejects(
      pool.request("left", { type: "add_component", kind: "and" }),
      (error) => error instanceof Error && error.message.includes(PROCESS_EXITED_MESSAGE_PREFIX),
    );

    const revived = await pool.checkHealth("left");
    assert.equal(revived.status, "ok");
    assert.equal(revived.processEpoch, 2);
    assert.equal((await pool.request("left", { type: "add_component", kind: "and" })).componentId, 1);
    assert.equal(pool.clientFor("right").epoch, 1);
  } finally {
    pool.closeAll();
  }
});

test("closing one document rejects its pending request and leaves others usable", async () => {
  const pool = createPool();
  try {
    const pending = pool.request("left", { type: "hang" });
    pool.close("left");
    await assert.rejects(pending, /客户端已关闭/);
    assert.deepEqual(pool.documentKeys(), []);
    assert.equal((await pool.request("right", { type: "add_component", kind: "and" })).componentId, 1);
  } finally {
    pool.closeAll();
  }
});

test("a health probe without a document does not create a business client", async () => {
  const pool = createPool();
  try {
    const result = await pool.checkHealth();
    assert.equal(result.status, "ok");
    assert.deepEqual(pool.documentKeys(), []);
    assert.equal(DEFAULT_DOCUMENT_KEY, "default");
  } finally {
    pool.closeAll();
  }
});
