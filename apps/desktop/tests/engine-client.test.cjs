const assert = require("node:assert/strict");
const test = require("node:test");

const { EngineClient, PROCESS_EXITED_MESSAGE_PREFIX } = require("../electron/engine-client.cjs");

/**
 * 内联的引擎替身：对每条请求原样回显一个 JSON 响应；收到 die 请求后先应答再退出
 * （exit code 7），用来模拟引擎进程意外退出。 EngineClient 不解释领域响应，
 * 因此响应形状可以随意，只要带得上 requestId。
 */
const FAKE_ENGINE_SCRIPT = `
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let lineEnd = buffer.indexOf("\\n");
  while (lineEnd >= 0) {
    const line = buffer.slice(0, lineEnd).trim();
    buffer = buffer.slice(lineEnd + 1);
    if (line) {
      const request = JSON.parse(line);
      process.stdout.write(JSON.stringify({
        type: "health_check_result",
        requestId: request.requestId,
        status: "ok",
        engine: "fake",
      }) + "\\n");
      if (request.type === "die") setTimeout(() => process.exit(7), 20);
    }
    lineEnd = buffer.indexOf("\\n");
  }
});
`;

/** 等到客户端把进程死亡收敛成带稳定前缀的失败为止；期间探测请求失败但前缀不对就继续等。 */
async function waitForDeathError(client) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await client.request({ type: "probe" });
    } catch (error) {
      if (error instanceof Error && error.message.includes(PROCESS_EXITED_MESSAGE_PREFIX)) return error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("引擎死亡后请求一直没有以死亡错误失败");
}

test("a dead engine process fails later requests without silently respawning", async () => {
  const client = new EngineClient(process.execPath, ["-e", FAKE_ENGINE_SCRIPT]);
  try {
    const first = await client.request({ type: "health_check" });
    assert.equal(first.status, "ok");
    assert.equal(client.epoch, 1);

    await client.request({ type: "die" });
    const death = await waitForDeathError(client);
    assert.ok(death.message.includes("code=7"), "死亡错误要带上进程的退出原因");

    // 死亡记录挡住后续请求：不再悄悄拉起一个空电路的新进程。
    await assert.rejects(
      client.request({ type: "health_check" }),
      (error) => error instanceof Error && error.message.includes(PROCESS_EXITED_MESSAGE_PREFIX),
    );
    assert.equal(client.epoch, 1, "死亡后请求失败不得伴随进程重启");

    // 健康检查路径调用 restart() 重新拉起进程；新进程的代号递增。
    client.restart();
    const revived = await client.request({ type: "health_check" });
    assert.equal(revived.status, "ok");
    assert.equal(client.epoch, 2);
  } finally {
    client.close();
  }
});

test("a failed spawn is retryable and is not recorded as a process death", async () => {
  const client = new EngineClient("Z:/definitely/missing/circuit-engine.exe");
  try {
    await assert.rejects(client.request({ type: "health_check" }));
    // spawn 失败（引擎从未运行）不进入死亡记录：下一次请求仍允许重试拉起，
    // 与首启懒加载共享同一条语义。
    await assert.rejects(client.request({ type: "health_check" }));
    assert.equal(client.epoch, 0);
  } finally {
    client.close();
  }
});
