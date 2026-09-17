const { app, BrowserWindow } = require("electron");

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, "").split("=");
  return [key, value.join("=")];
}));
const duration = Number(args.duration || 5000);
const mode = args.mode || "pan";

// 每种交互的驱动方式：pointerdown 落在哪个元素、用哪个按键、是否需要按住。
// pointermove 一律派发到画布，事件冒泡到 Canvas 的 pointermove 处理器，与真实指针一致。
const MODES = {
  pan: { selector: ".circuit-canvas", button: 1, holds: true },
  drag: { selector: ".circuit-node", button: 0, holds: true },
  place: { selector: ".circuit-canvas", button: 0, holds: false },
  wire: { selector: ".node-port--right", button: 0, holds: true },
  route: { selector: ".route-waypoint-handle", button: 0, holds: true },
};
const config = MODES[mode];
if (!config) throw new Error(`未知的基准模式：${mode}`);

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
      const config = ${JSON.stringify(config)};
      const canvas = document.querySelector('.circuit-canvas');
      const origin = document.querySelector(config.selector);
      if (!canvas || !origin) throw new Error('基准缺少交互目标元素：' + config.selector);
      const rect = origin.getBoundingClientRect();
      const startX = rect.left + Math.min(8, rect.width / 2);
      const startY = rect.top + Math.min(8, rect.height / 2);
      const pointerId = 71;
      const pointer = (type, x, y) => new PointerEvent(type, { bubbles: true, cancelable: true, button: config.button, buttons: config.holds ? 1 : 0, pointerId, clientX: x, clientY: y });

      if (config.holds) origin.dispatchEvent(pointer('pointerdown', startX, startY));
      const initial = window.__benchmarkState();

      // 每个动画帧只推进一步交互，并把「更新状态 → Vue 渲染完成」计为该帧耗时，
      // 因此样本覆盖投影器几何重算与 DOM patch，而不只是事件处理器本身。
      const samples = [];
      const startedAt = performance.now();
      let tick = 0;
      await new Promise((resolve) => {
        const step = async () => {
          if (performance.now() - startedAt >= ${duration}) return resolve();
          const frameStarted = performance.now();
          const x = startX + (tick % 240);
          const y = startY + (tick % 240);
          canvas.dispatchEvent(pointer('pointermove', x, y));
          await window.__flush();
          samples.push(performance.now() - frameStarted);
          tick += 3;
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      // 必须在 pointerup 之前取终态：释放会清掉拖动与草稿状态。
      const final = window.__benchmarkState();
      if (config.holds) canvas.dispatchEvent(pointer('pointerup', startX, startY));

      const sorted = samples.slice().sort((a, b) => a - b);
      const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)] || 0;
      return { frames: samples.length, p95FrameMs: Number(p95.toFixed(3)), maxFrameMs: Number(Math.max(0, ...samples).toFixed(3)), initial, final };
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
