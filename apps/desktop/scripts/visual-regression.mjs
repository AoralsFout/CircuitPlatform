import { app, BrowserWindow } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(desktopRoot, "artifacts", "visual-regression");
const states = [
  // 首启空状态（Phase 5 #40）：启动不再自动加载示例，画布区由引导面板占据。
  "first-start",
  // 最近项目（Phase 5 #42）：空状态面板里的最近项目列表，条目来自启动前种入的存储。
  "first-start-recent",
  "default", "empty", "selected-component", "selected-wire", "draft", "dangling", "pending", "error", "running", "paused",
  // 多位电路（Phase 4.5）：画布上的位区间标注与二进制信号文本、检查器的位宽编辑与位区间列表、
  // 输入设置里的按位按钮组（展开 / 收起，8 位与 1 位两种）。`bus-bit-space` 的画面与展开态
  // 相同，它不是给截图看的——探针在那上面用真实输入按一次 Space，验证这个键在输入设置作用域里
  // 仍然是原生按钮的激活语义（`visual:probe`）。
  "bus-canvas", "bus-inspector", "bus-ranges", "bus-bits-expanded", "bus-bits-collapsed", "bus-bit-single",
  "bus-bit-space",
];
const themes = ["dark", "light"];
const viewports = {
  regular: { width: 1440, height: 900 },
  narrow: { width: 720, height: 560 },
};

function parseArguments(argv) {
  const requestedStates = argv.find((value) => value.startsWith("--state="))?.slice("--state=".length);
  const requestedTheme = argv.find((value) => value.startsWith("--theme="))?.slice("--theme=".length);
  return {
    states: requestedStates ? states.filter((state) => requestedStates.split(",").includes(state)) : states,
    themes: requestedTheme ? themes.filter((theme) => theme === requestedTheme) : themes,
    reducedMotion: argv.includes("--reduced-motion"),
  };
}

function waitForServer(url, timeoutMs = 15_000) {
  const startedAt = Date.now();
  return new Promise((resolvePromise, reject) => {
    const poll = async () => {
      try {
        const response = await fetch(url);
        if (response.ok) return resolvePromise();
      } catch {
        // Vite is still starting.
      }
      if (Date.now() - startedAt > timeoutMs) return reject(new Error(`Vite did not start at ${url}`));
      setTimeout(poll, 100);
    };
    void poll();
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const port = 4175;
  app.disableHardwareAcceleration();
  // 使用正式 Vite/Vue 配置，截图页面挂载真实 App 与 CircuitCanvas。
  const vite = await createServer({ root: desktopRoot, server: { host: "127.0.0.1", port, strictPort: true } });
  try {
    await vite.listen();
    await waitForServer(`http://127.0.0.1:${port}/visual-regression.html`);
    await mkdir(outputRoot, { recursive: true });
    app.commandLine.appendSwitch("force-device-scale-factor", "1");
    app.commandLine.appendSwitch("disable-gpu");
    app.commandLine.appendSwitch("no-sandbox");
    await app.whenReady();
    // 显示窗口：隐藏窗口不会持续产出新帧，`capturePage()` 会拿到很早以前的那一张，
    // 拍出来的不是当前状态。与性能基准同样的理由——隐藏页面会被节流，画面跟不上交互。
    const window = new BrowserWindow({
      show: true,
      width: 1440,
      height: 900,
      webPreferences: { sandbox: true, backgroundThrottling: false },
    });
    window.webContents.on("console-message", (_event, level, message) => console.error(`[visual console ${level}] ${message}`));
    window.webContents.on("did-fail-load", (_event, code, description) => console.error(`[visual load ${code}] ${description}`));
    const manifest = [];
    for (const theme of options.themes) {
      for (const [viewportName, viewport] of Object.entries(viewports)) {
        for (const state of options.states) {
          window.setSize(viewport.width, viewport.height);
          const motion = options.reducedMotion ? "&motion=reduced" : "";
          await window.loadURL(`http://127.0.0.1:${port}/visual-regression.html?theme=${theme}&state=${state}${motion}`);
          // 等待真实 Vue 场景完成挂载、并且夹具已经把该状态的全部交互跑完。
          // 只等 `.app-shell` 会在准备过程中取图，拍到的就不是这个状态的最终画面。
          await window.webContents.executeJavaScript("new Promise((resolve, reject) => { const started = Date.now(); const check = () => { if (window.__visualError) return reject(new Error(`视觉夹具准备失败：${window.__visualError}`)); if (document.querySelector('.app-shell') && window.__visualReady) return resolve(true); if (Date.now() - started > 20000) return reject(new Error('真实 Vue App 未完成准备')); setTimeout(check, 50); }; check(); })");
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 180));
          const bodyText = await window.webContents.executeJavaScript("document.body.innerText.slice(0, 120)");
          if (!bodyText) throw new Error(`真实 Vue 页面未渲染：${theme}/${viewportName}/${state}`);
          // 再主动让合成器重画一帧并等它落地，取到的就是当前状态而不是上一张缓存帧。
          window.webContents.invalidate();
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 120));
          const image = await window.webContents.capturePage();
          const filename = `${theme}-${viewportName}-${state}${options.reducedMotion ? "-reduced-motion" : ""}.png`;
          const outputPath = resolve(outputRoot, filename);
          const png = image.toPNG();
          await writeFile(outputPath, png);
          manifest.push({ filename, theme, viewport: viewportName, state, sha256: createHash("sha256").update(png).digest("hex") });
        }
      }
    }
    await writeFile(resolve(outputRoot, "manifest.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), reducedMotion: options.reducedMotion, screenshots: manifest }, null, 2)}\n`);
    console.log(`Captured ${manifest.length} visual regression screenshots in ${outputRoot}`);
  } finally {
    await vite.close();
    if (app.isReady()) app.quit();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
