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

async function waitFor(window, expression) {
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (${expression}) return resolve();
      if (Date.now() - started > 15000) return reject(new Error(${JSON.stringify(`等待超时：${expression}`)}));
      setTimeout(poll, 25);
    };
    poll();
  })`);
}

async function main() {
  if (!existsSync(enginePath)) throw new Error(`缺少真实 C++ 引擎：${enginePath}`);
  const directory = await mkdtemp(join(tmpdir(), "circuitplatform-port-repair-"));
  app.setPath("userData", directory);
  const parentPath = join(directory, "parent.circuit.json");
  const sourcePath = join(directory, "new-child.circuit.json");
  const compatiblePath = join(directory, "compatible-child.circuit.json");
  const ports = [{ name: "A", direction: "input", width: 1 }, { name: "Y", direction: "output", width: 1 }];
  const parent = { version: 2, circuit: { components: [
    { id: "driver", kind: "input", displayName: "driver", position: { x: 0, y: 0 }, ports: [{ name: "out", direction: "output", width: 1 }] },
    { id: "instance", kind: "subcircuit", displayName: "deleted", position: { x: 180, y: 0 }, data: { definitionId: "deleted", cachedPorts: ports } },
    { id: "sink", kind: "output", displayName: "sink", position: { x: 360, y: 0 }, ports: [{ name: "in", direction: "input", width: 1 }] },
  ], connections: [
    { id: "wire", source: { component: "driver", port: "out" }, target: { component: "instance", port: "A" } },
    { id: "output-wire", source: { component: "instance", port: "Y" }, target: { component: "sink", port: "in" } },
  ] },
  definitions: {}, libraryRoots: [] };
  const source = { version: 2, circuit: { components: [
    { id: "in", kind: "input", displayName: "Renamed", position: { x: 0, y: 0 }, ports: [{ name: "out", direction: "output", width: 1 }] },
    { id: "out", kind: "output", displayName: "Y", position: { x: 150, y: 0 }, ports: [{ name: "in", direction: "input", width: 1 }] },
  ], connections: [{ id: "internal", source: { component: "in", port: "out" }, target: { component: "out", port: "in" } }] },
  definitions: {}, libraryRoots: [] };
  writeFileSync(parentPath, JSON.stringify(parent), "utf8");
  writeFileSync(sourcePath, JSON.stringify(source), "utf8");
  const compatible = structuredClone(source);
  compatible.circuit.components[0].displayName = "A";
  writeFileSync(compatiblePath, JSON.stringify(compatible), "utf8");
  const vite = await createServer({ root: desktopRoot, server: { host: "127.0.0.1", port: 50476, strictPort: false, hmr: false } });
  const choices = [parentPath, sourcePath, sourcePath, compatiblePath];
  const originalDialog = dialog.showOpenDialog;
  let window;
  let failed = false;
  try {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [choices.shift()] });
    await vite.listen();
    const address = vite.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("无法获取 Vite 测试端口");
    process.env.CIRCUIT_ENGINE_PATH = enginePath;
    process.env.CIRCUIT_PLATFORM_E2E_URL = `http://127.0.0.1:${address.port}/index.html`;
    await import("../electron/main.cjs");
    await app.whenReady();
    window = await waitForWindow();
    window.hide();
    await waitFor(window, `document.querySelector('.empty-state__actions button')`);
    await window.webContents.executeJavaScript(`document.querySelector('.empty-state__actions button')?.click()`);
    await waitFor(window, `document.querySelector('.circuit-node[data-subcircuit-status=unresolved]')`);
    await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="子电路"]').click()`);
    await waitFor(window, `document.querySelector('.subcircuit-repair-list button')`);
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.subcircuit-repair-list button')).find(button => button.textContent.includes('从文件导入并修复')).click()`);
    await waitFor(window, `document.querySelector('.reimport-impact-list')`);
    const impact = await window.webContents.executeJavaScript(`document.querySelector('.reimport-impact-list').textContent`);
    if (!impact.includes("wire") || !impact.includes("A")) throw new Error(`预告未列出受影响连线：${impact}`);
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.confirmation-dialog button')).find(button => button.textContent === '取消').click()`);
    await waitFor(window, `!document.querySelector('.reimport-impact-list')`);
    if (!await window.webContents.executeJavaScript(`Boolean(document.querySelector('.circuit-node[data-subcircuit-status=unresolved]'))`)) throw new Error("取消后缺失使用处变化");
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.subcircuit-repair-list button')).find(button => button.textContent.includes('从文件导入并修复')).click()`);
    await waitFor(window, `document.querySelector('.reimport-impact-list')`);
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.confirmation-dialog button')).find(button => button.textContent === '确认修复').click()`);
    await waitFor(window, `document.querySelector('.circuit-node[data-subcircuit-status=resolved]') && !document.querySelector('.reimport-impact-list')`);
    const result = await window.webContents.executeJavaScript(`({ dangling: document.querySelector('.signal-wire[data-dangling=true]') !== null,
      unresolved: document.querySelector('.circuit-node[data-subcircuit-status=unresolved]') !== null,
      repairList: document.querySelector('.subcircuit-repair-list') !== null })`);
    if (!result.dangling || result.unresolved || result.repairList) throw new Error(`确认后的画布状态错误：${JSON.stringify(result)}`);
    await window.webContents.executeJavaScript(`document.querySelector('.editor-toolbar button[title^="撤销"]')?.click()`);
    await waitFor(window, `document.querySelector('.subcircuit-repair-list button')`);
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.subcircuit-repair-list button')).find(button => button.textContent.includes('从文件导入并修复')).click()`);
    await waitFor(window, `document.querySelector('.circuit-node[data-subcircuit-status=resolved]') && !document.querySelector('.subcircuit-repair-list')`);
    if (await window.webContents.executeJavaScript(`Boolean(document.querySelector('.signal-wire[data-dangling=true]'))`)) throw new Error("兼容修复后仍有悬空连线");
    await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="输入设置"]')?.click()`);
    await waitFor(window, `document.querySelector('.input-bit:not(:disabled)')`);
    await window.webContents.executeJavaScript(`document.querySelector('.input-bit:not(:disabled)')?.click()`);
    await waitFor(window, `document.querySelector('.output-readout b')?.textContent?.trim() === '1'`);
    console.log("Embedded Port repair Electron E2E passed", JSON.stringify({ ...result, compatibleSignal: "1" }));
    await new Promise((done) => setTimeout(done, 250));
  } catch (error) {
    failed = true;
    console.error("Embedded Port repair step failed", error);
    throw error;
  } finally {
    dialog.showOpenDialog = originalDialog;
    if (window && !window.isDestroyed()) window.close();
    await vite.close();
    try { await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
    catch (error) { console.error("临时目录稍后清理：", error); }
    if (failed) app.exit(1);
  }
}

main().then(() => app.quit()).catch((error) => { console.error(error); app.exit(1); });
