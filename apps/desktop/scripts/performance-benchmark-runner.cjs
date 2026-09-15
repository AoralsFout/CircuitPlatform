const { app, BrowserWindow } = require("electron");

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, "").split("=");
  return [key, value.join("=")];
}));
const duration = Number(args.duration || 5000);
const mode = args.mode || "pan";
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("force-device-scale-factor", "1");

app.whenReady().then(async () => {
  // 显示窗口避免 Windows 对隐藏页面节流 RAF；窗口仍不抢焦点，兼容无 GPU 环境。
  const window = new BrowserWindow({ show: true, width: 1920, height: 1080, webPreferences: { sandbox: true, backgroundThrottling: false } });
  try {
    await window.loadURL(args.url);
    await window.webContents.executeJavaScript("new Promise(resolve => { const check = () => window.__benchmarkReady ? resolve(true) : setTimeout(check, 20); check(); })");
    const result = await window.webContents.executeJavaScript(`(async () => {
      const samples = [];
      const originalRAF = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) => originalRAF((time) => {
        const started = performance.now();
        callback(time);
        samples.push(performance.now() - started);
      });
      const canvas = document.querySelector('.circuit-canvas');
      const node = document.querySelector('.circuit-node');
      const target = ${mode === "drag" ? "node" : "canvas"};
      const rect = target.getBoundingClientRect();
      const pointerId = 71;
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: ${mode === "drag" ? 0 : 1}, pointerId, clientX: rect.left + 40, clientY: rect.top + 40 }));
      const started = performance.now();
      let tick = 0;
      while (performance.now() - started < ${duration}) {
        target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: ${mode === "drag" ? 0 : 1}, pointerId, clientX: rect.left + 40 + tick, clientY: rect.top + 40 + tick }));
        tick = (tick + 3) % 240;
        await new Promise(resolve => setTimeout(resolve, 16));
      }
      target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: ${mode === "drag" ? 0 : 1}, pointerId, clientX: rect.left + 40, clientY: rect.top + 40 }));
      await new Promise(resolve => setTimeout(resolve, 100));
      const sorted = samples.slice().sort((a, b) => a - b);
      const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)] || 0;
      return { frames: samples.length, p95FrameMs: Number(p95.toFixed(3)), maxFrameMs: Number(Math.max(0, ...samples).toFixed(3)) };
    })()`);
    process.stdout.write(`BENCHMARK_RESULT ${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  } finally {
    window.destroy();
    app.quit();
  }
});
