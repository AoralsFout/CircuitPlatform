import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { ComponentKindName, EngineResponse, Signal } from "@circuit-platform/protocol";
import {
  createWorkspace,
  type CircuitDocument,
  type EngineAdapter,
  type SimulationBindings,
  type WorkspaceSnapshot,
} from "../src/workspace/index.ts";
import { drain, FakeScheduler } from "./fake-scheduler.ts";

/**
 * 时序电路的端到端回归：真实 `circuit-engine` 二进制 + 真实 JSON Lines 协议 + 真实工作区运行循环。
 *
 * 与 `workspace.test.ts` 的分工是刻意的：那里的 `FakeEngine` 只实现「按连接求值」这一个最小可观察语义，
 * 不在前端 fake 里重新实现时序语义；因此「q 只在上升沿更新」「重置后 q 回到 X」这类断言只能由真实引擎回答。
 * 本文件把三者接在一起，从电路推送一路跑到连续运行、暂停、继续与重置。
 *
 * 引擎二进制由 `pnpm build:engine` 产出。它不存在时（`pnpm test` 跑在 `build:engine` 之前，干净检出上就是这样）
 * 本文件优雅跳过，`pnpm verify` 的 `test:engine` 步骤会在引擎就绪之后把它重跑一遍。
 *
 * 这条跳过规则有一处已知冗余：`pnpm test` 的通配本来就包含本文件，因此**在已构建的检出上
 * `pnpm verify` 会把它跑两次**（`pnpm test` 一次，`test:engine` 一次）。第二次是有意保留的——
 * 它保证这条回归一定跑在刚刚 `build:engine` 产出的引擎上，而第一次在干净检出上只会跳过。
 * 两次都不影响正确性，只是多花一次进程启动的时间。
 */

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const engineFileName = process.platform === "win32" ? "circuit-engine.exe" : "circuit-engine";
// 与 `electron/main.cjs` 的 `getEnginePath()` 同一条规则，允许测试替换引擎位置。
const enginePath = process.env.CIRCUIT_ENGINE_PATH ?? resolve(desktopRoot, "../../engine/build", engineFileName);

interface ProtocolEngineClient {
  request(message: Record<string, unknown>): Promise<EngineResponse>;
  close(): void;
}

const require_ = createRequire(import.meta.url);

/** 把长连接客户端包成工作区 adapter；与 `main.cjs` 的 IPC 通道逐一对应，不加载任何领域规则。 */
function createEngineAdapter(client: ProtocolEngineClient): EngineAdapter {
  return {
    async checkEngine() {
      const response = await client.request({ type: "health_check" });
      if (response.type !== "health_check_result") {
        return { status: "error" as const, message: "引擎没有返回健康状态。" };
      }
      return { status: "ok" as const, engine: response.engine };
    },
    addComponent: (kind: ComponentKindName) => client.request({ type: "add_component", kind }),
    addConnection: (source, target) =>
      client.request({
        type: "add_connection",
        sourceComponentId: source.componentId,
        sourcePort: source.port,
        targetComponentId: target.componentId,
        targetPort: target.port,
      }),
    removeComponent: (componentId: number) => client.request({ type: "remove_component", componentId }),
    removeConnection: (connectionId: number) => client.request({ type: "remove_connection", connectionId }),
    setInput: (componentId: number, value: Signal) => client.request({ type: "set_input", componentId, value }),
    settle: () => client.request({ type: "settle" }),
    tick: () => client.request({ type: "tick" }),
    reset: () => client.request({ type: "reset" }),
    getSignal: (componentId: number, port: string) => client.request({ type: "get_signal", componentId, port }),
  };
}

/**
 * 一条 Clock 驱动 D Flip-Flop 的电路：Clock 接 `clock` 端口，Input 接 `d`，`q` 接到 Output。
 * 连接目标端口写 `clock`——这是引擎与领域语言的名字，展示定义的 `clk` 已在 Phase 4 统一，
 * 用错名字会在推送结构时被引擎以端口不存在拒绝，因此本文件同时守住这条修正。
 */
const risingEdgeDocument: CircuitDocument = {
  components: [
    { id: "clock", kind: "clock" },
    { id: "data", kind: "input" },
    { id: "flop", kind: "d_flip_flop" },
    { id: "probe", kind: "output" },
  ],
  connections: [
    { id: "wire-clock", source: { componentId: "clock", port: "out" }, target: { componentId: "flop", port: "clock" } },
    { id: "wire-data", source: { componentId: "data", port: "out" }, target: { componentId: "flop", port: "d" } },
    { id: "wire-q", source: { componentId: "flop", port: "q" }, target: { componentId: "probe", port: "in" } },
  ],
};

function signalOf(snapshot: WorkspaceSnapshot, key: string): Signal {
  const value = snapshot.signals[key];
  assert.notEqual(value, undefined, `快照里没有 ${key} 的读数`);
  return value;
}

test("runs, pauses, resumes, and resets a clock-driven flip-flop on the real engine", { skip: engineAvailable() }, async (t) => {
  const { EngineClient } = require_("../electron/engine-client.cjs") as {
    EngineClient: new (enginePath: string) => ProtocolEngineClient;
  };
  const client = new EngineClient(enginePath);
  t.after(() => client.close());

  const scheduler = new FakeScheduler();
  const workspace = createWorkspace(createEngineAdapter(client), { scheduler });

  // ── 推送结构：真实引擎必须接受 `clock` 端口名 ────────────────────────────────
  await workspace.checkEngine();
  const loaded = await workspace.loadCircuit(risingEdgeDocument);
  const bindings: SimulationBindings | null = loaded.bindings;
  assert.notEqual(bindings, null, "文档推送失败，引擎拒绝了这份结构");
  assert.deepEqual(
    Object.keys(bindings?.components ?? {}).sort(),
    ["clock", "data", "flop", "probe"],
  );
  assert.equal(Object.keys(bindings?.connections ?? {}).length, 3);
  assert.equal(bindings?.componentKinds?.flop, "d_flip_flop");

  // 推送后的首次稳定求值不是一次推进：Clock 的输出初值是 0，还没有出现过上升沿，
  // 步数因此停在 0——重置之后的重新求值走同一条规则，同一个状态不会两处显示不同的步数。
  assert.equal(loaded.snapshot.hasCircuit, true);
  assert.equal(loaded.snapshot.simulationStep, 0);
  assert.deepEqual(loaded.snapshot.waveform, []);
  assert.equal(loaded.snapshot.simulationState, "stopped");
  assert.equal(signalOf(loaded.snapshot, "clock:out"), 0);
  assert.equal(signalOf(loaded.snapshot, "data:out"), 1);
  assert.equal(signalOf(loaded.snapshot, "flop:q"), "X", "第一次上升沿之前 q 必须是 X，而不是 0");
  assert.equal(signalOf(loaded.snapshot, "probe:in"), "X");

  // ── 连续运行若干步 ──────────────────────────────────────────────────────────
  const running = await workspace.start();
  assert.equal(running.simulationState, "running");
  assert.equal(running.canPause, true);

  /**
   * 触发一拍连续运行并返回这一拍之后的快照。
   * 等到步数真的加一才返回：这一拍要走一次真实的进程间往返，机器忙时不止一个宏任务。
   */
  const advance = async (): Promise<WorkspaceSnapshot> => {
    const before = workspace.snapshot().simulationStep;
    assert.equal(scheduler.fire(), true, "连续运行必须已经排定了下一拍");
    for (let attempt = 0; attempt < 400 && workspace.snapshot().simulationStep === before; attempt += 1) {
      await drain();
    }
    assert.equal(workspace.snapshot().simulationStep, before + 1, "这一拍没有推进");
    return workspace.snapshot();
  };

  // 第 1 拍：clock 0 → 1，是上升沿，把 d = 1 采进 q。
  const afterFirst = await advance();
  assert.equal(signalOf(afterFirst, "clock:out"), 1);
  assert.equal(signalOf(afterFirst, "flop:q"), 1);
  assert.equal(signalOf(afterFirst, "probe:in"), 1, "q 的变化必须沿 Connection 传到 Output");

  // 第 2 拍：clock 1 → 0，是下降沿，q 保持不变。
  const afterSecond = await advance();
  assert.equal(signalOf(afterSecond, "clock:out"), 0);
  assert.equal(signalOf(afterSecond, "flop:q"), 1, "下降沿不采样");

  // 第 3 拍：又是上升沿，d 仍是 1，q 保持 1。
  const afterThird = await advance();
  assert.equal(signalOf(afterThird, "clock:out"), 1);
  assert.equal(signalOf(afterThird, "flop:q"), 1);

  // 运行中切换 Input：只提交 set_input，由下一次推进带上新值。
  const toggled = await workspace.toggleInput("data");
  assert.equal(toggled.inputValues.data, 0);
  assert.equal(toggled.simulationState, "running", "运行中切换输入不该打断连续运行");

  // 第 4 拍：下降沿，d 已经变成 0，但 q 必须按住不动——这正是上升沿触发的可证伪点。
  const afterFalling = await advance();
  assert.equal(signalOf(afterFalling, "data:out"), 0);
  assert.equal(signalOf(afterFalling, "clock:out"), 0);
  assert.equal(signalOf(afterFalling, "flop:q"), 1, "d 已经变了，但还没有上升沿，q 不能跟着变");

  // 第 5 拍：上升沿，这一次采到 d = 0。
  const afterRising = await advance();
  assert.equal(signalOf(afterRising, "clock:out"), 1);
  assert.equal(signalOf(afterRising, "flop:q"), 0);

  const stepsBeforePause = afterRising.simulationStep;
  // 推送后的首次稳定求值不计步，连续运行从第 0 步往上走了 5 拍。
  assert.equal(stepsBeforePause, loaded.snapshot.simulationStep + 5);
  assert.equal(stepsBeforePause, 5);

  // ── 暂停：不推进，也不重排下一拍 ────────────────────────────────────────────
  const paused = await workspace.pause();
  assert.equal(paused.simulationState, "paused");
  assert.equal(paused.simulationStep, stepsBeforePause);
  assert.equal(scheduler.fire(), false, "暂停必须取消已经排定的下一拍");
  assert.equal(scheduler.pendingCount(), 0);

  const stillPaused = workspace.snapshot();
  assert.equal(stillPaused.simulationStep, stepsBeforePause);
  assert.equal(signalOf(stillPaused, "flop:q"), 0, "暂停期间 q 不变");

  // ── 继续：从暂停处的状态接着跑，不重放也不丢步 ──────────────────────────────
  const resumed = await workspace.resume();
  assert.equal(resumed.simulationState, "running");
  assert.equal(resumed.simulationStep, stepsBeforePause, "继续不该把步数打回起点");

  // 第 6 拍：clock 1 → 0，下降沿，q 仍然是暂停时的 0。
  const afterResume = await advance();
  assert.equal(afterResume.simulationStep, stepsBeforePause + 1);
  assert.equal(signalOf(afterResume, "clock:out"), 0);
  assert.equal(signalOf(afterResume, "flop:q"), 0);

  // ── 重置：运行状态回到已停止，运行时状态整份清空，Circuit 结构不动 ──────────
  const resetSnapshot = await workspace.reset();
  assert.equal(resetSnapshot.simulationState, "stopped");
  assert.equal(resetSnapshot.simulationStep, 0);
  assert.deepEqual(resetSnapshot.waveform, []);
  assert.equal(signalOf(resetSnapshot, "clock:out"), 0, "Clock 回到 0");
  assert.equal(signalOf(resetSnapshot, "flop:q"), "X", "重置后 q 回到 X");
  assert.equal(signalOf(resetSnapshot, "probe:in"), "X");
  assert.equal(resetSnapshot.hasCircuit, true, "重置只清运行时状态，不改变 Circuit 结构");
  assert.deepEqual(
    Object.keys(resetSnapshot.signals).sort(),
    ["clock:out", "data:out", "flop:q", "probe:in"],
    "结构与读数键原样保留，只有值回到初始状态",
  );

  // 重置之后的第一拍仍然是完整的上升沿：前值快照一并清空，不会凭空造出上升沿。
  const afterResetTick = await workspace.step();
  assert.equal(afterResetTick.simulationStep, 1);
  assert.equal(signalOf(afterResetTick, "clock:out"), 1);
  assert.equal(signalOf(afterResetTick, "flop:q"), 0, "重置后重新从 0 起跑，上升沿采到当前的 d = 0");
});

function engineAvailable(): boolean | string {
  return existsSync(enginePath) ? false : `未找到 ${enginePath}，先执行 pnpm build:engine 再跑本条端到端回归`;
}
