import { app, BrowserWindow } from "electron";
import { createServer } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
  const port = 49152;
  const vite = await createServer({ root: desktopRoot, server: { host: "127.0.0.1", port, strictPort: true } });
  try {
    await vite.listen();
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(`${baseUrl}/visual-regression.html`);
    app.commandLine.appendSwitch("disable-gpu");
    app.commandLine.appendSwitch("no-sandbox");
    await app.whenReady();
    const window = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: { sandbox: true } });
    await window.loadURL(`${baseUrl}/visual-regression.html?state=default&theme=dark&motion=reduced`);
    await window.webContents.executeJavaScript("new Promise((resolve, reject) => { const started = Date.now(); const check = () => document.querySelector('.signal-wire-hit') ? resolve(true) : Date.now() - started > 20000 ? reject(new Error('真实 Vue 画布挂载超时')) : setTimeout(check, 50); check(); })");
    const result = await window.webContents.executeJavaScript(`(async () => {
      const wireHit = document.querySelector('.signal-wire-hit');
      const canvas = document.querySelector('.circuit-canvas');
      if (!wireHit || !canvas) throw new Error('未找到 Wire 或画布');
      wireHit.focus();
      wireHit.dispatchEvent(new FocusEvent('focus'));
      wireHit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      await new Promise((resolve) => setTimeout(resolve, 80));
      const selectedBeforeClear = {
        hasFocusedClass: wireHit.classList.contains('signal-wire-hit--focused'),
        hasSelectedWire: Boolean(document.querySelector('.signal-wire--selected')),
        activeElement: document.activeElement?.className?.baseVal ?? document.activeElement?.className ?? document.activeElement?.tagName,
      };
      const bounds = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        clientX: bounds.left + 12,
        clientY: bounds.top + 12,
      }));
      await new Promise((resolve) => setTimeout(resolve, 80));
      return {
        selectedBeforeClear,
        hasHitClass: wireHit.classList.contains('signal-wire-hit'),
        hasFocusedClassAfterClear: wireHit.classList.contains('signal-wire-hit--focused'),
        hasSelectedWireAfterClear: Boolean(document.querySelector('.signal-wire--selected')),
      };
    })()`);
    if (!result.selectedBeforeClear.hasFocusedClass || !result.selectedBeforeClear.hasSelectedWire || !result.hasHitClass || result.hasFocusedClassAfterClear || result.hasSelectedWireAfterClear) {
      throw new Error(`空白点击未清除 Wire 状态：${JSON.stringify(result)}`);
    }
    console.log("Canvas selection regression passed", result);
  } finally {
    await vite.close();
    if (app.isReady()) app.quit();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
