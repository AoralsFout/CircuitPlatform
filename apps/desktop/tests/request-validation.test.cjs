const assert = require("node:assert/strict");
const test = require("node:test");
const { requirePositiveId } = require("../electron/request-validation.cjs");

test("accepts positive safe protocol identifiers", () => {
  assert.equal(requirePositiveId(1, "componentId"), 1);
  assert.equal(requirePositiveId(Number.MAX_SAFE_INTEGER, "connectionId"), Number.MAX_SAFE_INTEGER);
});

test("rejects malformed protocol identifiers at the IPC seam", () => {
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
    assert.throws(() => requirePositiveId(value, "componentId"), /componentId 必须是正安全整数/);
  }
});
