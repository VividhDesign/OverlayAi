const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
  getConfig:       ()     => ipcRenderer.invoke('get-config'),
  saveConfig:      (data) => ipcRenderer.invoke('save-config', data),
  updateShortcuts: (s)    => ipcRenderer.invoke('update-shortcuts', s),
  openExternal:    (url)  => ipcRenderer.send('open-external', url),
});
