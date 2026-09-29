import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 校验根包、工作区包和 CMake 项目版本；返回共同版本，缺失或不一致时抛错并阻止发布。 */
export function readReleaseVersion(repositoryRoot = root) {
  const rootPackage = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8"));
  if (typeof rootPackage.version !== "string" || !/^\d+\.\d+\.\d+$/.test(rootPackage.version)) {
    throw new Error("根 package.json 缺少有效发布版本。");
  }
  for (const file of ["apps/desktop/package.json", "packages/protocol/package.json", "CMakeLists.txt", "engine/CMakeLists.txt"]) {
    const contents = readFileSync(resolve(repositoryRoot, file), "utf8");
    const version = file.endsWith(".json")
      ? JSON.parse(contents).version
      : /project\s*\([^)]*?\bVERSION\s+(\d+\.\d+\.\d+)\b/i.exec(contents)?.[1];
    if (version !== rootPackage.version) {
      throw new Error(`发布版本不一致：根包 ${rootPackage.version}，${file} ${version}。`);
    }
  }
  return rootPackage.version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(`Release version: ${readReleaseVersion()}`);
}
