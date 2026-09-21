import { app, BrowserWindow } from "electron";
import { createServer } from "vite";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
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
  const port = 49153;
  const vite = await createServer({ root: desktopRoot, server: { host: "127.0.0.1", port, strictPort: true, hmr: false } });
  let window;
  try {
    await vite.listen();
    const harnessUrl = `http://127.0.0.1:${port}/tests/multidocument-e2e-harness.html?directory=${encodeURIComponent(fixtureDirectory)}`;
    process.env.CIRCUIT_ENGINE_PATH = enginePath;
    process.env.CIRCUIT_PLATFORM_E2E = "1";
    process.env.CIRCUIT_PLATFORM_E2E_URL = harnessUrl;
    // main.cjs owns the real EngineClientPool and production IPC handlers. The only test seam is
    // the URL override above, so the harness still crosses BrowserWindow → preload → IPC → JSON Lines.
    await import("../electron/main.cjs");
    await app.whenReady();
    window = await waitForWindow();
    window.hide();
    window.webContents.on("console-message", (_event, level, message) => console.error(`[multidocument console ${level}] ${message}`));
    await window.webContents.executeJavaScript("new Promise((resolve, reject) => { const started = Date.now(); const check = () => { if (window.__multidocumentResult) return resolve(true); if (Date.now() - started > 20000) return reject(new Error('多文档真实 harness 未完成挂载')); setTimeout(check, 25); }; check(); })");
    const result = await window.webContents.executeJavaScript("window.__multidocumentResult");
    console.log("Multidocument production E2E passed", JSON.stringify(result));
  } finally {
    if (window && !window.isDestroyed()) window.close();
    await vite.close();
    await rm(fixtureDirectory, { recursive: true, force: true });
    if (app.isReady()) app.quit();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
