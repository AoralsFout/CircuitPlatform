const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("circuitPlatform", {
  // 只暴露业务级方法，避免把 Node/Electron 权限直接开放给渲染进程。
  checkEngine: () => ipcRenderer.invoke("engine:health"),
  addComponent: (kind) => ipcRenderer.invoke("engine:add-component", kind),
  addConnection: (source, target) => ipcRenderer.invoke("engine:add-connection", source, target),
  removeComponent: (componentId) => ipcRenderer.invoke("engine:remove-component", componentId),
  removeConnection: (connectionId) => ipcRenderer.invoke("engine:remove-connection", connectionId),
  setInput: (componentId, value) => ipcRenderer.invoke("engine:set-input", componentId, value),
  settle: () => ipcRenderer.invoke("engine:settle"),
  getSignal: (componentId, port) => ipcRenderer.invoke("engine:get-signal", componentId, port),
});
