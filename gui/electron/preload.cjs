// 预加载：向渲染进程暴露引擎桥接口
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('engine', {
  start: exePath => ipcRenderer.invoke('engine:start', exePath),
  write: cmd => ipcRenderer.send('engine:write', cmd),
  alive: () => ipcRenderer.invoke('engine:alive'),
  onLine: cb => ipcRenderer.on('engine:line', (_e, line) => cb(line)),
  saveText: (defaultName, content, kind) => ipcRenderer.invoke('file:save', { defaultName, content, kind }),
  openText: () => ipcRenderer.invoke('file:open'),
});
