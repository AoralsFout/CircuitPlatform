import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 等待真实 DOM 满足条件；超时直接报告用户操作未出现的结果。 */
async function waitForDOM(window, expression, message, timeoutMs = 5_000) {
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (${expression}) return resolve();
      if (Date.now() - started > ${timeoutMs}) return reject(new Error(${JSON.stringify(message)} + ': ' + JSON.stringify({
        activeElement: document.activeElement?.outerHTML,
        alerts: [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent),
      })));
      setTimeout(poll, 20);
    };
    poll();
  })`);
}

/** 通过 Electron 鼠标输入点击页面坐标，保留生产命中测试和原生按钮行为。 */
function clickAt(window, point, modifiers = []) {
  window.webContents.sendInputEvent({ type: "mouseMove", ...point, modifiers });
  window.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1, modifiers });
  window.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1, modifiers });
}

/** 从元件库点击进入放置，核对移动预览、提交落点和单次新增，不直接改工作区状态。 */
async function verifySidebarPlacement(window) {
  window.show();
  window.focus();
  window.webContents.focus();
  await window.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const railPoint = await window.webContents.executeJavaScript(`(() => {
    const rect = document.querySelector('.rail-button[aria-label="元件库"]').getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  if (!await window.webContents.executeJavaScript("Boolean(document.querySelector('.sidebar[aria-label=\"元件库\"]'))")) {
    clickAt(window, railPoint);
    await waitForDOM(window, "document.querySelector('.sidebar[aria-label=\"元件库\"]')", "元件库未打开");
  }
  const componentPoint = await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('.component-item')].find(node => node.querySelector('small')?.textContent.trim() === 'NOT');
    if (!button) throw new Error('元件库缺少 NOT');
    button.scrollIntoView({ block: 'nearest' });
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest('.component-item');
    if (hit !== button) throw new Error('NOT 按钮点击位置被其他元素遮挡');
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  const initialCount = await window.webContents.executeJavaScript("document.querySelectorAll('.circuit-node:not(.circuit-node--pending)').length");
  clickAt(window, componentPoint);
  await waitForDOM(window, "document.querySelector('.circuit-node--pending')", "点击元件库后未出现放置预览");
  const target = await window.webContents.executeJavaScript(`(() => {
    const canvas = document.querySelector('.circuit-canvas').getBoundingClientRect();
    const ghost = document.querySelector('.circuit-node--pending').getBoundingClientRect();
    if (ghost.right <= canvas.left || ghost.left >= canvas.right || ghost.bottom <= canvas.top || ghost.top >= canvas.bottom) {
      throw new Error('初始放置预览不在可见画布内');
    }
    return { x: Math.round(canvas.right - 100), y: Math.round(canvas.bottom - 90) };
  })()`);
  window.webContents.sendInputEvent({ type: "mouseMove", ...target, modifiers: ["alt"] });
  await waitForDOM(window, `(() => {
    const rect = document.querySelector('.circuit-node--pending')?.getBoundingClientRect();
    return rect && Math.abs(rect.left + rect.width / 2 - ${target.x}) <= 1 && Math.abs(rect.top + rect.height / 2 - ${target.y}) <= 1;
  })()`, "放置预览未跟随真实画布指针");
  clickAt(window, target, ["alt"]);
  await waitForDOM(window, `!document.querySelector('.circuit-node--pending') && document.querySelectorAll('.circuit-node:not(.circuit-node--pending)').length === ${initialCount + 1}`, "画布单击未完成一次元件放置");
  const placed = await window.webContents.executeJavaScript(`(() => {
    const nodes = [...document.querySelectorAll('.circuit-node[aria-label="选择NOT 元件"]')];
    const rect = nodes.at(-1)?.getBoundingClientRect();
    return { count: nodes.length, center: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null };
  })()`);
  assert.equal(placed.count, 1, "点击放置应新增一个 NOT 元件");
  assert.ok(placed.center && Math.abs(placed.center.x - target.x) <= 1 && Math.abs(placed.center.y - target.y) <= 1,
    `实际放置位置应与指针和预览一致：${JSON.stringify({ target, placed })}`);
  console.log("Sidebar click placement regression passed", { initialCount, target, placed });
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
  app.disableHardwareAcceleration();
  const port = 49152;
  const vite = await createServer({ root: desktopRoot, server: { host: "127.0.0.1", port, strictPort: true, hmr: false } });
  try {
    await vite.listen();
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(`${baseUrl}/visual-regression.html`);
    app.commandLine.appendSwitch("disable-gpu");
    app.commandLine.appendSwitch("no-sandbox");
    await app.whenReady();
    const window = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: { sandbox: true, backgroundThrottling: false } });
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
        hasSelectedWire: Boolean(document.querySelector('.signal-wire-outline')),
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
        hasSelectedWireAfterClear: Boolean(document.querySelector('.signal-wire-outline')),
      };
    })()`);
    if (!result.selectedBeforeClear.hasFocusedClass || !result.selectedBeforeClear.hasSelectedWire || !result.hasHitClass || result.hasFocusedClassAfterClear || result.hasSelectedWireAfterClear) {
      throw new Error(`空白点击未清除 Wire 状态：${JSON.stringify(result)}`);
    }
    console.log("Canvas selection regression passed", result);
    await window.loadURL(`${baseUrl}/visual-regression.html?state=default&theme=dark&motion=reduced`);
    await waitForDOM(window, "window.__visualReady && document.querySelector('.circuit-node')", "点击放置夹具未就绪", 20_000);
    await verifySidebarPlacement(window);
  } finally {
    await vite.close();
    if (app.isReady()) app.quit();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
