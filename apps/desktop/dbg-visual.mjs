import { app, BrowserWindow } from "electron";
import { createServer } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const desktopRoot = "E:/CircuitPlatform/apps/desktop";
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("no-sandbox");
const vite = await createServer({ root: desktopRoot, server: { host: "127.0.0.1", port: 4199, strictPort: true } });
await vite.listen();
await app.whenReady();
const win = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: { sandbox: true } });
await win.loadURL("http://127.0.0.1:4199/visual-regression.html?state=unsaved-confirm&theme=dark");
await new Promise((r) => setTimeout(r, 3000));
const facts = await win.webContents.executeJavaScript(`({
  error: window.__visualError ?? null,
  ready: window.__visualReady ?? false,
  dialog: document.querySelectorAll(".confirmation-dialog").length,
  dialogRole: document.querySelector(".confirmation-dialog")?.getAttribute("role") ?? null,
  bodyText: document.body.innerText.slice(0, 150),
})`);
console.log(JSON.stringify(facts, null, 2));
app.exit(0);
