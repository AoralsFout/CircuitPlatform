import assert from "node:assert/strict";
import test from "node:test";
import {
  createHealthCheck,
  createRemoveComponent,
  createRemoveConnection,
  createTick,
  isComponentRemovedResponse,
  isConnectionRemovedResponse,
  isRemoveComponentRequest,
  isRemoveConnectionRequest,
  isSignal,
  isTickedResponse,
} from "../src/index.ts";

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

test("serializes component and connection removal requests", () => {
  assert.equal(
    JSON.stringify(createRemoveComponent("request-2", 7)),
    '{"type":"remove_component","requestId":"request-2","componentId":7}',
  );
  assert.equal(
    JSON.stringify(createRemoveConnection("request-3", 11)),
    '{"type":"remove_connection","requestId":"request-3","connectionId":11}',
  );
});

test("recognizes removal requests and successful responses", () => {
  assert.equal(
    isRemoveComponentRequest({ type: "remove_component", requestId: "request-4", componentId: 7 }),
    true,
  );
  assert.equal(
    isRemoveConnectionRequest({ type: "remove_connection", requestId: "request-5", connectionId: 11 }),
    true,
  );
  assert.equal(
    isComponentRemovedResponse({ type: "component_removed", requestId: "request-6", componentId: 7 }),
    true,
  );
  assert.equal(
    isConnectionRemovedResponse({ type: "connection_removed", requestId: "request-7", connectionId: 11 }),
    true,
  );
});

test("creates a tick request without any payload", () => {
  assert.equal(JSON.stringify(createTick("request-12")), '{"type":"tick","requestId":"request-12"}');
});

test("recognizes a ticked response carrying the step and every output port", () => {
  assert.equal(
    isTickedResponse({
      type: "ticked",
      requestId: "request-13",
      step: 7,
      signals: [
        { componentId: 3, port: "out", value: 1 },
        { componentId: 5, port: "q", value: "X" },
      ],
    }),
    true,
  );
  // 空电路也必须合法：没有输出端口时 signals 是空数组。
  assert.equal(
    isTickedResponse({ type: "ticked", requestId: "request-14", step: 0, signals: [] }),
    true,
  );
});

test("rejects malformed ticked responses", () => {
  assert.equal(isTickedResponse({ type: "ticked", requestId: "request-15", step: 1 }), false);
  assert.equal(
    isTickedResponse({ type: "ticked", requestId: "request-16", step: -1, signals: [] }),
    false,
  );
  assert.equal(
    isTickedResponse({ type: "ticked", requestId: "request-17", step: 1.5, signals: [] }),
    false,
  );
  assert.equal(
    isTickedResponse({
      type: "ticked",
      requestId: "request-18",
      step: 1,
      signals: [{ componentId: 0, port: "out", value: 1 }],
    }),
    false,
  );
  assert.equal(
    isTickedResponse({
      type: "ticked",
      requestId: "request-19",
      step: 1,
      signals: [{ componentId: 3, port: "out", value: 2 }],
    }),
    false,
  );
  assert.equal(
    isTickedResponse({
      type: "ticked",
      requestId: "request-20",
      step: 1,
      signals: [{ componentId: 3, value: 1 }],
    }),
    false,
  );
  assert.equal(isTickedResponse({ type: "settled", requestId: "request-21", status: "ok" }), false);
});

test("rejects malformed removal messages", () => {
  assert.equal(isRemoveComponentRequest({ type: "remove_component", requestId: "request-8" }), false);
  assert.equal(
    isRemoveComponentRequest({ type: "remove_component", requestId: "request-8b", componentId: 0 }),
    false,
  );
  assert.equal(
    isRemoveConnectionRequest({ type: "remove_connection", requestId: "request-9", connectionId: -1 }),
    false,
  );
  assert.equal(
    isComponentRemovedResponse({ type: "component_removed", requestId: "request-10", componentId: "7" }),
    false,
  );
  assert.equal(
    isConnectionRemovedResponse({ type: "connection_added", requestId: "request-11", connectionId: 11 }),
    false,
  );
});
