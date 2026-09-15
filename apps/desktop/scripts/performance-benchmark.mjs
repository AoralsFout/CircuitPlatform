import { createServer } from "vite";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv.find((value) => value.startsWith("--mode="))?.slice(7) ?? "pan";
const duration = process.argv.find((value) => value.startsWith("--duration-ms="))?.slice(14) ?? "5000";
if (!['pan', 'drag'].includes(mode)) throw new Error("--mode must be pan or drag");
const noFail = process.argv.includes("--no-fail");
const port = mode === "drag" ? 4177 : 4176;
const vite = await createServer({ root, server: { host: "127.0.0.1", port, strictPort: true } });
await vite.listen();
const electron = process.platform === "win32"
  ? resolve(root, "node_modules", "electron", "dist", "electron.exe")
  : resolve(root, "node_modules", ".bin", "electron");
const runner = resolve(root, "scripts", "performance-benchmark-runner.cjs");
const url = `http://127.0.0.1:${port}/benchmark.html?components=500&wires=1000`;
const child = spawn(electron, [runner, `--url=${url}`, `--mode=${mode}`, `--duration=${duration}`], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
let stdout = "";
child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
const exitCode = await new Promise((resolveExit) => child.on("close", resolveExit));
await vite.close();
const marker = stdout.split(/\r?\n/).find((line) => line.startsWith("BENCHMARK_RESULT "));
if (!marker) { process.exitCode = exitCode || 1; throw new Error("真实 Electron 基准没有返回结果。"); }
const measured = JSON.parse(marker.slice("BENCHMARK_RESULT ".length));
const result = { viewport: "1920x1080", components: 500, wires: 1000, mode, durationMs: Number(duration), ...measured, budgetMs: 20, pass: measured.p95FrameMs <= 20 };
console.log(JSON.stringify(result, null, 2));
if (!result.pass && !noFail) process.exitCode = 1;
