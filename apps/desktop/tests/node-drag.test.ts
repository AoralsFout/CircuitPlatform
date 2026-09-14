import assert from "node:assert/strict";
import test from "node:test";
import { createNodeDragController, snapNodePosition } from "../src/canvas/drag.ts";

test("snaps node positions to the 16-world-unit grid unless Alt is held", () => {
  assert.deepEqual(snapNodePosition({ x: 23, y: 40 }), { x: 16, y: 48 });
  assert.deepEqual(snapNodePosition({ x: 23, y: 40 }, true), { x: 23, y: 40 });
});

test("coalesces pointer moves to one RAF preview and commits once on release", () => {
  const callbacks: FrameRequestCallback[] = [];
  const previews: Array<{ nodeId: string; position: { x: number; y: number } }> = [];
  const commits: typeof previews = [];
  const controller = createNodeDragController({
    requestFrame(callback) {
      callbacks.push(callback);
      return callbacks.length;
    },
    cancelFrame() {
      // The test frame queue is intentionally retained; end() flushes the latest value directly.
    },
    onPreview: (preview) => previews.push(preview),
    onCommit: (preview) => commits.push(preview),
  });

  controller.start("and-gate", { x: 32, y: 32 }, { x: 40, y: 40 });
  controller.move({ x: 67, y: 73 });
  controller.move({ x: 91, y: 102 });
  assert.equal(callbacks.length, 1);
  callbacks[0](0);
  assert.deepEqual(previews.at(-1)?.position, { x: 80, y: 96 });
  controller.end();
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0].position, { x: 80, y: 96 });
});

test("cancel and a pointer down/up with no movement do not commit", () => {
  let commits = 0;
  const controller = createNodeDragController({
    onPreview: () => undefined,
    onCommit: () => { commits += 1; },
  });
  controller.start("input-a", { x: 16, y: 16 }, { x: 20, y: 20 });
  controller.end();
  controller.start("input-a", { x: 16, y: 16 }, { x: 20, y: 20 });
  controller.move({ x: 100, y: 100 });
  controller.cancel();
  assert.equal(commits, 0);
});
