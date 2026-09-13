const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("circuitPlatform", {
  // 仅暴露健康检查能力，避免把 Node/Electron 权限直接开放给渲染进程。
  checkEngine: () => ipcRenderer.invoke("engine:health"),
});
