/**
 * 校验来自渲染进程的协议 ID，避免畸形数字跨过 IPC seam。
 * @param {unknown} value 待校验的 ID。
 * @param {string} fieldName 错误消息中使用的字段名。
 * @returns {number} 可安全发送给引擎的正整数 ID。
 * @throws {TypeError} 当值不是正安全整数时抛出。
 */
function requirePositiveId(value, fieldName) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${fieldName} 必须是正安全整数`);
  }
  return value;
}

/**
 * 校验来自渲染进程的非空字符串参数（项目文件路径、文件内容）。
 * @param {unknown} value 待校验的字符串。
 * @param {string} fieldName 错误消息中使用的字段名。
 * @returns {string} 原样返回已校验的字符串。
 * @throws {TypeError} 当值不是非空字符串时抛出。
 */
function requireNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${fieldName} 必须是非空字符串`);
  }
  return value;
}

/**
 * 校验可选的非空字符串参数；`undefined` 表示省略，同样合法。
 * @param {unknown} value 待校验的字符串。
 * @param {string} fieldName 错误消息中使用的字段名。
 * @returns {string | undefined} 省略时返回 undefined，否则返回已校验的字符串。
 * @throws {TypeError} 当值既不是 undefined 也不是非空字符串时抛出。
 */
function requireOptionalNonEmptyString(value, fieldName) {
  if (value === undefined) return undefined;
  return requireNonEmptyString(value, fieldName);
}

/**
 * 校验保存对话框通道的入参形状：只接受 `{ defaultPath?: string }`。
 * 多余字段被丢弃而不是拒绝——主进程对渲染层传入的选项只取它认识的语义。
 * @param {unknown} options 渲染进程传来的对话框选项。
 * @returns {{ defaultPath?: string }} 可交给 `dialog.showSaveDialog` 的选项。
 * @throws {TypeError} 当 options 不是对象，或 defaultPath 不是省略/非空字符串时抛出。
 */
function requireSaveDialogOptions(options) {
  if (options === undefined || options === null) return {};
  if (typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("options 必须是对象");
  }
  return {
    ...(options.defaultPath !== undefined
      ? { defaultPath: requireOptionalNonEmptyString(options.defaultPath, "options.defaultPath") }
      : {}),
  };
}

module.exports = { requirePositiveId, requireNonEmptyString, requireOptionalNonEmptyString, requireSaveDialogOptions };
