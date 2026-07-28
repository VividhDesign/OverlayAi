const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcherAPI', {
  getConfig:       ()     => ipcRenderer.invoke('get-config'),
  saveConfig:      (data) => ipcRenderer.invoke('save-config', data),
  updateShortcuts: (s)    => ipcRenderer.invoke('update-shortcuts', s),
  openExternal:    (url)  => ipcRenderer.send('open-external', url),
  launchOverlay:   ()     => ipcRenderer.send('launch-overlay'),
});
