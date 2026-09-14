import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultOrthogonalRoute,
  deleteRouteWaypoint,
  isOrthogonalRoute,
  moveRouteSegment,
  moveRouteWaypoint,
  normalizeOrthogonalRoute,
  snapRoutePoint,
} from "../src/editor/route.ts";
import { createRouteEditController } from "../src/canvas/route-edit.ts";

test("default routes keep both ports outside by at least 16 world units", () => {
  const route = createDefaultOrthogonalRoute({ x: 0, y: 0 }, { x: 160, y: 96 });
  assert.equal(isOrthogonalRoute(route), true);
  assert.ok(Math.abs(route[1].x - route[0].x) >= 16);
  assert.ok(Math.abs(route.at(-1)!.x - route.at(-2)!.x) >= 16);
});

test("normalization removes only duplicates and same-direction collinear points", () => {
  assert.deepEqual(normalizeOrthogonalRoute([
    { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 16, y: 0 }, { x: 32, y: 0 }, { x: 16, y: 0 },
  ]), [
    { x: 0, y: 0 }, { x: 32, y: 0 }, { x: 16, y: 0 },
  ]);
  assert.deepEqual(normalizeOrthogonalRoute([{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 8, y: 0 }]), [
    { x: 0, y: 0 }, { x: 16, y: 0 }, { x: 8, y: 0 },
  ]);
});

test("waypoint movement preserves Port endpoints and supports Alt precision", () => {
  const route = [{ x: 0, y: 0 }, { x: 64, y: 0 }, { x: 64, y: 64 }, { x: 128, y: 64 }];
  const snapped = moveRouteWaypoint(route, 1, { x: 7, y: 19 });
  assert.deepEqual(snapped[0], route[0]);
  assert.equal(snapped[1].y, 0);
  assert.equal(isOrthogonalRoute(snapped), true);
  assert.deepEqual(snapRoutePoint({ x: 23, y: 25 }, true), { x: 23, y: 25 });
});

test("moving an endpoint segment inserts a two-corner detour", () => {
  const moved = moveRouteSegment([{ x: 0, y: 0 }, { x: 160, y: 0 }], 0, { x: 0, y: 32 });
  assert.equal(moved.length, 4);
  assert.deepEqual(moved[0], { x: 0, y: 0 });
  assert.deepEqual(moved.at(-1), { x: 160, y: 0 });
  assert.equal(isOrthogonalRoute(moved), true);
});

test("deleting a waypoint is one geometry operation and remains orthogonal", () => {
  const route = [{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 32 }, { x: 64, y: 32 }];
  const deleted = deleteRouteWaypoint(route, 1);
  assert.equal(isOrthogonalRoute(deleted), true);
  assert.deepEqual(deleted[0], route[0]);
  assert.deepEqual(deleted.at(-1), route.at(-1));
});

test("route pointer moves are coalesced and committed once", () => {
  const frames: FrameRequestCallback[] = [];
  const commits: unknown[] = [];
  const controller = createRouteEditController({
    requestFrame(callback) { frames.push(callback); return frames.length; },
    cancelFrame() { /* end flushes latest pointer */ },
    onPreview() { /* preview is intentionally transient */ },
    onCommit(preview) { commits.push(preview); },
  });
  const route = [{ x: 0, y: 0 }, { x: 64, y: 0 }, { x: 64, y: 64 }, { x: 128, y: 64 }];
  controller.start("wire", route, { kind: "waypoint", index: 1 }, { x: 64, y: 0 });
  controller.move({ x: 73, y: 18 });
  controller.move({ x: 80, y: 20 });
  assert.equal(frames.length, 1);
  frames[0](0);
  controller.end();
  assert.equal(commits.length, 1);
});

