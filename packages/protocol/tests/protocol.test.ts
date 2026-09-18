import assert from "node:assert/strict";
import test from "node:test";
import {
  createHealthCheck,
  createRemoveComponent,
  createRemoveConnection,
  createReset,
  createTick,
  isComponentRemovedResponse,
  isConnectionRemovedResponse,
  isRemoveComponentRequest,
  isRemoveConnectionRequest,
  isResetDoneResponse,
  isSignal,
  isTickedResponse,
} from "../src/index.ts";

test("creates a health check request", () => {
  assert.deepEqual(createHealthCheck("request-1"), {
    type: "health_check",
    requestId: "request-1",
  });
});

test("recognizes a signal value as a non-empty run of 0, 1 and X", () => {
  assert.equal(isSignal("0"), true);
  assert.equal(isSignal("1"), true);
  assert.equal(isSignal("X"), true);
  // 多位值同样是合法信号值：长度由端口位宽决定，协议层判不了，因此不在这里限制。
  assert.equal(isSignal("10X0"), true);
  // 数字形式已经不再是信号值。
  assert.equal(isSignal(0), false);
  assert.equal(isSignal(1), false);
  // 空串、其它字符与小写 x 都不是。
  assert.equal(isSignal(""), false);
  assert.equal(isSignal("2"), false);
  assert.equal(isSignal("x"), false);
  // 只含 0/1/X 的子串不算：整串必须都是这三个字符。
  assert.equal(isSignal("1 0"), false);
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
        { componentId: 3, port: "out", value: "1" },
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
      signals: [{ componentId: 0, port: "out", value: "1" }],
    }),
    false,
  );
  assert.equal(
    isTickedResponse({
      type: "ticked",
      requestId: "request-19",
      step: 1,
      signals: [{ componentId: 3, port: "out", value: "2" }],
    }),
    false,
  );
  assert.equal(
    isTickedResponse({
      type: "ticked",
      requestId: "request-20",
      step: 1,
      signals: [{ componentId: 3, value: "1" }],
    }),
    false,
  );
  assert.equal(isTickedResponse({ type: "settled", requestId: "request-21", status: "ok" }), false);
});

test("creates a reset request without any payload", () => {
  assert.equal(JSON.stringify(createReset("request-22")), '{"type":"reset","requestId":"request-22"}');
});

test("recognizes a reset_done response and rejects other shapes", () => {
  assert.equal(
    isResetDoneResponse({ type: "reset_done", requestId: "request-23", status: "ok" }),
    true,
  );
  // 重置没有业务失败分支，因此只有成功状态才是合法响应。
  assert.equal(
    isResetDoneResponse({ type: "reset_done", requestId: "request-24", status: "failed" }),
    false,
  );
  assert.equal(isResetDoneResponse({ type: "reset_done", requestId: "request-25" }), false);
  assert.equal(isResetDoneResponse({ type: "reset", requestId: "request-26" }), false);
  assert.equal(isResetDoneResponse({ type: "ticked", requestId: "request-27", step: 0, signals: [] }), false);
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
