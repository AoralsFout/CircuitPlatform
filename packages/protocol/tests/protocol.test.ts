import assert from "node:assert/strict";
import test from "node:test";
import { createHealthCheck, isSignal } from "../src/index.ts";

test("creates a health check request", () => {
  assert.deepEqual(createHealthCheck("request-1"), {
    type: "health_check",
    requestId: "request-1",
  });
});

test("recognizes the initial digital signal values", () => {
  assert.equal(isSignal(0), true);
  assert.equal(isSignal(1), true);
  assert.equal(isSignal("X"), true);
  assert.equal(isSignal(2), false);
});
