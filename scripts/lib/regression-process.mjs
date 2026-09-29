import { spawn, spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";

function stopProcessTree(child) {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, timeout: 5_000 });
    if (result.status !== 0) child.kill("SIGKILL");
  } else {
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }
}

/**
 * 启动一项真实进程回归，返回退出码、耗时与失败原因，并保存完整输出。
 * command/args 不经过 shell；必须同时正常退出且输出 successMarker 才成功。
 * 超时或中断会清理该子进程树，避免 Electron、Vite 或引擎遗留影响下一次回归。
 */
export async function runRegressionProcess({ command, args, cwd, env, logPath, successMarker, timeoutMs = 180_000, mirrorOutput = true }) {
  const started = Date.now();
  const chunks = [];
  let failure;
  const outcome = await new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    const capture = (destination) => (chunk) => {
      chunks.push(chunk);
      if (mirrorOutput) destination.write(chunk);
    };
    child.stdout.on("data", capture(process.stdout));
    child.stderr.on("data", capture(process.stderr));
    const interrupt = () => {
      failure = "回归被中断";
      stopProcessTree(child);
    };
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    const timer = setTimeout(() => {
      failure = `超过 ${timeoutMs}ms，已终止进程树`;
      stopProcessTree(child);
    }, timeoutMs);
    child.once("error", (error) => { failure = `无法启动回归进程：${error.message}`; });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
      resolve({ exitCode, signal });
    });
  });
  const output = Buffer.concat(chunks).toString("utf8");
  await writeFile(logPath, output, "utf8");
  if (!failure && outcome.exitCode !== 0) failure = `进程退出码 ${outcome.exitCode}，信号 ${outcome.signal ?? "无"}`;
  if (!failure && /^\s*SKIP\b/im.test(output)) failure = "回归输出 SKIP，不能计为通过";
  if (!failure && !output.includes(successMarker)) failure = `未输出完成标记：${successMarker}`;
  return { ...outcome, passed: failure === undefined, durationMs: Date.now() - started, ...(failure ? { failure } : {}) };
}
