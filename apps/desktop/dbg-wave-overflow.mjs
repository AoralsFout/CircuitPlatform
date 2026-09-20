import { app, BrowserWindow } from "electron";
import { createServer } from "vite";
import { resolve } from "node:path";

const log = (...args) => console.log("[dbg]", ...args);
const desktopRoot = resolve(process.cwd());
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("no-sandbox");
const vite = await createServer({ root: desktopRoot, server: { host: "127.0.0.1", port: 4199, strictPort: true } });
await vite.listen();
log("vite up");
await app.whenReady();
const win = new BrowserWindow({ show: true, width: 1440, height: 900, webPreferences: { sandbox: true, backgroundThrottling: false } });
await win.loadURL("http://127.0.0.1:4199/visual-regression.html?state=running&theme=dark");
log("page loaded");
try {
  await win.webContents.executeJavaScript(
    "new Promise((resolve, reject) => { const started = Date.now(); const check = () => {"
    + " if (window.__visualError) return reject(new Error('fixture error: ' + window.__visualError));"
    + " if (document.querySelector('.app-shell') && window.__visualReady) return resolve(true);"
    + " if (Date.now() - started > 20000) return reject(new Error('not ready'));"
    + " setTimeout(check, 50); }; check(); })",
  );
  log("fixture ready");
  const tab = await win.webContents.executeJavaScript(`(() => {
    const t = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("波形"));
    if (t) t.click();
    return t ? t.textContent.trim() : null;
  })()`);
  log("waveform tab:", tab);
  for (let batch = 0; batch < 5; batch += 1) {
    const advanced = await win.webContents.executeJavaScript(`(async () => {
      let n = 0;
      for (let i = 0; i < 30; i += 1) {
        for (let a = 0; a < 100 && !window.__visualTickPending(); a += 1) await new Promise((r) => setTimeout(r, 10));
        if (!window.__visualTickPending()) break;
        window.__visualAdvanceTick();
        n += 1;
      }
      return { n, waveformLen: (window.__visualWaveformLength ?? null) };
    })()`);
    log("batch", batch, "advanced:", advanced.n);
  }
  await new Promise((r) => setTimeout(r, 300));
  const facts = await win.webContents.executeJavaScript(`(() => {
    const grid = document.querySelector(".waveform-grid");
    const content = document.querySelector(".bottom-content--waveform");
    const overflowChain = [];
    let el = grid;
    while (el && el !== document.body) {
      const cs = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
        overflowChain.push({ cls: (el.className?.toString() || el.tagName).slice(0, 50), scrollW: el.scrollWidth, clientW: el.clientWidth, scrollH: el.scrollHeight, clientH: el.clientHeight, overflowX: cs.overflowX });
      }
      el = el.parentElement;
    }
    return {
      steps: document.querySelector(".waveform-axis")?.children.length ?? 0,
      grid: grid ? { scrollW: grid.scrollWidth, clientW: grid.clientWidth, overflowX: getComputedStyle(grid).overflowX } : null,
      content: content ? { scrollW: content.scrollWidth, clientW: content.clientWidth } : null,
      overflowChain,
    };
  })()`);
  log("facts:", JSON.stringify(facts));
} catch (error) {
  log("FAILED:", error?.message ?? error);
}
app.exit(0);
