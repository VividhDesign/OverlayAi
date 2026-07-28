const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  hideWindow:      ()          => ipcRenderer.send('hide-window'),
  quitApp:         ()          => ipcRenderer.send('quit-app'),
  resizeWindow:    (w, h)      => ipcRenderer.send('resize-window', { width: w, height: h }),
  openSettings:    ()          => ipcRenderer.send('show-launcher'),   // opens launcher home
  showLauncher:    ()          => ipcRenderer.send('show-launcher'),
  getConfig:       ()          => ipcRenderer.invoke('get-config'),
  saveConfig:      (data)      => ipcRenderer.invoke('save-config', data),
  onScreenshot:    (cb)        => ipcRenderer.on('screenshot-captured', (_, d) => cb(d)),
  onScreenshotError:(cb)       => ipcRenderer.on('screenshot-error',    (_, e) => cb(e)),
  onNewChat:       (cb)        => ipcRenderer.on('new-chat',             ()    => cb()),
  updateShortcuts: (shortcuts) => ipcRenderer.invoke('update-shortcuts', shortcuts),
  openExternal:    (url)       => ipcRenderer.send('open-external', url),
});

