import { createServer } from "vite";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv.find((value) => value.startsWith("--mode="))?.slice(7) ?? "pan";
const duration = process.argv.find((value) => value.startsWith("--duration-ms="))?.slice(14) ?? "5000";
const MODES = ["pan", "drag", "place", "wire", "route"];
if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(", ")}`);

/**
 * 每种模式都必须证明交互真的发生了。
 * 只测到空转的基准会给出漂亮的数字，因此这里让它直接失败。
 */
const CHECKS = {
  pan: {
    describe: "视口平移",
    ok: (initial, final) => initial.viewport.x !== final.viewport.x || initial.viewport.y !== final.viewport.y,
  },
  drag: {
    describe: "Component 拖动预览",
    ok: (_initial, final) => final.dragPreview !== null,
  },
  place: {
    describe: "放置 ghost 跟随",
    ok: (initial, final) => final.placementCenter !== null
      && (initial.placementCenter === null
        || initial.placementCenter.x !== final.placementCenter.x
        || initial.placementCenter.y !== final.placementCenter.y),
  },
  wire: {
    describe: "ConnectionDraft 布线",
    ok: (_initial, final) => final.draftPoints > 1,
  },
  route: {
    describe: "Wire Route 折点拖动",
    ok: (_initial, final) => final.routeEditPoints > 1,
  },
};

const noFail = process.argv.includes("--no-fail");
// 验收规模是 500 / 1000；这两个参数只为定位成本随规模的变化，不改变验收口径。
const components = process.argv.find((value) => value.startsWith("--components="))?.slice(13) ?? "500";
const wires = process.argv.find((value) => value.startsWith("--wires="))?.slice(8) ?? "1000";
const port = 4176 + MODES.indexOf(mode);
const vite = await createServer({ root, server: { host: "127.0.0.1", port, strictPort: true } });
await vite.listen();
const electron = process.platform === "win32"
  ? resolve(root, "node_modules", "electron", "dist", "electron.exe")
  : resolve(root, "node_modules", ".bin", "electron");
const runner = resolve(root, "scripts", "performance-benchmark-runner.cjs");
const url = `http://127.0.0.1:${port}/benchmark.html?components=${components}&wires=${wires}&mode=${mode}`;
const child = spawn(electron, [runner, `--url=${url}`, `--mode=${mode}`, `--duration=${duration}`], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
let stdout = "";
child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
const exitCode = await new Promise((resolveExit) => child.on("close", resolveExit));
await vite.close();
const marker = stdout.split(/\r?\n/).find((line) => line.startsWith("BENCHMARK_RESULT "));
if (!marker) { process.exitCode = exitCode || 1; throw new Error("真实 Electron 基准没有返回结果。"); }
const measured = JSON.parse(marker.slice("BENCHMARK_RESULT ".length));
const check = CHECKS[mode];
const interacted = check.ok(measured.initial, measured.final);
const result = {
  viewport: "1920x1080",
  components: Number(components),
  wires: Number(wires),
  mode,
  interaction: check.describe,
  durationMs: Number(duration),
  frames: measured.frames,
  p95FrameMs: measured.p95FrameMs,
  maxFrameMs: measured.maxFrameMs,
  // 诊断字段：相邻 rAF 的真实间隔，含浏览器样式、布局、合成与动画采样。
  // 它不参与 pass 判定——基准环境用 disable-gpu 软件渲染，绝对帧间隔不可跨环境比较。
  frameP50Ms: measured.frameP50Ms,
  frameP95Ms: measured.frameP95Ms,
  // 成本定位用：渲染出的 DOM 元素数与 SMIL 动画数。
  domElements: measured.final.elements,
  smilAnimations: measured.final.animated,
  budgetMs: 20,
  interacted,
  observed: { initial: measured.initial, final: measured.final },
  pass: interacted && measured.p95FrameMs <= 20,
};
console.log(JSON.stringify(result, null, 2));
if (!result.pass && !noFail) process.exitCode = 1;
