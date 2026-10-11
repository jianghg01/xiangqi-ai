// 预加载：向渲染进程暴露引擎桥接口
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('engine', {
  start: (slot, exePath) => ipcRenderer.invoke('engine:start', slot, exePath),
  write: (slot, cmd) => ipcRenderer.send('engine:write', slot, cmd),
  alive: slot => ipcRenderer.invoke('engine:alive', slot),
  onLine: cb => ipcRenderer.on('engine:line', (_e, msg) => cb(msg)),
  saveText: (defaultName, content, kind) => ipcRenderer.invoke('file:save', { defaultName, content, kind }),
  saveImage: (defaultName, dataUrl) => ipcRenderer.invoke('file:save-image', { defaultName, dataUrl }),
  openText: () => ipcRenderer.invoke('file:open'),
  libList: () => ipcRenderer.invoke('lib:list'),
  libRead: name => ipcRenderer.invoke('lib:read', name),
  libSave: (name, content) => ipcRenderer.invoke('lib:save', { name, content }),
  libBackup: (name, content) => ipcRenderer.invoke('lib:backup', { name, content }),
  libDelete: name => ipcRenderer.invoke('lib:delete', name),
  llmChat: payload => ipcRenderer.invoke('llm:chat', payload),
  getMem: () => ipcRenderer.invoke('sys:mem'),
  exportData: localStorageData => ipcRenderer.invoke('data:export', { localStorageData }),
  importData: () => ipcRenderer.invoke('data:import'),
});
