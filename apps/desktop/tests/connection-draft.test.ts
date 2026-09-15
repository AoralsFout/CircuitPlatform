import assert from "node:assert/strict";
import test from "node:test";
import {
  connectionDraftRoute,
  createConnectionDraft,
  isConnectionDraftTarget,
  normalizeConnectionEndpoints,
  reduceConnectionDraft,
  resolveConnectionPortPointerAction,
  validateConnectionDraftTarget,
  type ConnectionDraftPort,
} from "../src/editor/connection-draft.ts";

const output: ConnectionDraftPort = {
  componentId: "source",
  port: "out",
  direction: "output",
  point: { x: 0, y: 32 },
  outward: "right",
};
const input: ConnectionDraftPort = {
  componentId: "target",
  port: "in",
  direction: "input",
  point: { x: 160, y: 64 },
  outward: "left",
};

test("click and drag use one draft state machine and retain the first blank-release waypoint", () => {
  let state = createConnectionDraft();
  state = reduceConnectionDraft(state, { type: "start", port: output });
  state = reduceConnectionDraft(state, { type: "move", point: { x: 43, y: 71 } });
  state = reduceConnectionDraft(state, { type: "place-waypoint", point: { x: 43, y: 71 } });
  assert.equal(state.phase, "drawing");
  assert.equal(state.hasPlacedFirstWaypoint, true);
  assert.deepEqual(state.waypoints, [{ x: 48, y: 64 }]);
  const route = connectionDraftRoute(state, input);
  assert.deepEqual(route[0], output.point);
  assert.deepEqual(route.at(-1), input.point);
  assert.ok(route.every((point, index) => index === 0 || point.x === route[index - 1].x || point.y === route[index - 1].y));
});

test("clicking a Port finishes an existing draft instead of replacing its origin", () => {
  assert.equal(resolveConnectionPortPointerAction(false), "start");
  assert.equal(resolveConnectionPortPointerAction(true), "finish");
});

test("target hover accepts compatible Ports and rejects the origin or same-direction Ports", () => {
  assert.equal(isConnectionDraftTarget(output, input), true);
  assert.equal(isConnectionDraftTarget(output, output), false);
  assert.equal(isConnectionDraftTarget(output, { ...output, componentId: "other" }), false);
  assert.equal(isConnectionDraftTarget(output, { ...output, componentId: "other" }, true), true);
});

test("cursor preview ends at the temporary point without a fake target terminal segment", () => {
  let state = reduceConnectionDraft(createConnectionDraft(), { type: "start", port: output });
  state = reduceConnectionDraft(state, { type: "move", point: { x: 43, y: 71 } });

  assert.deepEqual(connectionDraftRoute(state), [
    { x: 0, y: 32 },
    { x: 48, y: 32 },
    { x: 48, y: 64 },
  ]);
});

test("Space toggles axis while origin and route remain stable", () => {
  let state = reduceConnectionDraft(createConnectionDraft(), { type: "start", port: input });
  const before = connectionDraftRoute(state, output);
  state = reduceConnectionDraft(state, { type: "toggle-axis" });
  assert.equal(state.axis, "vertical");
  const after = connectionDraftRoute(state, output);
  assert.deepEqual(after[0], before[0]);
  assert.deepEqual(after.at(-1), before.at(-1));
});

test("Backspace removes only the latest temporary waypoint", () => {
  let state = reduceConnectionDraft(createConnectionDraft(), { type: "start", port: output });
  state = reduceConnectionDraft(state, { type: "place-waypoint", point: { x: 43, y: 71 } });
  state = reduceConnectionDraft(state, { type: "place-waypoint", point: { x: 91, y: 119 } });
  assert.deepEqual(state.waypoints, [{ x: 48, y: 64 }, { x: 96, y: 112 }]);
  state = reduceConnectionDraft(state, { type: "remove-waypoint" });
  assert.deepEqual(state.waypoints, [{ x: 48, y: 64 }]);
  assert.equal(state.hasPlacedFirstWaypoint, true);
  state = reduceConnectionDraft(state, { type: "remove-waypoint" });
  assert.deepEqual(state.waypoints, []);
  assert.equal(state.hasPlacedFirstWaypoint, false);
});

test("connection target validation gives actionable reasons and endpoint normalization is bidirectional", () => {
  assert.equal(validateConnectionDraftTarget(output, input), null);
  assert.equal(validateConnectionDraftTarget(output, { ...output, componentId: "other" })?.code, "same-direction");
  assert.equal(validateConnectionDraftTarget(output, input, true)?.code, "input-occupied");
  assert.equal(normalizeConnectionEndpoints(input, output).source.direction, "output");
  assert.equal(normalizeConnectionEndpoints(input, output).target.direction, "input");
});
