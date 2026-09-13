const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("circuitPlatform", {
  checkEngine: () => ipcRenderer.invoke("engine:health"),
});
