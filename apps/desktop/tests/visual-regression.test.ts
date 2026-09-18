import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const desktopRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** 真实 Vue/CircuitCanvas 截图脚本覆盖完整状态矩阵，避免回归漏掉关键交互状态。 */
test("visual fixture covers the required state matrix and reduced motion mode", async () => {
  const fixture = await readFile(join(desktopRoot, "visual-regression.html"), "utf8");
  const script = await readFile(join(desktopRoot, "scripts", "visual-regression.mjs"), "utf8");
  const styles = await readFile(join(desktopRoot, "src", "styles.css"), "utf8");
  for (const state of ["default", "empty", "selected-component", "selected-wire", "draft", "dangling", "pending", "error", "running", "paused"]) {
    assert.match(script, new RegExp(state.replace("-", "\\-")));
  }
  assert.match(script, /regular: \{ width: 1440, height: 900 \}/);
  assert.match(script, /narrow: \{ width: 720, height: 560 \}/);
  assert.match(fixture, /data-motion="reduced"/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /animation: none !important/);
  assert.match(styles, /transition: none !important/);
  assert.match(fixture, /import\("\/src\/main\.ts"\)/);
  assert.doesNotMatch(fixture, /fixture-node|style="left:|<path[^>]+ d="/);
});

/**
 * 内存 adapter 取代的是引擎边界，因此必须覆盖 `EngineAdapter` 的全部方法。
 * 每加一条运行控制就漏一次的代价是截图页整片挂掉，所以这里按接口本身而不是手抄一份清单来断言。
 */
test("the visual fixture implements every engine adapter method", async () => {
  const workspace = await readFile(join(desktopRoot, "src", "workspace", "index.ts"), "utf8");
  const fixture = await readFile(join(desktopRoot, "visual-regression.html"), "utf8");
  const adapterBody = workspace.match(/export interface EngineAdapter \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(adapterBody, "没有找到 EngineAdapter 接口");
  const methods = [...adapterBody.matchAll(/^  (\w+)\(/gm)].map((match) => match[1]);
  assert.ok(methods.length >= 8, `没有从 EngineAdapter 解析出方法：${methods.join(", ")}`);
  for (const method of methods) {
    assert.match(fixture, new RegExp(`\\b${method}:`), `视觉回归的内存 adapter 缺少 ${method}`);
  }
});

/** 语义 class 是截图和实际画布共用的视觉契约，不能只在夹具中伪造。 */
test("canvas exposes non-color state hooks for ports and wires", async () => {
  const canvas = await readFile(join(desktopRoot, "src", "components", "CircuitCanvas.vue"), "utf8");
  const styles = await readFile(join(desktopRoot, "src", "styles.css"), "utf8");
  assert.match(canvas, /data-signal/);
  assert.match(canvas, /data-dangling/);
  assert.match(canvas, /node-port--dangling/);
  assert.match(canvas, /node-port--connection-target/);
  assert.match(canvas, /node-port__anchor/);
  assert.match(canvas, /node-port__label/);
  assert.doesNotMatch(canvas, /\{\{ port\.name \}\} · \{\{ port\.signal \}\}/);
  assert.match(styles, /\.node-port--left \.node-port__anchor[^}]+translate\(-50%, -50%\)/);
  assert.match(styles, /\.node-port--right \.node-port__anchor[^}]+translate\(50%, -50%\)/);
  assert.match(canvas, /signal-wire--draft/);
  assert.match(canvas, /wire-signal-flow/);
  assert.match(canvas, /wire-signal-label/);
  assert.match(canvas, /wire\.danglingEndpoints\.length === 0/);
  // 信号值必须是常显的等宽文字，流向只由 CSS 虚线表达：SMIL 动画 textPath 的
  // startOffset 会让每条 Wire 的文本逐帧重新排版，目标规模下不可用。
  assert.doesNotMatch(canvas, /<animate/);
  assert.doesNotMatch(canvas, /startOffset="-"/);
  assert.match(styles, /\.wire-signal-flow \{[^}]*stroke-dasharray/);
  assert.match(styles, /@keyframes wire-signal-dash/);
  assert.match(styles, /\.wire-signal-label \{ display: block;/);
  assert.match(canvas, /signal-wire-outline/);
  assert.doesNotMatch(styles, /\.signal-wire--live\s*\{/);
  assert.doesNotMatch(styles, /\.signal-wire--unknown\s*\{/);
  assert.match(canvas, /circuit-canvas--connecting/);
  assert.match(styles, /\.circuit-canvas--connecting \{ cursor: crosshair; \}/);
  assert.match(canvas, /正在放置/);
  assert.match(canvas, /放置失败/);
  assert.match(canvas, />重试</);
  assert.match(canvas, />取消</);
});

test("canvas menus consume wheel events and nodes expose only their type label", async () => {
  const canvas = await readFile(join(desktopRoot, "src", "components", "CircuitCanvas.vue"), "utf8");
  const menu = await readFile(join(desktopRoot, "src", "components", "ComponentMenu.vue"), "utf8");
  assert.match(menu, /@wheel\.stop/);
  assert.match(menu, /@pointerdown\.stop/);
  assert.match(canvas, /class="object-context-menu"[\s\S]*@wheel\.stop/);
  assert.match(canvas, /<strong>\{\{ node\.kind\.toUpperCase\(\) \}\}<\/strong>/);
  assert.doesNotMatch(canvas, /<span class="node-tag">\{\{ node\.kind/);
  assert.doesNotMatch(canvas, /<span class="node-description">\{\{ node\.description \}\}<\/span>/);
});

test("canvas starts pointer panning only from background for an ordinary left drag", async () => {
  const canvas = await readFile(join(desktopRoot, "src", "components", "CircuitCanvas.vue"), "utf8");
  const styles = await readFile(join(desktopRoot, "src", "styles.css"), "utf8");
  assert.match(canvas, /isViewportPanPointer\(event\.button, spacePressed, hit\?\.kind === "background"\)/);
  assert.match(canvas, /circuit-canvas--panning/);
  assert.match(styles, /\.circuit-canvas \{[^}]+cursor: grab;/);
  assert.match(styles, /\.circuit-canvas--panning \{ cursor: grabbing; \}/);
});

test("context menu removes a draft waypoint or cancels an empty draft", async () => {
  const canvas = await readFile(join(desktopRoot, "src", "components", "CircuitCanvas.vue"), "utf8");
  const app = await readFile(join(desktopRoot, "src", "App.vue"), "utf8");
  assert.match(canvas, /emit\("connectionWaypointRemoveOrCancel"\)/);
  assert.match(app, /@connection-waypoint-remove-or-cancel="removeConnectionWaypointOrCancel"/);
});

/** 键盘等价路径必须真的接线到画布、App 与主进程，而不只是在解析器里存在。 */
test("keyboard equivalents for nudging and zooming are wired end to end", async () => {
  const canvas = await readFile(join(desktopRoot, "src", "components", "CircuitCanvas.vue"), "utf8");
  const app = await readFile(join(desktopRoot, "src", "App.vue"), "utf8");
  const styles = await readFile(join(desktopRoot, "src", "styles.css"), "utf8");
  const main = await readFile(join(desktopRoot, "electron", "main.cjs"), "utf8");

  // 键盘微调复用指针拖动事件，从而继承「一次手势 = 一条历史命令」。
  assert.match(canvas, /emit\("nodeDragStart", \{ nodeId: target\.componentId/);
  assert.match(canvas, /emit\("routeEditStart", \{ connectionId: target\.connectionId/);
  assert.match(canvas, /if \(event\.key\.startsWith\("Arrow"\)\) endNudge\(\)/);
  assert.match(app, /@node-drag-start=/);

  // Route 手柄进入方向键导航环，但不占用 Tab 序。
  assert.match(canvas, /data-canvas-arrow-focus/);
  assert.match(canvas, /const ARROW_FOCUS_SELECTOR = "\[data-canvas-focus\], \[data-canvas-arrow-focus\]"/);
  assert.match(canvas, /querySelectorAll<HTMLElement>\("\[data-canvas-focus\]"\)/);
  assert.match(styles, /\.route-waypoint-handle:focus-visible/);
  assert.match(styles, /\.route-segment-hit:focus-visible/);

  // 缩放在 App 的快捷键分发里处理，且不能落到删除兜底分支。
  assert.match(app, /case "zoom-in": adjustZoom\(ZOOM_STEP\)/);
  assert.match(app, /case "zoom-fit": fitViewport\(\)/);
  assert.match(app, /const unhandled: never = shortcut/);

  // Electron 默认菜单会抢走这几个加速键，并让裸 Alt 聚焦菜单栏。
  assert.match(main, /Menu\.setApplicationMenu\(null\)/);
});

/** 运行控制的键盘等价路径同样要从解析器一路接到工具栏与工作区。 */
test("keyboard equivalents for run control are wired end to end", async () => {
  const app = await readFile(join(desktopRoot, "src", "App.vue"), "utf8");
  const toolbar = await readFile(join(desktopRoot, "src", "components", "EditorToolbar.vue"), "utf8");
  const workspace = await readFile(join(desktopRoot, "src", "workspace", "index.ts"), "utf8");

  // 四个动作都在 App 的快捷键分发里处理，而不是只存在于解析器里。
  assert.match(app, /case "start-or-resume-simulation": void runSimulationFromKeyboard\(\)/);
  assert.match(app, /case "pause-simulation": void pause\(\)/);
  assert.match(app, /case "step-simulation": void step\(\)/);
  assert.match(app, /case "reset-simulation": void reset\(\)/);
  // F5 是一个意图：已停止时开始，已暂停时继续。
  assert.match(app, /if \(state\.value\.simulationState === "stopped"\) await start\(\)/);
  assert.match(app, /else if \(state\.value\.simulationState === "paused"\) await resume\(\)/);

  // 工具栏如实暴露三态控制与步数，并接到工作区的运行循环。
  assert.match(toolbar, /emit\('startSimulation'\)/);
  assert.match(toolbar, /emit\('pauseSimulation'\)/);
  assert.match(toolbar, /emit\('resumeSimulation'\)/);
  assert.match(toolbar, /emit\('stepSimulation'\)/);
  assert.match(toolbar, /emit\('resetSimulation'\)/);
  assert.match(toolbar, /runStateLabel/);
  assert.match(app, /@start-simulation="start"/);
  assert.match(app, /@pause-simulation="pause"/);
  assert.match(app, /@resume-simulation="resume"/);
  assert.match(app, /@reset-simulation="reset"/);

  // 运行循环排定下一次推进之前必须等上一次响应，且下一次推进只能由调度器排定。
  assert.match(workspace, /const advanced = await enqueue\(\(\) => stepInternal\(bindings, \{ record: false \}\)\)/);
  assert.match(workspace, /scheduleTick\(\);\n    notifyAdvanced\(\);/);
  // 暂停要取消已经排定的下一次推进。
  assert.match(workspace, /cancelTick\(\);\n      state\.simulationState = "paused"/);
});
