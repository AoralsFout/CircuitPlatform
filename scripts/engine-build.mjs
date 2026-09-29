import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildDirectory = resolve(root, "engine/build");
const action = process.argv[2];

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw new Error(`无法运行 ${command}：${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (action === "build") {
  const configureArgs = ["-S", "engine", "-B", buildDirectory, "-DCMAKE_BUILD_TYPE=Release"];
  // 已有构建树必须沿用缓存的生成器；新构建允许 CI 通过 CMAKE_GENERATOR 选择工具链。
  if (!existsSync(resolve(buildDirectory, "CMakeCache.txt")) &&
      process.platform === "win32" && !process.env.CMAKE_GENERATOR) {
    configureArgs.push("-G", "MinGW Makefiles");
  }
  run("cmake", configureArgs);
  run("cmake", ["--build", buildDirectory, "--config", "Release", "--parallel", "2"]);
} else if (action === "test") {
  run("ctest", ["--test-dir", buildDirectory, "--build-config", "Release", "--output-on-failure"]);
} else {
  throw new Error("用法：node scripts/engine-build.mjs build|test");
}
