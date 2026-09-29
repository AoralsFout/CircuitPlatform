import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { extractFile, listPackage, uncache } from "@electron/asar";
import { readReleaseVersion } from "./release-version.mjs";

/** 检查安装内容的版本、运行入口及资源；缺文件、混入开发文件或错误架构时抛错。 */
export function checkPackageContents(directory, expectedVersion) {
  const archivePath = join(directory, "resources/app.asar");
  const enginePath = join(directory, "resources/engine/circuit-engine.exe");
  for (const file of ["CircuitPlatform.exe", "resources/app.asar", "resources/engine/circuit-engine.exe"]) {
    assert.ok(existsSync(join(directory, file)), `发布包缺少 ${file}`);
  }
  for (const file of [join(directory, "CircuitPlatform.exe"), enginePath]) {
    const bytes = readFileSync(file);
    assert.equal(bytes.subarray(0, 2).toString(), "MZ", `${file} 不是 Windows 可执行文件`);
    const header = bytes.readUInt32LE(0x3c);
    assert.equal(bytes.readUInt32LE(header), 0x00004550, `${file} 缺少 PE 头`);
    assert.equal(bytes.readUInt16LE(header + 4), 0x8664, `${file} 不是 x64 可执行文件`);
  }
  // 同一进程可能检查刚重新生成的同名归档，不能复用上一次 header 的文件偏移。
  uncache(archivePath);
  const entries = listPackage(archivePath).map((entry) => entry.replaceAll("\\", "/"));
  const metadata = JSON.parse(extractFile(archivePath, "package.json").toString());
  assert.equal(metadata.version, expectedVersion, "安装内容与源码版本不一致");
  assert.equal(metadata.main, "electron/main.cjs", "安装内容缺少正式 Electron 入口");
  for (const file of ["/electron/main.cjs", "/electron/preload.cjs", "/dist/index.html"]) {
    assert.ok(entries.includes(file), `app.asar 缺少 ${file}`);
  }
  assert.ok(entries.some((entry) => /^\/dist\/assets\/.+\.js$/.test(entry)), "缺少渲染器脚本");
  assert.ok(!entries.some((entry) => /^\/(?:tests|scripts|src|node_modules)(?:\/|$)/.test(entry)), "发布包混入开发文件或未打包依赖");
  const html = extractFile(archivePath, "dist/index.html").toString();
  assert.ok(!/(?:src|href)=["']\/assets\//.test(html), "file:// 入口使用了绝对资源路径");
  return { archivePath, enginePath, version: metadata.version };
}

/** 在仅含系统目录的 PATH 下启动打包引擎并检查协议，确保最终用户无需编译工具运行库。 */
export function checkPackagedEngine(enginePath) {
  assert.equal(process.platform, "win32", "Windows 发布包需要在 Windows 上验证运行");
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "C:\\Windows";
  const env = {
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    PATH: `${systemRoot}\\System32;${systemRoot}`,
    TEMP: process.env.TEMP ?? systemRoot,
    TMP: process.env.TMP ?? systemRoot,
  };
  const result = spawnSync(enginePath, [], {
    cwd: resolve(enginePath, ".."),
    env,
    input: '{"type":"health_check","requestId":"packaged-health"}\n',
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `打包引擎无法独立启动：${result.stderr}`);
  const response = JSON.parse(result.stdout.trim());
  assert.equal(response.type, "health_check_result");
  assert.equal(response.requestId, "packaged-health");
  return response;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = resolve(process.argv[2] ?? "release/win-unpacked");
  const result = checkPackageContents(directory, readReleaseVersion());
  const health = checkPackagedEngine(result.enginePath);
  assert.equal(health.engine, `CircuitPlatform C++ Engine ${result.version}`, "引擎与应用版本不一致");
  console.log(JSON.stringify({ directory, version: result.version, engine: health }, null, 2));
}
