const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('baiduUploader', {
  chooseFolder: (options = {}) => ipcRenderer.invoke('folder:choose', options),
  browserStatus: () => ipcRenderer.invoke('browser:status'),
  loadConfigSync: () => ipcRenderer.sendSync('config:load-sync'),
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (accounts) => ipcRenderer.invoke('config:save', accounts),
  start: (config) => ipcRenderer.invoke('upload:start', config),
  stop: (options = {}) => ipcRenderer.invoke('upload:stop', options),
  onLog: (callback) => ipcRenderer.on('upload:log', (_event, payload) => callback(payload)),
  onState: (callback) => ipcRenderer.on('upload:state', (_event, payload) => callback(payload)),
  onPlan: (callback) => ipcRenderer.on('upload:plan', (_event, payload) => callback(payload))
});
