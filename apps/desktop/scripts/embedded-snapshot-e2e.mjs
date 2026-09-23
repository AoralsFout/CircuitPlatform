import { app, BrowserWindow, dialog } from "electron";
import { createServer } from "vite";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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

async function waitForWindow(timeoutMs = 15_000) {
  const started = Date.now();
  while (BrowserWindow.getAllWindows().length === 0) {
    if (Date.now() - started > timeoutMs) throw new Error("真实 Electron 窗口未启动");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  return BrowserWindow.getAllWindows()[0];
}

async function waitForHarness(window, timeoutMs = 15_000) {
  await window.webContents.executeJavaScript(`new Promise((resolvePromise, reject) => {
    const started = Date.now();
    const check = () => {
      if (window.__embeddedSnapshotFirst && window.__embeddedSnapshotAfterMove) return resolvePromise();
      if (Date.now() - started > ${timeoutMs}) return reject(new Error("真实 E2E 页面未完成挂载"));
      setTimeout(check, 25);
    };
    check();
  })`);
}

async function main() {
  if (!existsSync(enginePath)) throw new Error(`缺少真实 C++ 引擎：${enginePath}`);
  const directory = await mkdtemp(join(tmpdir(), "circuitplatform-embedded-e2e-"));
  const childPath = join(directory, "child.circuit.json");
  const movedChildPath = join(directory, "moved-child.circuit.json");
  const parentPath = join(directory, "parent.circuit.json");
  const child = {
    version: 2,
    circuit: {
      components: [
        { id: "in-a", kind: "input", displayName: "a", position: { x: 0, y: 0 }, ports: [{ name: "out", direction: "output", width: 1 }] },
        { id: "logic", kind: "not", displayName: "NOT", position: { x: 120, y: 0 } },
        { id: "out-y", kind: "output", displayName: "y", position: { x: 240, y: 0 }, ports: [{ name: "in", direction: "input", width: 1 }] },
      ],
      connections: [
        { id: "child-in", source: { component: "in-a", port: "out" }, target: { component: "logic", port: "in" } },
        { id: "child-out", source: { component: "logic", port: "out" }, target: { component: "out-y", port: "in" } },
      ],
    },
    definitions: {},
    libraryRoots: [],
  };
  writeFileSync(childPath, `${JSON.stringify(child)}\n`, "utf8");
  const vite = await createServer({ root: desktopRoot, server: { host: "127.0.0.1", port: 49154, strictPort: true, hmr: false } });
  let window;
  const originalOpenDialog = dialog.showOpenDialog;
  const originalSaveDialog = dialog.showSaveDialog;
  try {
    // 只替换对话框的用户选择；项目文件读写仍由正式 preload → IPC handler 处理。
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [childPath] });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: parentPath });
    await vite.listen();
    process.env.CIRCUIT_ENGINE_PATH = enginePath;
    process.env.CIRCUIT_PLATFORM_E2E_URL = "http://127.0.0.1:49154/tests/embedded-snapshot-e2e-harness.html";
    await import("../electron/main.cjs");
    await app.whenReady();
    window = await waitForWindow();
    window.hide();
    window.webContents.on("console-message", (_event, level, message) => console.error(`[embedded console ${level}] ${message}`));
    await waitForHarness(window);
    const first = await window.webContents.executeJavaScript("window.__embeddedSnapshotFirst");
    if (!first?.saved) throw new Error("渲染端未保存父工程");
    const saved = JSON.parse(readFileSync(parentPath, "utf8"));
    if (saved.version !== 2 || Object.keys(saved.definitions).length !== 1) throw new Error("父工程未保存 v2 内嵌定义");
    if (JSON.stringify(saved).includes(childPath) || JSON.stringify(saved).includes("reference")) throw new Error("父工程泄漏源路径");
    renameSync(childPath, movedChildPath);
    const final = await window.webContents.executeJavaScript("window.__embeddedSnapshotAfterMove()");
    if (!final?.reopened) throw new Error("删除源文件后未重新打开父工程");
    console.log("Embedded snapshot production Electron E2E passed", JSON.stringify({ ...first, ...final }));
  } finally {
    dialog.showOpenDialog = originalOpenDialog;
    dialog.showSaveDialog = originalSaveDialog;
    if (window && !window.isDestroyed()) window.close();
    await vite.close();
    await rm(directory, { recursive: true, force: true });
    if (app.isReady()) app.quit();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
