const { app, BrowserWindow, Menu, dialog, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { EngineClientPool, DEFAULT_DOCUMENT_KEY, requireDocumentKey } = require("./engine-client-pool.cjs");
const { requirePositiveId, requireNonEmptyString, requireSaveDialogOptions } = require("./request-validation.cjs");
const { writeTextFileAtomically, readTextFile } = require("./project-file-io.cjs");

const engineFileName = process.platform === "win32" ? "circuit-engine.exe" : "circuit-engine";

function getEnginePath() {
  // 允许测试或打包环境通过环境变量替换引擎位置。
  return process.env.CIRCUIT_ENGINE_PATH || path.resolve(__dirname, "../../../engine/build", engineFileName);
}

const engineClients = new EngineClientPool(getEnginePath());

// 健康检查复用正式长连接，确保检查成功后下一次业务请求不会重新启动进程。
// 它同时是进程死亡后的唯一恢复入口：restart() 清除死亡记录后，下一次请求才会重新拉起进程；
// 业务请求在死亡记录清除前一律失败，不会悄悄换一个空电路的新进程。
async function checkEngineHealth(documentKey) {
  return engineClients.checkHealth(documentKey);
}

// 只把协议业务操作转发给指定文档的 EngineClient；领域规则仍由 C++ 引擎负责。
function requestEngine(documentKey, message) {
  return engineClients.request(requireDocumentKey(documentKey), message);
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

  if (process.env.CIRCUIT_PLATFORM_E2E_URL) {
    // 专用真实 E2E 页面仍使用本文件注册的 IPC handler 与 preload，只替换渲染入口。
    window.loadURL(process.env.CIRCUIT_PLATFORM_E2E_URL);
  } else if (app.isPackaged || process.env.CIRCUIT_PLATFORM_PRODUCTION === "1") {
    window.loadFile(path.resolve(__dirname, "../dist/index.html"));
  } else {
    window.loadURL("http://127.0.0.1:5173");
  }
}

app.whenReady().then(() => {
  ipcMain.handle("engine:health", (_event, documentKey) => checkEngineHealth(documentKey));
  ipcMain.handle("engine:add-component", (_event, documentKey, kind, ports) =>
    requestEngine(documentKey, { type: "add_component", kind, ports }));
  ipcMain.handle("engine:add-connection", (_event, documentKey, source, target) =>
    requestEngine(documentKey, {
      type: "add_connection",
      sourceComponentId: source.componentId,
      sourcePort: source.port,
      targetComponentId: target.componentId,
      targetPort: target.port,
    }));
  ipcMain.handle("engine:remove-component", (_event, documentKey, componentId) =>
    requestEngine(documentKey, {
      type: "remove_component",
      componentId: requirePositiveId(componentId, "componentId"),
    }));
  ipcMain.handle("engine:remove-connection", (_event, documentKey, connectionId) =>
    requestEngine(documentKey, {
      type: "remove_connection",
      connectionId: requirePositiveId(connectionId, "connectionId"),
    }));
  ipcMain.handle("engine:set-input", (_event, documentKey, componentId, value) =>
    requestEngine(documentKey, { type: "set_input", componentId, value }));
  ipcMain.handle("engine:settle", (_event, documentKey) => requestEngine(documentKey, { type: "settle" }));
  // 推进是无参请求，与 settle 一样不需要走 requirePositiveId。
  ipcMain.handle("engine:tick", (_event, documentKey) => requestEngine(documentKey, { type: "tick" }));
  ipcMain.handle("engine:reset", (_event, documentKey) => requestEngine(documentKey, { type: "reset" }));
  ipcMain.handle("engine:get-signal", (_event, documentKey, componentId, port) =>
    requestEngine(documentKey, { type: "get_signal", componentId, port }));
  ipcMain.handle("engine:set-port-width", (_event, documentKey, componentId, ports) =>
    requestEngine(documentKey, {
      type: "set_port_width",
      componentId: requirePositiveId(componentId, "componentId"),
      ports,
    }));
  ipcMain.handle("engine:close-document", (_event, documentKey) => {
    engineClients.closeDocument(documentKey);
    return { ok: true };
  });
  if (process.env.CIRCUIT_PLATFORM_E2E === "1") {
    ipcMain.handle("engine:e2e-kill", (_event, documentKey) => {
      const client = engineClients.clientFor(requireDocumentKey(documentKey));
      const processHandle = client.engine;
      return { ok: processHandle !== null && processHandle.kill() };
    });
  }
  // 项目文件通道只做对话框与 IO：序列化与校验在渲染层，校验规则只有一份实现（规格 #34）。
  // 参数校验失败按既有通道惯例抛 TypeError；文件系统失败进结果对象，让渲染层拿到可展示原因。
  ipcMain.handle("project:pick-save-path", async (event, options) => {
    const dialogOptions = requireSaveDialogOptions(options);
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: "保存项目文件",
      defaultPath: dialogOptions.defaultPath,
      filters: [{ name: "CircuitPlatform 项目", extensions: ["circuit.json"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, reason: "canceled" };
    return { ok: true, path: result.filePath };
  });
  ipcMain.handle("project:write-file", (_event, filePath, content) => {
    try {
      requireNonEmptyString(filePath, "filePath");
      requireNonEmptyString(content, "content");
      writeTextFileAtomically(fs, filePath, content);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "写入项目文件失败。" };
    }
  });
  // 打开通道与保存通道同一个分工：对话框与读文件在这里，解析与校验全在渲染层。
  ipcMain.handle("project:pick-open-path", async (event) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: "打开项目文件",
      filters: [{ name: "CircuitPlatform 项目", extensions: ["circuit.json"] }],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, reason: "canceled" };
    return { ok: true, path: result.filePaths[0] };
  });
  ipcMain.handle("project:read-file", (_event, filePath) => {
    try {
      requireNonEmptyString(filePath, "filePath");
      return { ok: true, content: readTextFile(fs, filePath) };
    } catch (error) {
      // 错误对象上的 code（读文件失败带的 PROJECT_FILE_NOT_FOUND 等）随结果带回，让渲染层
      // 按机器可读类别分支而不必解析展示文案；没有 code 的失败保持原形状。
      const code = typeof (error && error.code) === "string" ? error.code : undefined;
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "读取项目文件失败。",
        ...(code !== undefined ? { code } : {}),
      };
    }
  });
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => engineClients.closeAll());

module.exports = {
  DEFAULT_DOCUMENT_KEY,
  checkEngineHealth,
  requestEngine,
};
