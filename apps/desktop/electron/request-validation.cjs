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

module.exports = { requirePositiveId };
