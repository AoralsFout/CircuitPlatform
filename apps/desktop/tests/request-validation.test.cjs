const assert = require("node:assert/strict");
const test = require("node:test");
const { requirePositiveId, requireNonEmptyString, requireOptionalNonEmptyString, requireSaveDialogOptions } = require("../electron/request-validation.cjs");

test("accepts positive safe protocol identifiers", () => {
  assert.equal(requirePositiveId(1, "componentId"), 1);
  assert.equal(requirePositiveId(Number.MAX_SAFE_INTEGER, "connectionId"), Number.MAX_SAFE_INTEGER);
});

test("rejects malformed protocol identifiers at the IPC seam", () => {
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
    assert.throws(() => requirePositiveId(value, "componentId"), /componentId 必须是正安全整数/);
  }
});

test("accepts non-empty string parameters for the project file channels", () => {
  assert.equal(requireNonEmptyString("C:\\demo.circuit.json", "filePath"), "C:\\demo.circuit.json");
  assert.equal(requireNonEmptyString('{"version":1}', "content"), '{"version":1}');
});

test("rejects empty or non-string project file parameters at the IPC seam", () => {
  for (const value of ["", 42, null, undefined, { path: "x" }]) {
    assert.throws(() => requireNonEmptyString(value, "filePath"), /filePath 必须是非空字符串/);
  }
});

test("optional string parameters accept omission but still reject malformed values", () => {
  assert.equal(requireOptionalNonEmptyString(undefined, "options.defaultPath"), undefined);
  assert.equal(requireOptionalNonEmptyString("C:\\demo", "options.defaultPath"), "C:\\demo");
  assert.throws(() => requireOptionalNonEmptyString("", "options.defaultPath"), /defaultPath 必须是非空字符串/);
  assert.throws(() => requireOptionalNonEmptyString(3, "options.defaultPath"), /defaultPath 必须是非空字符串/);
});

test("save dialog options keep only a valid defaultPath", () => {
  assert.deepEqual(requireSaveDialogOptions(undefined), {});
  assert.deepEqual(requireSaveDialogOptions(null), {});
  assert.deepEqual(requireSaveDialogOptions({}), {});
  assert.deepEqual(requireSaveDialogOptions({ defaultPath: "C:\\demo.circuit.json" }), { defaultPath: "C:\\demo.circuit.json" });
  // 多余字段丢弃而不是拒绝：主进程只取它认识的选项语义。
  assert.deepEqual(requireSaveDialogOptions({ defaultPath: "a", extra: 1 }), { defaultPath: "a" });
});

test("rejects malformed save dialog options at the IPC seam", () => {
  assert.throws(() => requireSaveDialogOptions("C:\\demo"), /options 必须是对象/);
  assert.throws(() => requireSaveDialogOptions(["a"]), /options 必须是对象/);
  assert.throws(() => requireSaveDialogOptions({ defaultPath: "" }), /defaultPath 必须是非空字符串/);
  assert.throws(() => requireSaveDialogOptions({ defaultPath: 5 }), /defaultPath 必须是非空字符串/);
});
