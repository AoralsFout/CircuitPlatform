import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const scriptPath = fileURLToPath(import.meta.url);
const desktopRoot = resolve(dirname(scriptPath), "..");
const resultPrefix = "RUNTIME_STARTUP_PROBE_RESULT=";
const blockerContents = "runtime startup probe: logs is deliberately a regular file\n";

/**
 * Node 父进程为真实 Electron 启动建立故障 profile，限制运行期限并在退出后回收它。
 * 入口：node apps/desktop/scripts/runtime-startup-probe.mjs；需先构建 dist 和真实引擎。
 */
async function runParent() {
  const engineName = process.platform === "win32" ? "circuit-engine.exe" : "circuit-engine";
  const enginePath = resolve(process.env.CIRCUIT_ENGINE_PATH ?? join(desktopRoot, "../../engine/build", engineName));
  assert.ok(existsSync(enginePath), `缺少真实 C++ 引擎：${enginePath}`);
  assert.ok(existsSync(join(desktopRoot, "dist/index.html")), "缺少生产页面；请先构建桌面应用");
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "circuitplatform-runtime-startup-"));
  const profile = join(temporaryDirectory, "profile");
  let child;
  let exited;
  let watchdog;
  let stdout = "";
  let stderr = "";
  let quitRequestedAt = null;
  try {
    await mkdir(profile);
    await writeFile(join(profile, "logs"), blockerContents);
    const env = { ...process.env, CIRCUIT_ENGINE_PATH: enginePath, CIRCUIT_PLATFORM_PRODUCTION: "1" };
    for (const key of Object.keys(env)) {
      if (["electron_run_as_node", "node_options", "node_path", "circuit_platform_e2e", "circuit_platform_e2e_url"].includes(key.toLowerCase())) delete env[key];
    }
    // Linux CI 在加载本探针前检查 SUID 沙箱，测试参数必须从原生命令行传入。
    const args = [scriptPath, `--user-data-dir=${profile}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])];
    child = spawn(require("electron"), args, {
      cwd: temporaryDirectory,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => {
      stdout = (stdout + chunk).slice(-65_536);
      if (quitRequestedAt === null && stdout.includes(resultPrefix)) quitRequestedAt = Date.now();
    });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-65_536); });
    exited = once(child, "exit");
    // error 可能先于下一次 await；提前处理拒绝才能保证缺失可执行文件也经过 finally 清理。
    void exited.catch(() => {});
    const [exitCode, signal] = await Promise.race([
      exited,
      new Promise((_, reject) => {
        watchdog = setTimeout(() => reject(new Error("真实 Electron 日志故障启动验收超过 30 秒")), 30_000);
      }),
    ]);
    assert.equal(exitCode, 0, `Electron 退出失败（signal=${signal}）\n${stdout}\n${stderr}`);
    const resultLine = stdout.split(/\r?\n/).find((line) => line.startsWith(resultPrefix));
    assert.ok(resultLine, `Electron 未报告生产启动验收结果\n${stdout}\n${stderr}`);
    const result = JSON.parse(resultLine.slice(resultPrefix.length));
    assert.equal(result.productionPageLoaded, true);
    assert.equal(result.engineHealth, "ok");
    assert.equal(result.loggerDisabled, true);
    assert.ok(result.droppedEntries > 0);
    assert.equal(result.e2eBridgeAbsent, true);
    const shutdownElapsedMs = Date.now() - quitRequestedAt;
    assert.ok(shutdownElapsedMs < 5000, `诊断故障不能阻塞正常退出：${shutdownElapsedMs}ms`);
    assert.equal(await readFile(join(profile, "logs"), "utf8"), blockerContents);
    console.log("Runtime startup probe passed", JSON.stringify({ ...result, shutdownElapsedMs, logBlockerPreserved: true }));
  } catch (error) {
    throw new Error(`Runtime startup probe failed: ${error.message}\n${stdout}\n${stderr}`, { cause: error });
  } finally {
    clearTimeout(watchdog);
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      let cleanupTimeout;
      await Promise.race([
        exited.catch(() => {}),
        new Promise((done) => { cleanupTimeout = setTimeout(done, 5000); }),
      ]);
      clearTimeout(cleanupTimeout);
    }
    const tempRelative = relative(resolve(tmpdir()), resolve(temporaryDirectory));
    assert.ok(!isAbsolute(tempRelative) && !tempRelative.startsWith("..") && dirname(tempRelative) === "." && tempRelative.startsWith("circuitplatform-runtime-startup-"));
    await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

/**
 * Electron 子进程加载正式 main 和生产构建页面，只观察实际 logger 实例；不替换日志或引擎行为。
 * 意外错误弹框转成非零退出，使无人值守验收失败而不是等待用户操作。
 */
async function runElectronProbe() {
  const { app, BrowserWindow, dialog } = require("electron");
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("no-sandbox");
  dialog.showErrorBox = (title, message) => {
    console.error("Runtime startup probe intercepted fatal dialog", title, message);
    app.exit(1);
  };
  const windowCreated = new Promise((resolveWindow) => {
    app.once("browser-window-created", (_event, window) => {
      window.hide();
      window.on("show", () => window.hide());
      window.webContents.on("preload-error", (_event, _path, error) => console.error("Startup probe preload error", error));
      window.webContents.on("render-process-gone", (_event, details) => console.error("Startup probe renderer exited", details));
      resolveWindow(window);
    });
  });
  const loggerModule = require("../electron/diagnostic-logger.cjs");
  const originalCreateLogger = loggerModule.createDiagnosticLogger;
  let diagnostics;
  // 只保存 main 创建的真实实例，原始工厂的参数和返回值完全保留。
  loggerModule.createDiagnosticLogger = (...args) => {
    diagnostics = originalCreateLogger(...args);
    return diagnostics;
  };
  try {
    require("../electron/main.cjs");
  } finally {
    loggerModule.createDiagnosticLogger = originalCreateLogger;
  }
  await app.whenReady();
  const window = await windowCreated;
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  await window.webContents.executeJavaScript(`new Promise((resolveReady, reject) => {
    const deadline = Date.now() + 15000;
    const check = () => {
      if (window.circuitPlatform && document.querySelector('.empty-state')) return resolveReady(true);
      if (Date.now() > deadline) return reject(new Error('生产页面和 preload 未就绪'));
      setTimeout(check, 25);
    };
    check();
  })`);
  assert.equal(window.webContents.getURL(), pathToFileURL(join(desktopRoot, "dist/index.html")).href);
  const health = await window.webContents.executeJavaScript("window.circuitPlatform.checkEngine()");
  assert.equal(health.status, "ok", JSON.stringify(health));
  const e2eBridgeAbsent = await window.webContents.executeJavaScript("typeof window.circuitPlatform.killForTest === 'undefined'");
  assert.equal(e2eBridgeAbsent, true);
  assert.ok(diagnostics, "正式 main 应创建诊断实例");
  await diagnostics.flush();
  const loggerStatus = diagnostics.status();
  assert.equal(loggerStatus.disabled, true, "logs 普通文件应让真实诊断写入退化");
  assert.ok(loggerStatus.droppedEntries > 0);
  assert.equal(await readFile(join(app.getPath("userData"), "logs"), "utf8"), blockerContents);
  console.log(resultPrefix + JSON.stringify({
    productionPageLoaded: true,
    engineHealth: health.status,
    loggerDisabled: loggerStatus.disabled,
    droppedEntries: loggerStatus.droppedEntries,
    e2eBridgeAbsent,
  }));
  // 走正式 before-quit/flush 路径；退出耗时由 Node 父进程独立观察。
  app.quit();
}

if (process.versions.electron) {
  runElectronProbe().catch((error) => {
    console.error(error);
    require("electron").app.exit(1);
  });
} else {
  runParent().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
