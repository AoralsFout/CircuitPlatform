const { app, BrowserWindow, Menu, ipcMain } = require("electron");
const path = require("node:path");
const { EngineClient } = require("./engine-client.cjs");
const { requirePositiveId } = require("./request-validation.cjs");

const engineFileName = process.platform === "win32" ? "circuit-engine.exe" : "circuit-engine";

function getEnginePath() {
  // 允许测试或打包环境通过环境变量替换引擎位置。
  return process.env.CIRCUIT_ENGINE_PATH || path.resolve(__dirname, "../../../engine/build", engineFileName);
}

const engineClient = new EngineClient(getEnginePath());

// 健康检查复用正式长连接，确保检查成功后下一次业务请求不会重新启动进程。
async function checkEngineHealth() {
  try {
    const response = await engineClient.request({ type: "health_check" });
    if (response.type === "health_check_result") return response;
    return { status: "error", message: response.message || "C++ 引擎返回了错误" };
  } catch (error) {
    return {
      status: error?.code === "ENOENT" ? "unavailable" : "error",
      message: error?.code === "ENOENT"
        ? "尚未找到 C++ 引擎，请先执行 pnpm build:engine"
        : error instanceof Error ? error.message : "无法连接到 C++ 引擎",
    };
  }
}

// 只把协议业务操作转发给 EngineClient；领域规则仍由 C++ 引擎负责。
function requestEngine(message) {
  return engineClient.request(message);
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

  // 画布自己处理 Ctrl/Cmd + 0/=/−（视图缩放）、Alt + 方向键（移动聚焦元件）与 F5/F6/F7（运行控制）。
  // Electron 的默认菜单会用同一组加速键缩放整个页面与重新加载，而且 Windows 上裸按 Alt 会先聚焦菜单栏，
  // 后者即使 autoHideMenuBar 也挡不住。移除菜单是唯一可靠的做法；DevTools 用 before-input-event 补回。
  // 菜单一旦移除，默认加速键（含 F5 重新加载）就不再存在，运行控制键因此直达渲染进程，这里不需要再拦。
  Menu.setApplicationMenu(null);
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.control && input.shift && input.key.toLowerCase() === "i") {
      window.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  if (app.isPackaged || process.env.CIRCUIT_PLATFORM_PRODUCTION === "1") {
    window.loadFile(path.resolve(__dirname, "../dist/index.html"));
  } else {
    window.loadURL("http://127.0.0.1:5173");
  }
}

app.whenReady().then(() => {
  ipcMain.handle("engine:health", checkEngineHealth);
  ipcMain.handle("engine:add-component", (_event, kind, ports) =>
    requestEngine({ type: "add_component", kind, ports }));
  ipcMain.handle("engine:add-connection", (_event, source, target) =>
    requestEngine({
      type: "add_connection",
      sourceComponentId: source.componentId,
      sourcePort: source.port,
      targetComponentId: target.componentId,
      targetPort: target.port,
    }));
  ipcMain.handle("engine:remove-component", (_event, componentId) =>
    requestEngine({
      type: "remove_component",
      componentId: requirePositiveId(componentId, "componentId"),
    }));
  ipcMain.handle("engine:remove-connection", (_event, connectionId) =>
    requestEngine({
      type: "remove_connection",
      connectionId: requirePositiveId(connectionId, "connectionId"),
    }));
  ipcMain.handle("engine:set-input", (_event, componentId, value) =>
    requestEngine({ type: "set_input", componentId, value }));
  ipcMain.handle("engine:settle", () => requestEngine({ type: "settle" }));
  // 推进是无参请求，与 settle 一样不需要走 requirePositiveId。
  ipcMain.handle("engine:tick", () => requestEngine({ type: "tick" }));
  ipcMain.handle("engine:reset", () => requestEngine({ type: "reset" }));
  ipcMain.handle("engine:get-signal", (_event, componentId, port) =>
    requestEngine({ type: "get_signal", componentId, port }));
  ipcMain.handle("engine:set-port-width", (_event, componentId, ports) =>
    requestEngine({
      type: "set_port_width",
      componentId: requirePositiveId(componentId, "componentId"),
      ports,
    }));
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => engineClient.close());
