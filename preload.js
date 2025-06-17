// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Receive summary data from main process
  onShowSummary: (callback) => ipcRenderer.on('show-summary', callback),
  
  // Send actions back to main process
  openFileLocation: (filePath) => ipcRenderer.invoke('open-file-location', filePath),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  copySummary: (summary) => ipcRenderer.invoke('copy-summary', summary),
  
  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});