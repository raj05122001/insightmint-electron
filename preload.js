const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('insightAPI', {
  onSummary: (callback) => ipcRenderer.on('show-summary', (_, data) => callback(data)),
});
