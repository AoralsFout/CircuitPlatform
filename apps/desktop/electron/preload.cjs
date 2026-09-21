const { contextBridge, ipcRenderer } = require("electron");

const DEFAULT_DOCUMENT_KEY = "default";

function requireDocumentKey(documentKey) {
  if (typeof documentKey !== "string" || documentKey.trim() === "") {
    throw new TypeError("documentKey 必须是非空字符串");
  }
  return documentKey;
}

/**
 * 为一份文档创建最小引擎桥接。
 * 文档键只存在于 Electron IPC 边界，不写入 JSON Lines 业务消息，因此 C++ 协议保持不变。
 */
function createDocumentEngineBridge(documentKey) {
  const key = requireDocumentKey(documentKey);
  return {
    checkEngine: () => ipcRenderer.invoke("engine:health", key),
    addComponent: (kind, ports) => ipcRenderer.invoke("engine:add-component", key, kind, ports),
    addConnection: (source, target) => ipcRenderer.invoke("engine:add-connection", key, source, target),
    removeComponent: (componentId) => ipcRenderer.invoke("engine:remove-component", key, componentId),
    removeConnection: (connectionId) => ipcRenderer.invoke("engine:remove-connection", key, connectionId),
    setInput: (componentId, value) => ipcRenderer.invoke("engine:set-input", key, componentId, value),
    settle: () => ipcRenderer.invoke("engine:settle", key),
    tick: () => ipcRenderer.invoke("engine:tick", key),
    reset: () => ipcRenderer.invoke("engine:reset", key),
    getSignal: (componentId, port) => ipcRenderer.invoke("engine:get-signal", key, componentId, port),
    setPortWidth: (componentId, ports) => ipcRenderer.invoke("engine:set-port-width", key, componentId, ports),
    closeDocument: () => ipcRenderer.invoke("engine:close-document", key),
  };
}

const defaultEngineBridge = createDocumentEngineBridge(DEFAULT_DOCUMENT_KEY);

contextBridge.exposeInMainWorld("circuitPlatform", {
  // 只暴露业务级方法，避免把 Node/Electron 权限直接开放给渲染进程。
  ...defaultEngineBridge,
  /** 为多文档协调器创建带显式文档键的同形桥接。 */
  forDocument: (documentKey) => createDocumentEngineBridge(documentKey),
  // 项目文件通道：保存对话框与原子写文件；序列化与校验留在渲染进程。
  pickSavePath: (options) => ipcRenderer.invoke("project:pick-save-path", options),
  writeProjectFile: (filePath, content) => ipcRenderer.invoke("project:write-file", filePath, content),
  // 打开通道：打开对话框与读文件；解析与校验同样留在渲染进程。
  pickOpenPath: () => ipcRenderer.invoke("project:pick-open-path"),
  readProjectFile: (filePath) => ipcRenderer.invoke("project:read-file", filePath),
});
