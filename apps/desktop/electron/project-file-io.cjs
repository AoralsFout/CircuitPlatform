/**
 * 项目文件的原子写入：先写同目录临时文件、成功后 rename 替换目标文件。
 *
 * 规格 #34 的既定取舍：写到一半的失败不能留下损坏的项目文件。rename 在同一目录内进行，
 * 同一文件系统上它是原子操作；Node 在 Windows 上用带 REPLACE_EXISTING 的 MoveFileEx
 * 实现 rename，因此覆盖已存在的目标文件同样成立。临时文件带随机后缀，两个并发保存
 * 不会写同一个临时路径。
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

/**
 * 把 UTF-8 文本内容原子写入目标路径。
 * @param {Pick<typeof fs, "writeFileSync" | "renameSync" | "unlinkSync">} fsModule 文件系统模块；
 *   测试注入假实现即可验证失败路径，生产调用方省略。
 * @param {string} targetPath 目标文件的绝对路径。
 * @param {string} content 要写入的 UTF-8 文本。
 * @returns {void} 成功时目标文件的内容恰好是 content。
 * @throws {Error} 写入或替换失败时抛出；此时目标文件保持原内容，临时文件已被清理。
 */
function writeTextFileAtomically(fsModule, targetPath, content) {
  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    fsModule.writeFileSync(tempPath, content, "utf8");
    fsModule.renameSync(tempPath, targetPath);
  } catch (error) {
    // 写入或替换失败都清理临时文件：失败留在磁盘上的半成品与「没有保存过」没有区别。
    try {
      fsModule.unlinkSync(tempPath);
    } catch {
      // 临时文件可能尚未创建；清理失败不掩盖原始错误。
    }
    throw error;
  }
}

/**
 * 读取 UTF-8 文本文件的内容。
 * 存在性先单独检查：让「文件不存在」成为一句可展示的原因，而不是 Node 的 ENOENT 堆栈文案。
 * @param {Pick<typeof fs, "existsSync" | "readFileSync">} fsModule 文件系统模块；
 *   测试注入假实现即可验证失败路径，生产调用方省略。
 * @param {string} filePath 要读取的文件路径。
 * @returns {string} 文件的 UTF-8 文本；开头的 UTF-8 BOM 已剥掉——Windows 记事本等编辑器
 *   保存的文件可能带 BOM，而 JSON.parse 不认它，剥掉后这类文件照常打开。
 * @throws {Error} 文件不存在或读取失败时抛出；message 可直接展示给用户。
 */
function readTextFile(fsModule, filePath) {
  if (!fsModule.existsSync(filePath)) {
    throw new Error("项目文件不存在。");
  }
  const content = fsModule.readFileSync(filePath, "utf8");
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

module.exports = { writeTextFileAtomically, readTextFile };
