import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { ComponentKindName, EngineResponse, PortSpec, Signal } from "@circuit-platform/protocol";
import { defaultPortsFor } from "../src/editor/bus-ports.ts";
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
    addComponent: (kind: ComponentKindName, ports?: readonly PortSpec[]) =>
      client.request({ type: "add_component", kind, ports }),
    setPortWidth: (componentId: number, ports: readonly PortSpec[]) =>
      client.request({ type: "set_port_width", componentId, ports }),
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

/** 协议往返的收窄：收到 `error` 时把引擎给出的原因带进断言消息，而不是只报「类型不对」。 */
function expectResponseOf<T extends EngineResponse["type"]>(
  response: EngineResponse,
  type: T,
): Extract<EngineResponse, { type: T }> {
  assert.equal(
    response.type,
    type,
    `期望 ${type}，实际是 ${response.type}${response.type === "error" ? `（${response.code}：${response.message}）` : ""}`,
  );
  return response as Extract<EngineResponse, { type: T }>;
}

/** 一次 `get_signal` 往返的读数。 */
function signalValueOf(response: EngineResponse): Signal {
  return expectResponseOf(response, "signal_result").value;
}

/**
 * 一条 8 位数据通路：Input(8) → 拆线器 → 八个逐位 NOT 门 → 合线器 → Output(8)。
 *
 * 拆线器与合线器的端口清单直接取生产代码的默认配置（`defaultPortsFor`），不另抄一份：默认的
 * 8 位宿主总线拆成八条 1 位分支、分支从最高位开始编号，这些形状本身就是被测对象的一部分。
 * 逐位门用 NOT 而不是二输入门，是为了让「某一位为 X」的断言只有一个来源：这一位的值。
 */
const busWidth = 8;
const splitterPorts = defaultPortsFor("splitter") ?? [];
const mergerPorts = defaultPortsFor("merger") ?? [];

const busDocument: CircuitDocument = {
  components: [
    { id: "bus-in", kind: "input", ports: [{ name: "out", direction: "output", width: busWidth }] },
    { id: "split", kind: "splitter", ports: splitterPorts },
    ...Array.from({ length: busWidth }, (_, index) => ({ id: `inv${index}`, kind: "not" as const })),
    { id: "merge", kind: "merger", ports: mergerPorts },
    { id: "bus-out", kind: "output", ports: [{ name: "in", direction: "input", width: busWidth }] },
  ],
  connections: [
    { id: "wire-bus-in", source: { componentId: "bus-in", port: "out" }, target: { componentId: "split", port: "in" } },
    ...Array.from({ length: busWidth }, (_, index) => ({
      id: `wire-split-${index}`,
      source: { componentId: "split", port: `out${index}` },
      target: { componentId: `inv${index}`, port: "in" },
    })),
    ...Array.from({ length: busWidth }, (_, index) => ({
      id: `wire-merge-${index}`,
      source: { componentId: `inv${index}`, port: "out" },
      target: { componentId: "merge", port: `in${index}` },
    })),
    { id: "wire-bus-out", source: { componentId: "merge", port: "out" }, target: { componentId: "bus-out", port: "in" } },
  ],
};

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
  assert.equal(signalOf(loaded.snapshot, "clock:out"), "0");
  assert.equal(signalOf(loaded.snapshot, "data:out"), "1");
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
  assert.equal(signalOf(afterFirst, "clock:out"), "1");
  assert.equal(signalOf(afterFirst, "flop:q"), "1");
  assert.equal(signalOf(afterFirst, "probe:in"), "1", "q 的变化必须沿 Connection 传到 Output");

  // 第 2 拍：clock 1 → 0，是下降沿，q 保持不变。
  const afterSecond = await advance();
  assert.equal(signalOf(afterSecond, "clock:out"), "0");
  assert.equal(signalOf(afterSecond, "flop:q"), "1", "下降沿不采样");

  // 第 3 拍：又是上升沿，d 仍是 1，q 保持 1。
  const afterThird = await advance();
  assert.equal(signalOf(afterThird, "clock:out"), "1");
  assert.equal(signalOf(afterThird, "flop:q"), "1");

  // 运行中切换 Input：只提交 set_input，由下一次推进带上新值。
  const toggled = await workspace.setInputBit("data", 0, "0");
  assert.equal(toggled.inputValues.data, "0");
  assert.equal(toggled.simulationState, "running", "运行中切换输入不该打断连续运行");

  // 第 4 拍：下降沿，d 已经变成 0，但 q 必须按住不动——这正是上升沿触发的可证伪点。
  const afterFalling = await advance();
  assert.equal(signalOf(afterFalling, "data:out"), "0");
  assert.equal(signalOf(afterFalling, "clock:out"), "0");
  assert.equal(signalOf(afterFalling, "flop:q"), "1", "d 已经变了，但还没有上升沿，q 不能跟着变");

  // 第 5 拍：上升沿，这一次采到 d = 0。
  const afterRising = await advance();
  assert.equal(signalOf(afterRising, "clock:out"), "1");
  assert.equal(signalOf(afterRising, "flop:q"), "0");

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
  assert.equal(signalOf(stillPaused, "flop:q"), "0", "暂停期间 q 不变");

  // ── 继续：从暂停处的状态接着跑，不重放也不丢步 ──────────────────────────────
  const resumed = await workspace.resume();
  assert.equal(resumed.simulationState, "running");
  assert.equal(resumed.simulationStep, stepsBeforePause, "继续不该把步数打回起点");

  // 第 6 拍：clock 1 → 0，下降沿，q 仍然是暂停时的 0。
  const afterResume = await advance();
  assert.equal(afterResume.simulationStep, stepsBeforePause + 1);
  assert.equal(signalOf(afterResume, "clock:out"), "0");
  assert.equal(signalOf(afterResume, "flop:q"), "0");

  // ── 重置：运行状态回到已停止，运行时状态整份清空，Circuit 结构不动 ──────────
  const resetSnapshot = await workspace.reset();
  assert.equal(resetSnapshot.simulationState, "stopped");
  assert.equal(resetSnapshot.simulationStep, 0);
  assert.deepEqual(resetSnapshot.waveform, []);
  assert.equal(signalOf(resetSnapshot, "clock:out"), "0", "Clock 回到 0");
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
  assert.equal(signalOf(afterResetTick, "clock:out"), "1");
  assert.equal(signalOf(afterResetTick, "flop:q"), "0", "重置后重新从 0 起跑，上升沿采到当前的 d = 0");
});

/**
 * 多位数据通路的端到端回归：真实 `circuit-engine` 二进制 + 真实 JSON Lines 协议 + 真实工作区运行循环。
 *
 * 这条通路覆盖 C++ 单测与前端假引擎都够不到的接缝：C++ 侧知道「拆线器按区间取位」，前端假引擎
 * 知道「读数按 `${componentId}:${port}` 装进快照」，但只有把两者接起来才能证明一条 8 位总线真的
 * 走完了「拆开 → 逐位求值 → 合回」。断言因此只落在端口读数上：`X1X0` 与 `XXXX` 的区别必须能从
 * 外部看见，否则逐位化没有被测到。
 */
test("carries an unknown bit through a splitter, per-bit gates, and a merger on the real engine", { skip: engineAvailable() }, async (t) => {
  const { EngineClient } = require_("../electron/engine-client.cjs") as {
    EngineClient: new (enginePath: string) => ProtocolEngineClient;
  };
  const client = new EngineClient(enginePath);
  t.after(() => client.close());

  const scheduler = new FakeScheduler();
  const workspace = createWorkspace(createEngineAdapter(client), { scheduler });

  // ── 推送结构：拆线器与合线器没有内置定义，引擎必须原样接受前端给出的端口清单 ──────────
  await workspace.checkEngine();
  const loaded = await workspace.loadCircuit(busDocument);
  const bindings: SimulationBindings | null = loaded.bindings;
  assert.notEqual(bindings, null, "文档推送失败，引擎拒绝了这份多位结构");
  assert.equal(Object.keys(bindings?.components ?? {}).length, busWidth + 4);
  assert.equal(Object.keys(bindings?.connections ?? {}).length, busWidth * 2 + 2);
  assert.equal(bindings?.componentKinds?.split, "splitter");
  assert.equal(bindings?.componentKinds?.merge, "merger");
  assert.deepEqual(loaded.ports.split, splitterPorts, "引擎回传的端口清单必须与送出的那一份一致");
  assert.deepEqual(loaded.ports.merge, mergerPorts);

  // ── 初始求值：输入全 0，逐位取反之后整条总线是全 1 ──────────────────────────────
  assert.equal(loaded.snapshot.hasCircuit, true);
  assert.equal(loaded.snapshot.simulationStep, 0, "推送后的首次稳定求值不是一次推进");
  // 工作区快照只带输出端口与 Output 的接收端，因此总线在两端的读数由 `bus-in:out` 与
  // `bus-out:in` 给出，中间每一级由它自己的输出端口给出。
  assert.equal(signalOf(loaded.snapshot, "bus-in:out"), "00000000");
  assert.equal(signalOf(loaded.snapshot, "split:out0"), "0");
  assert.equal(signalOf(loaded.snapshot, "split:out7"), "0");
  assert.equal(signalOf(loaded.snapshot, "merge:out"), "11111111");
  assert.equal(signalOf(loaded.snapshot, "bus-out:in"), "11111111");

  // ── 逐位设置：`setInputBit` 的下标从最高位起算，与画布上「MSB 在上」一致 ────────────
  await workspace.setInputBit("bus-in", 0, "1");
  await workspace.setInputBit("bus-in", 7, "1");
  const withUnknown = await workspace.setInputBit("bus-in", 2, "X");

  assert.equal(withUnknown.inputValues["bus-in"], "10X00001");
  assert.equal(signalOf(withUnknown, "bus-in:out"), "10X00001");

  // 只有拿到那一位的分支是 X：其余七条分支照旧是确定值。
  assert.equal(signalOf(withUnknown, "split:out0"), "1");
  assert.equal(signalOf(withUnknown, "split:out2"), "X", "第 5 位未知，落在 out2（[5:5]）上");
  assert.equal(signalOf(withUnknown, "split:out7"), "1");

  // 逐位门这一级：X 只污染它所在的那一位，其余七位照常取反。
  const expectedAfterGates = ["0", "1", "X", "1", "1", "1", "1", "0"];
  for (let index = 0; index < busWidth; index += 1) {
    assert.equal(
      signalOf(withUnknown, `inv${index}:out`),
      expectedAfterGates[index],
      `第 ${index} 位经过逐位门之后的读数`,
    );
  }

  // 合线器把八位合回总线：结果既不是全 X，也不是被截断或被零扩展的值。
  assert.equal(signalOf(withUnknown, "merge:out"), "01X11110");
  assert.equal(signalOf(withUnknown, "bus-out:in"), "01X11110");
  assert.notEqual(signalOf(withUnknown, "bus-out:in"), "XXXXXXXX", "一位未知不该让整条总线未知");

  // 波形记录的是这一拍多位读数的完整逐位文本，而不是一个按信号名写死的字段。
  const recorded = withUnknown.waveform.at(-1);
  assert.notEqual(recorded, undefined);
  assert.equal(recorded?.signals["bus-out:in"], "01X11110");

  // ── 推进一拍：运行循环带回的多位读数必须与稳定求值一致 ─────────────────────────
  const stepped = await workspace.step();
  assert.equal(stepped.simulationStep, withUnknown.simulationStep + 1);
  assert.equal(signalOf(stepped, "bus-out:in"), "01X11110", "组合电路推进一拍之后读数不变");
  assert.equal(signalOf(stepped, "bus-in:out"), "10X00001");
});

/**
 * 改位宽之后不匹配的 Connection 悬空并可重接。
 *
 * 这条只跑真实引擎与真实 JSON Lines 协议，不经过工作区：`set_port_width` 的入口在编辑器会话里，
 * 工作区的公开接口没有改位宽这一项。断言落在只有引擎能回答的三件事上——改宽回报了哪些
 * Connection 转为悬空、悬空连接真的不参与求值（接收端读全 X 而不是被截断的低位）、以及位宽重新
 * 匹配之后**同一个 Connection 身份**原样复活。
 */
test("drops a mismatched connection when a bus width changes and brings it back when the widths match", { skip: engineAvailable() }, async (t) => {
  const { EngineClient } = require_("../electron/engine-client.cjs") as {
    EngineClient: new (enginePath: string) => ProtocolEngineClient;
  };
  const client = new EngineClient(enginePath);
  t.after(() => client.close());

  const busPorts: PortSpec[] = [{ name: "out", direction: "output", width: busWidth }];
  const narrowedPorts: PortSpec[] = [{ name: "out", direction: "output", width: 4 }];

  // 把 8 位总线接进拆线器：两端位宽相同，连接成立。
  const inputId = expectResponseOf(
    await client.request({ type: "add_component", kind: "input", ports: busPorts }),
    "component_added",
  ).componentId;
  const splitterId = expectResponseOf(
    await client.request({ type: "add_component", kind: "splitter", ports: splitterPorts }),
    "component_added",
  ).componentId;
  const busWire = expectResponseOf(
    await client.request({
      type: "add_connection",
      sourceComponentId: inputId,
      sourcePort: "out",
      targetComponentId: splitterId,
      targetPort: "in",
    }),
    "connection_added",
  );

  await client.request({ type: "set_input", componentId: inputId, value: "10110010" });
  await client.request({ type: "settle" });
  assert.equal(
    signalValueOf(await client.request({ type: "get_signal", componentId: splitterId, port: "in" })),
    "10110010",
  );

  // ── 改宽：8 位 → 4 位。两端不再匹配，这条 Connection 转为悬空 ─────────────────────
  const narrowed = expectResponseOf(
    await client.request({ type: "set_port_width", componentId: inputId, ports: narrowedPorts }),
    "port_width_set",
  );
  assert.deepEqual(
    narrowed.danglingConnectionIds,
    [busWire.connectionId],
    "改宽必须回报本次转为悬空的 Connection 身份，调用方不必自己重算匹配规则",
  );

  // 长度校验读的是端口**当前**声明的位宽，不是一个全局常量。
  const tooLong = await client.request({ type: "set_input", componentId: inputId, value: "10110010" });
  assert.equal(tooLong.type, "error");
  assert.equal(tooLong.type === "error" ? tooLong.code : null, "invalid_width");

  await client.request({ type: "settle" });
  // 悬空连接不参与仿真：接收端读到的是全 X，而不是被悄悄截断的低四位。
  assert.equal(
    signalValueOf(await client.request({ type: "get_signal", componentId: splitterId, port: "in" })),
    "XXXXXXXX",
  );

  // 位宽不同连不起来，拒绝原因是 width_mismatch——不做零扩展也不做截断。
  const secondSplitterId = expectResponseOf(
    await client.request({ type: "add_component", kind: "splitter", ports: splitterPorts }),
    "component_added",
  ).componentId;
  const rejected = await client.request({
    type: "add_connection",
    sourceComponentId: inputId,
    sourcePort: "out",
    targetComponentId: secondSplitterId,
    targetPort: "in",
  });
  assert.equal(rejected.type, "error");
  assert.equal(rejected.type === "error" ? rejected.code : null, "width_mismatch");

  // ── 重接：位宽改回 8 位，同一条 Connection 身份原样复活 ──────────────────────────
  const restored = expectResponseOf(
    await client.request({ type: "set_port_width", componentId: inputId, ports: busPorts }),
    "port_width_set",
  );
  assert.deepEqual(
    restored.danglingConnectionIds,
    [],
    "重新匹配、恢复有效的连接不在差分里，因此不需要删掉重拉",
  );

  await client.request({ type: "set_input", componentId: inputId, value: "10110010" });
  await client.request({ type: "settle" });
  assert.equal(
    signalValueOf(await client.request({ type: "get_signal", componentId: splitterId, port: "in" })),
    "10110010",
    "改宽回原样之后原来的 Connection 又参与仿真了",
  );
  assert.equal(
    signalValueOf(await client.request({ type: "get_signal", componentId: splitterId, port: "out0" })),
    "1",
    "悬空期间不参与求值的连接恢复之后，逐位分支也照常拿到最高位",
  );
});

function engineAvailable(): boolean | string {
  return existsSync(enginePath) ? false : `未找到 ${enginePath}，先执行 pnpm build:engine 再跑本条端到端回归`;
}
