import { access, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runRegressionProcess } from "./lib/regression-process.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = join(root, "apps/desktop");
const artifactDirectory = join(root, "artifacts/regression");
const enginePath = resolve(process.env.CIRCUIT_ENGINE_PATH || join(root, "engine/build", process.platform === "win32" ? "circuit-engine.exe" : "circuit-engine"));
const cases = [
  ["multidocument-e2e", "Multidocument production E2E passed"],
  ["embedded-snapshot-e2e", "Embedded snapshot production Electron E2E passed"],
  ["subcircuit-library-probe", "Subcircuit library DOM, keyboard, and export probe passed"],
  ["embedded-definition-navigation-e2e", "Embedded definition navigation Electron E2E passed"],
  ["embedded-port-repair-e2e", "Embedded Port repair Electron E2E passed"],
  ["canvas-selection-regression", "Sidebar click placement regression passed"],
  ["visual-state-probe", "Visual state probe passed for"],
  ["runtime-startup-probe", "Runtime startup probe passed", "node"],
];

async function main() {
  await mkdir(artifactDirectory, { recursive: true });
  const summary = { startedAt: new Date().toISOString(), platform: process.platform, enginePath, passed: false, cases: [] };
  // 先覆盖上一轮成功记录，硬中断也不能留下看似本轮通过的旧结果。
  await writeFile(join(artifactDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  let temporaryDirectory;
  try {
    try { await access(enginePath, constants.X_OK); }
    catch { throw new Error(`缺少可执行的真实 C++ 引擎：${enginePath}；先运行 pnpm build:engine。`); }
    const require = createRequire(join(desktopRoot, "package.json"));
    const electronPath = require("electron");
    temporaryDirectory = await mkdtemp(join(tmpdir(), "circuitplatform-regression-"));
    for (const [name, successMarker, runtime = "electron"] of cases) {
      console.log(`\n[regression] ${name}`);
      const userData = join(temporaryDirectory, name);
      await mkdir(userData);
      const env = { ...process.env, CIRCUIT_ENGINE_PATH: enginePath, CIRCUIT_REGRESSION_USER_DATA: userData };
      delete env.ELECTRON_RUN_AS_NODE;
      const script = join(desktopRoot, "scripts", `${name}.mjs`);
      // Linux CI 的沙箱检查早于 JavaScript 入口，只在测试进程启动参数中提前声明。
      const electronArgs = [join(root, "scripts/regression-child.mjs"), script, `--user-data-dir=${userData}`,
        ...(process.platform === "linux" ? ["--no-sandbox"] : [])];
      const result = await runRegressionProcess({
        command: runtime === "node" ? process.execPath : electronPath,
        args: runtime === "node" ? [script] : electronArgs,
        cwd: desktopRoot,
        env,
        successMarker,
        logPath: join(artifactDirectory, `${name}.log`),
      });
      summary.cases.push({ name, ...result });
      try {
        await cp(join(userData, "logs"), join(artifactDirectory, `${name}-runtime`), { recursive: true });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (!result.passed) throw new Error(`${name} 失败：${result.failure}`);
    }
    summary.passed = true;
    console.log(`\nElectron 回归全部通过：${cases.length}/${cases.length}。`);
  } catch (error) {
    summary.failure = error.message;
    throw error;
  } finally {
    summary.finishedAt = new Date().toISOString();
    await writeFile(join(artifactDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    if (temporaryDirectory) {
      const cleanupPath = resolve(temporaryDirectory);
      if (dirname(cleanupPath) !== resolve(tmpdir()) || !basename(cleanupPath).startsWith("circuitplatform-regression-")) {
        throw new Error(`拒绝清理非本次回归临时目录：${cleanupPath}`);
      }
      await rm(cleanupPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
