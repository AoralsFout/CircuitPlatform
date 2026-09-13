const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");

const engineFileName = process.platform === "win32" ? "circuit-engine.exe" : "circuit-engine";

function getEnginePath() {
  // 允许测试或打包环境通过环境变量替换引擎位置。
  return process.env.CIRCUIT_ENGINE_PATH || path.resolve(__dirname, "../../../engine/build", engineFileName);
}

// 启动一次独立的 C++ 进程，通过 JSON 行消息确认引擎可用。
function checkEngineHealth() {
  return new Promise((resolve) => {
    const engine = spawn(getEnginePath(), [], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let settled = false;

    // 统一结束进程、清理计时器并只兑现一次 Promise。
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
      if (!engine.killed) engine.kill();
    };

    const timeout = setTimeout(() => {
      finish({ status: "error", message: "C++ 引擎响应超时" });
    }, 2000);

    engine.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const lineEnd = output.indexOf("\n");
      if (lineEnd >= 0) {
        const line = output.slice(0, lineEnd).trim();
        try {
          finish(JSON.parse(line));
        } catch {
          finish({ status: "error", message: "C++ 引擎返回了无效消息" });
        }
      }
    });

    engine.on("error", () => {
      finish({ status: "unavailable", message: "尚未找到 C++ 引擎，请先执行 pnpm build:engine" });
    });

    engine.stdin.write('{"type":"health_check","requestId":"desktop-startup"}\n');
  });
}

function createWindow() {
  // 主进程只负责窗口和桥接，页面逻辑通过 preload 暴露的最小接口访问引擎。
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (app.isPackaged || process.env.CIRCUIT_PLATFORM_PRODUCTION === "1") {
    window.loadFile(path.resolve(__dirname, "../dist/index.html"));
  } else {
    window.loadURL("http://127.0.0.1:5173");
  }
}

app.whenReady().then(() => {
  ipcMain.handle("engine:health", checkEngineHealth);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
