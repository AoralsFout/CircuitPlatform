const path = require("node:path");

/**
 * 返回当前运行方式的引擎绝对路径；安装版只使用随包资源，开发版允许测试覆盖。
 * @param {{isPackaged: boolean, resourcesPath: string, desktopRoot: string, platform?: string, env?: NodeJS.ProcessEnv}} options 运行环境。
 * @returns {string} 不依赖当前工作目录的引擎路径。
 */
function resolveEnginePath({ isPackaged, resourcesPath, desktopRoot, platform = process.platform, env = process.env }) {
  const fileName = platform === "win32" ? "circuit-engine.exe" : "circuit-engine";
  if (isPackaged) return path.join(resourcesPath, "engine", fileName);
  return env.CIRCUIT_ENGINE_PATH || path.resolve(desktopRoot, "../../engine/build", fileName);
}

module.exports = { resolveEnginePath };
