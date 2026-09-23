import { app, BrowserWindow, dialog } from "electron";
import { createServer } from "vite";
import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const engineName = process.platform === "win32" ? "circuit-engine.exe" : "circuit-engine";
const enginePath = process.env.CIRCUIT_ENGINE_PATH ?? resolve(desktopRoot, "../../engine/build", engineName);

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("no-sandbox");

async function waitForWindow() {
  const started = Date.now();
  while (BrowserWindow.getAllWindows().length === 0) {
    if (Date.now() - started > 15_000) throw new Error("真实 Electron 窗口未启动");
    await new Promise((done) => setTimeout(done, 25));
  }
  return BrowserWindow.getAllWindows()[0];
}

async function inPage(window, script) {
  return window.webContents.executeJavaScript(script);
}

async function waitFor(window, selector) {
  await inPage(window, `new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (document.querySelector(${JSON.stringify(selector)})) return resolve();
      if (Date.now() - started > 15000) return reject(new Error('未找到页面元素：${selector}'));
      setTimeout(poll, 25);
    };
    poll();
  })`);
}

async function main() {
  if (!existsSync(enginePath)) throw new Error(`缺少真实 C++ 引擎：${enginePath}`);
  const directory = await mkdtemp(join(tmpdir(), "circuitplatform-definition-nav-"));
  app.setPath("userData", directory);
  const parentPath = join(directory, "parent.circuit.json");
  const ports = [{ name: "A", direction: "input", width: 1 }, { name: "Y", direction: "output", width: 1 }];
  const parent = {
    version: 2,
    circuit: {
      components: [{ id: "instance", kind: "subcircuit", displayName: "child.circuit.json", position: { x: 0, y: 0 }, data: { definitionId: "child", cachedPorts: ports } }],
      connections: [],
    },
    definitions: {
      child: { displayName: "child.circuit.json", circuit: {
        components: [
          { id: "in", kind: "input", displayName: "A", position: { x: 0, y: 0 }, ports: [{ name: "out", direction: "output", width: 1 }] },
          { id: "gate", kind: "not", displayName: "NOT", position: { x: 120, y: 0 } },
          { id: "out", kind: "output", displayName: "Y", position: { x: 240, y: 0 }, ports: [{ name: "in", direction: "input", width: 1 }] },
        ],
        connections: [
          { id: "w1", source: { component: "in", port: "out" }, target: { component: "gate", port: "in" } },
          { id: "w2", source: { component: "gate", port: "out" }, target: { component: "out", port: "in" } },
        ],
      } },
    },
    libraryRoots: ["child"],
  };
  writeFileSync(parentPath, `${JSON.stringify(parent)}\n`, "utf8");
  const vite = await createServer({ root: desktopRoot, server: { host: "127.0.0.1", port: 49155, strictPort: true, hmr: false } });
  let window;
  const originalDialog = dialog.showOpenDialog;
  try {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [parentPath] });
    await vite.listen();
    process.env.CIRCUIT_ENGINE_PATH = enginePath;
    process.env.CIRCUIT_PLATFORM_E2E_URL = "http://127.0.0.1:49155/index.html";
    await import("../electron/main.cjs");
    await app.whenReady();
    window = await waitForWindow();
    window.hide();
    await waitFor(window, ".topbar");
    await inPage(window, `document.querySelector('.empty-state__actions button')?.click()`);
    await waitFor(window, ".circuit-node[data-subcircuit-status=resolved]");
    await inPage(window, `document.querySelector('button[aria-label="子电路"]')?.click()`);
    await waitFor(window, ".subcircuit-tree-node");
    await inPage(window, `document.querySelector('.subcircuit-tree-node')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    await waitFor(window, ".embedded-definition-view__canvas");
    const treeView = await inPage(window, `({
      title: document.querySelector('.embedded-definition-view__header strong')?.textContent,
      nodes: document.querySelectorAll('.embedded-definition-view__canvas rect').length,
      wires: document.querySelectorAll('.embedded-definition-view__canvas polyline').length,
      editableToolbar: Boolean(document.querySelector('.editor-toolbar')),
      tabCount: document.querySelectorAll('[role=tab]').length,
    })`);
    if (treeView.title !== "child.circuit.json" || treeView.nodes !== 3 || treeView.wires !== 2 || treeView.editableToolbar || treeView.tabCount !== 2) {
      throw new Error(`树导航或只读内容错误：${JSON.stringify(treeView)}`);
    }
    await inPage(window, `Array.from(document.querySelectorAll('button')).find(button => button.textContent === '返回父电路')?.click()`);
    await waitFor(window, ".circuit-node[data-subcircuit-status=resolved]");
    await inPage(window, `document.querySelector('.circuit-node[data-subcircuit-status=resolved]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    await waitFor(window, ".embedded-definition-view__canvas");
    const canvasView = await inPage(window, `({ tabCount: document.querySelectorAll('[role=tab]').length, readOnly: Boolean(document.querySelector('.embedded-definition-view__badge')) })`);
    if (canvasView.tabCount !== 2 || !canvasView.readOnly) throw new Error(`画布下钻未复用只读标签：${JSON.stringify(canvasView)}`);
    await inPage(window, `Array.from(document.querySelectorAll('button')).find(button => button.textContent === '返回父电路')?.click()`);
    await waitFor(window, ".circuit-node[data-subcircuit-status=resolved]");
    await inPage(window, `(() => { const node = document.querySelector('.circuit-node[data-subcircuit-status=resolved]'); node.focus(); node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await waitFor(window, ".embedded-definition-view__canvas");
    if (await inPage(window, `document.querySelectorAll('[role=tab]').length`) !== 2) throw new Error("画布回车未复用定义标签");
    console.log("Embedded definition navigation Electron E2E passed", JSON.stringify({ treeView, canvasView }));
  } finally {
    dialog.showOpenDialog = originalDialog;
    if (window && !window.isDestroyed()) window.close();
    await vite.close();
    await rm(directory, { recursive: true, force: true });
  }
}

main().then(() => app.quit()).catch((error) => { console.error(error); app.exit(1); });
