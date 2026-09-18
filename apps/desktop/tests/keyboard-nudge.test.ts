import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentKindName, PortSpec } from "@circuit-platform/protocol";
import { createNodeDragController } from "../src/canvas/drag.ts";
import { createRouteEditController } from "../src/canvas/route-edit.ts";
import {
  createEditorSession,
  type CircuitEnginePort,
  type EngineResult,
} from "../src/editor/index.ts";
import { portsForAddComponent } from "./fake-ports.ts";

class LocalEngine implements CircuitEnginePort {
  async addComponent(kind: ComponentKindName, ports?: readonly PortSpec[]): Promise<EngineResult<{ componentId: number; ports: readonly PortSpec[] }>> {
    // 与真实引擎同一条回退规则：省略端口清单时用内置定义，并把实际清单回传。
    return { ok: true, value: { componentId: 10, ports: portsForAddComponent(kind, ports) } };
  }
  async setPortWidth(_componentId: number, ports: readonly PortSpec[]): Promise<EngineResult<{ ports: readonly PortSpec[]; danglingConnectionIds: readonly number[] }>> {
    return { ok: true, value: { ports, danglingConnectionIds: [] } };
  }
  async addConnection(): Promise<EngineResult<{ connectionId: number }>> { return { ok: true, value: { connectionId: 1 } }; }
  async removeComponent(componentId: number): Promise<EngineResult<{ componentId: number }>> { return { ok: true, value: { componentId } }; }
  async removeConnection(connectionId: number): Promise<EngineResult<{ connectionId: number }>> { return { ok: true, value: { connectionId } }; }
}

function createSession() {
  return createEditorSession({
    document: {
      components: [
        { id: "source", kind: "input", displayName: "输入 1", position: { x: 96, y: 96 }, lifecycle: "active" },
      ],
      connections: [],
    },
    bindings: { components: { source: 1 }, connections: {} },
  }, new LocalEngine());
}

/** 手动驱动的帧队列；键盘微调是异步合并的，测试需要自己决定何时刷新。 */
function createFrameQueue() {
  const pending = new Map<number, FrameRequestCallback>();
  let next = 1;
  return {
    requestFrame: (callback: FrameRequestCallback): number => {
      const handle = next++;
      pending.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle: number): void => { pending.delete(handle); },
    flush: (): void => {
      for (const [handle, callback] of [...pending]) {
        pending.delete(handle);
        callback(0);
      }
    },
  };
}

test("a keyboard nudge gesture commits exactly one history command", async () => {
  const session = createSession();
  const frames = createFrameQueue();
  const commits: { nodeId: string; position: { x: number; y: number } }[] = [];
  const previews: { nodeId: string; position: { x: number; y: number } }[] = [];
  const controller = createNodeDragController({
    onPreview: (preview) => { previews.push({ nodeId: preview.nodeId, position: { ...preview.position } }); },
    onCommit: (preview) => { commits.push({ nodeId: preview.nodeId, position: { ...preview.position } }); },
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
  });

  // 模拟按住 Alt+方向键：起点取元件自身位置，之后每次按键累加一格。
  const origin = { x: 96, y: 96 };
  controller.start("source", origin, origin);
  controller.move({ x: 112, y: 96 });
  frames.flush();
  controller.move({ x: 128, y: 96 });
  controller.move({ x: 128, y: 112 });
  controller.end();

  assert.equal(commits.length, 1, "一次手势只应提交一次");
  assert.deepEqual(commits[0], { nodeId: "source", position: { x: 128, y: 112 } });
  assert.ok(previews.length >= 1, "手势期间应发布过预览");

  // 提交后只产生一条历史命令：撤销一次即回到起点。
  const moved = await session.dispatch({ type: "move-component", componentId: "source", position: commits[0].position });
  assert.equal(moved.ok, true);
  assert.deepEqual(moved.snapshot.document.components[0].position, { x: 128, y: 112 });
  const undone = await session.dispatch({ type: "undo" });
  assert.deepEqual(undone.snapshot.document.components[0].position, origin);
  assert.equal(undone.snapshot.canUndo, false);
});

test("a nudge gesture that returns to its origin cancels instead of leaking a preview", () => {
  const frames = createFrameQueue();
  const commits: unknown[] = [];
  const cancels: number[] = [];
  const controller = createNodeDragController({
    onPreview: () => undefined,
    onCommit: (preview) => { commits.push(preview); },
    onCancel: () => { cancels.push(1); },
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
  });

  const origin = { x: 96, y: 96 };
  controller.start("source", origin, origin);
  controller.move({ x: 112, y: 96 });
  controller.move({ x: 96, y: 96 });
  controller.end();

  // 没有净位移时不得提交，但必须通知调用者回收临时预览。
  assert.equal(commits.length, 0);
  assert.equal(cancels.length, 1);
});

test("a route nudge gesture commits one route command and cancels when unchanged", () => {
  const frames = createFrameQueue();
  const route = [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 64 }, { x: 80, y: 64 }, { x: 80, y: 0 }];
  const commits: unknown[] = [];
  const cancels: number[] = [];
  const controller = createRouteEditController({
    onPreview: () => undefined,
    onCommit: (preview) => { commits.push(preview); },
    onCancel: () => { cancels.push(1); },
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
  });

  const origin = { ...route[2] };
  controller.start("wire", route, { kind: "waypoint", index: 2 }, origin);
  controller.move({ x: origin.x + 16, y: origin.y });
  frames.flush();
  controller.move({ x: origin.x + 32, y: origin.y });
  controller.end();

  assert.equal(commits.length, 1, "一次 Route 微调只应提交一次");
  assert.equal(cancels.length, 0);

  // 折点被拖回原位时路由没有变化，应走取消而不是提交。
  controller.start("wire", route, { kind: "waypoint", index: 2 }, origin);
  controller.move({ x: origin.x + 16, y: origin.y });
  controller.move(origin);
  controller.end();

  assert.equal(commits.length, 1, "没有变化时不得新增提交");
  assert.equal(cancels.length, 1);
});
