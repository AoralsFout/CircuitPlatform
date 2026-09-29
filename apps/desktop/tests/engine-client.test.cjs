const assert = require("node:assert/strict");
const test = require("node:test");
const { once } = require("node:events");

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

    const exited = once(client.engine, "exit");
    await client.request({ type: "die" });
    await exited;
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

const RELIABLE_ENGINE_SCRIPT = `
const readline = require("node:readline");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.type === "hang") return;
  if (request.type === "invalid_json") {
    process.stdout.write("private-engine-message: invalid JSON\\n");
    return;
  }
  if (request.type === "invalid_envelope") {
    process.stdout.write("null\\n");
    return;
  }
  if (request.type === "large") {
    process.stdout.write("x".repeat(1024 * 128));
    return;
  }
  const response = JSON.stringify({ type: "health_check_result", requestId: request.requestId, status: "ok", engine: "模拟引擎" }) + "\\n";
  if (request.type === "stderr_flood") {
    process.stderr.write(Buffer.alloc(4 * 1024 * 1024, "s"), () => process.stdout.write(response));
    return;
  }
  if (request.type === "split_utf8") {
    const bytes = Buffer.from(response);
    const split = bytes.indexOf(Buffer.from("模拟")) + 1;
    process.stdout.write(bytes.subarray(0, split));
    setTimeout(() => process.stdout.write(bytes.subarray(split)), 20);
    return;
  }
  process.stdout.write(response);
});
`;

test("a timed-out process rejects all pending requests and only health recovery can replace it", async () => {
  const events = [];
  const client = new EngineClient(process.execPath, ["-e", RELIABLE_ENGINE_SCRIPT], {
    onDiagnostic: (event, fields) => events.push({ event, fields }),
  });
  try {
    await client.request({ type: "health_check" });
    const oldEngine = client.engine;
    client.requestTimeoutMs = 40;
    const results = await Promise.allSettled([
      client.request({ type: "hang" }),
      client.request({ type: "hang" }),
    ]);
    assert.ok(results.every((result) => result.status === "rejected" && result.reason.message.includes(PROCESS_EXITED_MESSAGE_PREFIX)));
    assert.match(results[0].reason.message, /超时/);
    assert.equal(oldEngine.killed, true);
    assert.equal(client.engine, null);
    assert.equal(client.pending.size, 0);
    await assert.rejects(client.request({ type: "health_check" }), /请求超时/);
    assert.equal(client.epoch, 1);

    client.requestTimeoutMs = 5000;
    client.restart();
    const replacement = client.request({ type: "health_check" });
    const newEngine = client.engine;
    oldEngine.emit("exit", 7, null);
    oldEngine.emit("error", Object.assign(new Error("late failure"), { code: "EPIPE" }));
    oldEngine.stdout.emit("data", "bad old response\\n");
    assert.equal((await replacement).status, "ok");
    assert.equal(client.engine, newEngine);
    assert.equal(client.epoch, 2);
    assert.equal(events.filter(({ event }) => event === "engine_timeout").length, 1);
  } finally {
    client.close();
  }
});

for (const [requestType, expected] of [
  ["invalid_json", /无效 JSON/],
  ["invalid_envelope", /无效响应/],
  ["large", /超过大小限制/],
]) {
  test(`${requestType} isolates the process instead of leaving an unknown circuit usable`, async () => {
    const events = [];
    const client = new EngineClient(process.execPath, ["-e", RELIABLE_ENGINE_SCRIPT], {
      maxResponseBytes: 512,
      onDiagnostic: (event, fields) => events.push({ event, fields }),
    });
    try {
      await assert.rejects(client.request({ type: requestType }), (error) => {
        assert.match(error.message, expected);
        assert.ok(error.message.includes(PROCESS_EXITED_MESSAGE_PREFIX));
        return true;
      });
      assert.equal(client.engine, null);
      assert.equal(client.buffer, "");
      await assert.rejects(client.request({ type: "health_check" }), expected);
      assert.ok(!JSON.stringify(events).includes("private-engine-message"));
      client.restart();
      assert.equal((await client.request({ type: "health_check" })).status, "ok");
      assert.equal(client.epoch, 2);
    } finally {
      client.close();
    }
  });
}

test("stderr floods are drained without blocking responses and diagnostics contain only byte counts", async () => {
  const events = [];
  const client = new EngineClient(process.execPath, ["-e", RELIABLE_ENGINE_SCRIPT], {
    onDiagnostic: (event, fields) => events.push({ event, fields }),
  });
  try {
    assert.equal((await client.request({ type: "stderr_flood" })).status, "ok");
    const closed = once(client.engine, "close");
    client.close();
    await closed;
    const stderr = events.find(({ event }) => event === "engine_stderr");
    assert.deepEqual(stderr.fields, { stderrBytes: 4 * 1024 * 1024 });
    assert.ok(JSON.stringify(events).length < 500);
  } finally {
    client.close();
  }
});

test("UTF-8 responses split between chunks remain intact and broken diagnostics cannot break requests", async () => {
  const client = new EngineClient(process.execPath, ["-e", RELIABLE_ENGINE_SCRIPT], {
    onDiagnostic: () => { throw new Error("disk unavailable"); },
  });
  try {
    assert.equal((await client.request({ type: "split_utf8" })).engine, "模拟引擎");
  } finally {
    client.close();
  }
});
