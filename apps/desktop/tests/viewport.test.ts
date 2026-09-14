import assert from "node:assert/strict";
import test from "node:test";
import {
  applyWheelViewport,
  createViewportState,
  fitViewportToBounds,
  isViewportPanPointer,
  panViewport,
  resizeViewport,
  screenToWorld,
  setViewportZoomAt,
  worldToScreen,
} from "../src/canvas/index.ts";

test("world and screen coordinates round trip through one transform", () => {
  const viewport = createViewportState({ width: 800, height: 500 }, { x: 118, y: -42, zoom: 1.75 });
  const world = { x: 32.5, y: -18.25 };
  const screen = worldToScreen(world, viewport);
  const roundTrip = screenToWorld(screen, viewport);
  assert.ok(Math.abs(roundTrip.x - world.x) < 1e-10);
  assert.ok(Math.abs(roundTrip.y - world.y) < 1e-10);
});

test("wheel and pointer gestures pan on the expected axis", () => {
  const viewport = createViewportState({ width: 800, height: 500 });
  assert.deepEqual(panViewport(viewport, { x: 12, y: -8 }).visibleRect, viewport.visibleRect);
  assert.equal(applyWheelViewport(viewport, { deltaX: 0, deltaY: 50 }, { x: 400, y: 250 }).y, 50);
  assert.equal(applyWheelViewport(viewport, { deltaX: 0, deltaY: 50, shiftKey: true }, { x: 400, y: 250 }).x, 50);
  assert.equal(isViewportPanPointer(1, false), true);
  assert.equal(isViewportPanPointer(0, true), true);
  assert.equal(isViewportPanPointer(0, false), false);
});

test("zoom keeps the pointer world position fixed and clamps to 25%-400%", () => {
  const viewport = createViewportState({ width: 800, height: 500 }, { x: 120, y: 20, zoom: 1 });
  const pointer = { x: 250, y: 180 };
  const before = screenToWorld(pointer, viewport);
  const zoomed = setViewportZoomAt(viewport, 3, pointer);
  assert.deepEqual(screenToWorld(pointer, zoomed), before);
  assert.equal(setViewportZoomAt(viewport, 0.01, pointer).zoom, 0.25);
  assert.equal(setViewportZoomAt(viewport, 99, pointer).zoom, 4);
});

test("fit-to-window centers complete circuit and resize preserves world center", () => {
  const initial = createViewportState({ width: 800, height: 500 });
  const fitted = fitViewportToBounds(initial, { min: { x: 100, y: 50 }, max: { x: 900, y: 450 } });
  assert.equal(fitted.zoom, 0.84);
  assert.deepEqual(worldToScreen({ x: 500, y: 250 }, fitted), { x: 400, y: 250 });

  const beforeCenter = screenToWorld({ x: 400, y: 250 }, fitted);
  const resized = resizeViewport(fitted, { width: 1000, height: 700 });
  assert.deepEqual(screenToWorld({ x: 500, y: 350 }, resized), beforeCenter);
});

test("ctrl/cmd wheel zooms around the pointer instead of translating", () => {
  const viewport = createViewportState({ width: 800, height: 500 });
  const pointer = { x: 100, y: 120 };
  const before = screenToWorld(pointer, viewport);
  const next = applyWheelViewport(viewport, { deltaX: 0, deltaY: -100, ctrlKey: true }, pointer);
  assert.notEqual(next.zoom, viewport.zoom);
  const after = screenToWorld(pointer, next);
  assert.ok(Math.abs(after.x - before.x) < 1e-10);
  assert.ok(Math.abs(after.y - before.y) < 1e-10);
});
