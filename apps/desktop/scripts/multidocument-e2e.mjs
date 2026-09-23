import { app, BrowserWindow, dialog } from "electron";
import { createServer } from "vite";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const engineName = process.platform === "win32" ? "circuit-engine.exe" : "circuit-engine";
const enginePath = process.env.CIRCUIT_ENGINE_PATH ?? resolve(desktopRoot, "../../engine/build", engineName);

// Electron must receive these switches before the Vite startup await can make app ready.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("no-sandbox");

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

async function waitForWindow(timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (BrowserWindow.getAllWindows().length === 0) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("production Electron window did not start");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  return BrowserWindow.getAllWindows()[0];
}

async function main() {
  if (!existsSync(enginePath)) {
    console.log(`SKIP multidocument E2E: C++ engine not found at ${enginePath}`);
    return;
  }

  const fixtureDirectory = await mkdtemp(join(tmpdir(), "circuitplatform-multidocument-e2e-"));
  const relocatedDirectory = join(fixtureDirectory, "relocated");
  await mkdir(relocatedDirectory);
  const vite = await createServer({ root: desktopRoot, server: { host: "127.0.0.1", port: 0, hmr: false } });
  const originalSaveDialog = dialog.showSaveDialog;
  let window;
  let failure = null;
  try {
    await vite.listen();
    const address = vite.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Vite 未提供监听端口");
    const harnessUrl = `http://127.0.0.1:${address.port}/tests/multidocument-e2e-harness.html?directory=${encodeURIComponent(fixtureDirectory)}`;
    process.env.CIRCUIT_ENGINE_PATH = enginePath;
    process.env.CIRCUIT_PLATFORM_E2E = "1";
    process.env.CIRCUIT_PLATFORM_E2E_URL = harnessUrl;
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: join(relocatedDirectory, "parent.circuit.json") });
    // main.cjs owns the real EngineClientPool and production IPC handlers. The only test seam is
    // the URL override above, so the harness still crosses BrowserWindow → preload → IPC → JSON Lines.
    await import("../electron/main.cjs");
    await app.whenReady();
    window = await waitForWindow();
    window.hide();
    window.webContents.on("console-message", (_event, level, message) => console.error(`[multidocument console ${level}] ${message}`));
    window.webContents.on("render-process-gone", (_event, details) => console.error("Multidocument renderer exited", details));
    await window.webContents.executeJavaScript("new Promise((resolve, reject) => { const started = Date.now(); const check = () => { if (window.__multidocumentResult) return resolve(true); if (Date.now() - started > 20000) return reject(new Error('多文档真实 harness 未完成挂载')); setTimeout(check, 25); }; check(); })");
    console.log("Multidocument harness mounted");
    const resultPromise = window.webContents.executeJavaScript("window.__multidocumentResult");
    let settled = false;
    void resultPromise.then(() => { settled = true; }, () => { settled = true; });
    while (!settled) {
      if (await window.webContents.executeJavaScript("window.__multidocumentDeleteSource === true")) {
        await rm(join(fixtureDirectory, "child.circuit.json"));
        await window.webContents.executeJavaScript("window.__multidocumentDeleteSource = false; window.__multidocumentSourceDeleted = true");
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
    }
    const result = await resultPromise;
    console.log("Multidocument production E2E passed", JSON.stringify(result));
  } catch (error) {
    failure = error;
    console.error("Multidocument production E2E failed", error);
  } finally {
    dialog.showSaveDialog = originalSaveDialog;
    app.removeAllListeners("window-all-closed");
    if (window && !window.isDestroyed()) window.close();
    await vite.close();
    await rm(fixtureDirectory, { recursive: true, force: true });
    if (app.isReady()) app.exit(failure ? 1 : 0);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
