import { app, BrowserWindow } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(desktopRoot, "artifacts", "visual-regression");
const states = ["default", "empty", "selected-component", "selected-wire", "draft", "dangling", "pending", "error"];
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
    const window = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: { sandbox: true } });
    window.webContents.on("console-message", (_event, level, message) => console.error(`[visual console ${level}] ${message}`));
    window.webContents.on("did-fail-load", (_event, code, description) => console.error(`[visual load ${code}] ${description}`));
    const manifest = [];
    for (const theme of options.themes) {
      for (const [viewportName, viewport] of Object.entries(viewports)) {
        for (const state of options.states) {
          window.setSize(viewport.width, viewport.height);
          const motion = options.reducedMotion ? "&motion=reduced" : "";
          await window.loadURL(`http://127.0.0.1:${port}/visual-regression.html?theme=${theme}&state=${state}${motion}`);
          // 等待真实 Vue 场景完成挂载；首次 Vite 依赖编译可能超过普通动画等待时间。
          await window.webContents.executeJavaScript("new Promise((resolve, reject) => { const started = Date.now(); const check = () => document.querySelector('.app-shell') ? resolve(true) : Date.now() - started > 20000 ? reject(new Error('真实 Vue App 挂载超时')) : setTimeout(check, 50); check(); })");
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 180));
          const bodyText = await window.webContents.executeJavaScript("document.body.innerText.slice(0, 120)");
          if (!bodyText) throw new Error(`真实 Vue 页面未渲染：${theme}/${viewportName}/${state}`);
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
