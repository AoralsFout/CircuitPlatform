import { app, BrowserWindow } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(desktopRoot, "artifacts", "visual-regression");
const states = ["default", "empty", "selected-node", "selected-wire", "draft", "dangling", "pending", "error"];
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
  // Fixture is static HTML/CSS; avoiding the Vue config keeps this check independent of the application build.
  const vite = await createServer({ configFile: false, root: desktopRoot, server: { host: "127.0.0.1", port, strictPort: true } });
  try {
    await vite.listen();
    await waitForServer(`http://127.0.0.1:${port}/visual-regression.html`);
    await mkdir(outputRoot, { recursive: true });
    app.commandLine.appendSwitch("force-device-scale-factor", "1");
    app.commandLine.appendSwitch("disable-gpu");
    app.commandLine.appendSwitch("no-sandbox");
    await app.whenReady();
    const window = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: { sandbox: true } });
    const manifest = [];
    for (const theme of options.themes) {
      for (const [viewportName, viewport] of Object.entries(viewports)) {
        for (const state of options.states) {
          window.setSize(viewport.width, viewport.height);
          const motion = options.reducedMotion ? "&motion=reduced" : "";
          await window.loadURL(`http://127.0.0.1:${port}/visual-regression.html?theme=${theme}&state=${state}${motion}`);
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 80));
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
