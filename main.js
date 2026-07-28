// ─── EPIPE Nuclear Fix — must be the very first lines of code ────────────────
const _safeWrite = () => true;
if (!process.stdout.isTTY) { try { process.stdout.write = _safeWrite; } catch {} }
if (!process.stderr.isTTY) { try { process.stderr.write = _safeWrite; } catch {} }
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE' || (err.message && err.message.includes('EPIPE'))) return;
  try {
    require('fs').appendFileSync(
      require('path').join(require('os').homedir(), 'OverlayAi-error.log'),
      `[${new Date().toISOString()}] ${err.stack || err}\n`
    );
  } catch {}
});
try { process.stdout.on('error', () => {}); } catch {}
try { process.stderr.on('error', () => {}); } catch {}

const {
  app, BrowserWindow, globalShortcut, ipcMain,
  screen, desktopCapturer, Tray, Menu, nativeImage, systemPreferences, shell,
} = require('electron');
const path = require('path');
const fs   = require('fs');

let launcherWindow = null;   // Home / provider-config window
let overlayWindow  = null;   // Floating frameless overlay
let tray           = null;
let toggleLock     = false;

// ─── Config ───────────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, 'config.json');
function readConfig()    { try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; } }
function writeConfig(d)  { fs.writeFileSync(CONFIG_PATH, JSON.stringify(d, null, 2)); }

// ─── Tray Icon ────────────────────────────────────────────────────────────────
function createTrayIcon() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2, r = 6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const i = (y * size + x) * 4;
      const alpha = dist <= r ? 255 : dist <= r + 1 ? Math.round(255 * (r + 1 - dist)) : 0;
      buf[i] = 255; buf[i+1] = 255; buf[i+2] = 255; buf[i+3] = alpha;
    }
  }
  const icon = nativeImage.createFromBuffer(buf, { width: size, height: size });
  icon.setTemplateImage(true);
  return icon;
}

function updateTrayMenu() {
  if (!tray) return;
  const overlayVisible = overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible();
  tray.setToolTip('OverlayAi');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'OverlayAi', enabled: false },
    { type: 'separator' },
    { label: '⚙ Open OverlayAi Home', click: () => showLauncher() },
    { label: overlayVisible ? '● Hide Overlay' : '○ Show Overlay', click: () => toggleOverlay() },
    { type: 'separator' },
    { label: 'Quit', click: () => { globalShortcut.unregisterAll(); app.exit(0); } },
  ]));
}

function createTray() {
  tray = new Tray(createTrayIcon());
  // Left-click → show launcher; right-click → context menu
  tray.on('click', () => showLauncher());
  updateTrayMenu();
}

// ─── Launcher Window ──────────────────────────────────────────────────────────
function createLauncherWindow() {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    launcherWindow.focus();
    return;
  }
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  launcherWindow = new BrowserWindow({
    width:      620,
    height:     540,
    x:          Math.floor((width  - 620) / 2),
    y:          Math.floor((height - 540) / 2),
    title:      'OverlayAi',
    frame:      false,         // frameless so we can style the title bar
    transparent: false,
    titleBarStyle: 'hiddenInset',
    resizable:  false,
    minimizable: true,
    maximizable: false,
    show:       false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'launcher-preload.js'),
    },
  });
  launcherWindow.setMenuBarVisibility(false);
  launcherWindow.loadFile('launcher.html');
  launcherWindow.once('ready-to-show', () => launcherWindow.show());
  launcherWindow.on('closed', () => { launcherWindow = null; });
}

function showLauncher() {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    launcherWindow.show();
    launcherWindow.focus();
  } else {
    createLauncherWindow();
  }
}

// ─── Overlay Window ───────────────────────────────────────────────────────────
function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) return;

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  overlayWindow = new BrowserWindow({
    width:   480,
    height:  620,
    x:       width - 500,
    y:       Math.floor(height / 2) - 310,
    frame:   false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable:  true,
    movable:    true,
    show:       false,
    hasShadow:  true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  overlayWindow.setAlwaysOnTop(true, 'floating');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.on('closed', () => { overlayWindow = null; updateTrayMenu(); });
  overlayWindow.on('show',   updateTrayMenu);
  overlayWindow.on('hide',   updateTrayMenu);
  overlayWindow.loadFile('index.html');
  overlayWindow.once('ready-to-show', () => {
    overlayWindow.showInactive(); // show without stealing focus
  });
}

function toggleOverlay() {
  if (toggleLock) return;
  toggleLock = true;
  setTimeout(() => { toggleLock = false; }, 300);

  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlayWindow();
    return;
  }
  if (overlayWindow.isVisible()) {
    overlayWindow.hide();
  } else {
    overlayWindow.showInactive();
  }
}

// ─── Shortcuts ────────────────────────────────────────────────────────────────
function registerShortcuts() {
  const config        = readConfig();
  const toggleKey     = config.shortcutToggle     || 'CommandOrControl+Shift+Space';
  const screenshotKey = config.shortcutScreenshot || 'CommandOrControl+Shift+S';

  globalShortcut.unregisterAll();

  // Toggle overlay
  const ret = globalShortcut.register(toggleKey, toggleOverlay);
  if (!ret) globalShortcut.register('CommandOrControl+Shift+G', toggleOverlay);

  // New chat
  globalShortcut.register('CommandOrControl+N', () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    if (!overlayWindow.isVisible()) overlayWindow.showInactive();
    overlayWindow.webContents.send('new-chat');
  });

  // Screenshot
  globalShortcut.register(screenshotKey, async () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    const wasVisible = overlayWindow.isVisible();
    if (wasVisible) overlayWindow.hide();
    await new Promise(r => setTimeout(r, 250));
    try {
      const { width, height } = screen.getPrimaryDisplay().size;
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
      if (sources.length > 0) {
        const dataUrl = sources[0].thumbnail.toDataURL();
        if (wasVisible) overlayWindow.showInactive();
        overlayWindow.webContents.send('screenshot-captured', dataUrl);
      } else {
        if (wasVisible) overlayWindow.showInactive();
        overlayWindow.webContents.send('screenshot-error', 'No screen source found');
      }
    } catch (err) {
      if (wasVisible) overlayWindow.showInactive();
      const msg = (err && (err.message || err.toString())) ||
        'Screen Recording permission denied. Open System Settings → Privacy & Security → Screen Recording.';
      if (overlayWindow) overlayWindow.webContents.send('screenshot-error', msg);
    }
  });
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
if (app.dock) app.dock.hide();
app.setName('OverlayAi');

app.whenReady().then(() => {
  createLauncherWindow();
  createTray();

  app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
  registerShortcuts();
});

app.on('will-quit',        () => globalShortcut.unregisterAll());
app.on('window-all-closed', e => e.preventDefault()); // keep alive even with no windows
app.on('activate', () => showLauncher());

// ─── IPC — Overlay ────────────────────────────────────────────────────────────
ipcMain.on('hide-window', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
});
ipcMain.on('quit-app', () => { globalShortcut.unregisterAll(); app.exit(0); });
ipcMain.on('resize-window', (_, { width, height }) => {
  if (overlayWindow) overlayWindow.setSize(width, height, true);
});
ipcMain.on('open-external', (_, url) => shell.openExternal(url));

// Screenshot from overlay renderer
ipcMain.on('capture-screenshot', async () => {
  if (!overlayWindow) return;
  const wasVisible = overlayWindow.isVisible();
  if (wasVisible) overlayWindow.hide();
  await new Promise(r => setTimeout(r, 250));
  try {
    const { width, height } = screen.getPrimaryDisplay().size;
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
    if (wasVisible) overlayWindow.showInactive();
    if (sources.length) overlayWindow.webContents.send('screenshot-captured', sources[0].thumbnail.toDataURL());
    else overlayWindow.webContents.send('screenshot-error', 'No source');
  } catch (err) {
    if (wasVisible) overlayWindow.showInactive();
    overlayWindow.webContents.send('screenshot-error', err.message || 'Screen capture failed');
  }
});

// ─── IPC — Launcher ───────────────────────────────────────────────────────────
ipcMain.on('launch-overlay', () => {
  // Hide launcher, show/create overlay
  if (launcherWindow && !launcherWindow.isDestroyed()) launcherWindow.hide();
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlayWindow();
  } else {
    overlayWindow.showInactive();
  }
  updateTrayMenu();
});

// When overlay requests to go back to launcher
ipcMain.on('show-launcher', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
  showLauncher();
});

// ─── IPC — Config ─────────────────────────────────────────────────────────────
ipcMain.handle('get-config', () => readConfig());
ipcMain.handle('save-config', (_, data) => { writeConfig(data); return true; });
ipcMain.handle('update-shortcuts', (_, { toggleKey, screenshotKey }) => {
  const config = readConfig();
  config.shortcutToggle     = toggleKey;
  config.shortcutScreenshot = screenshotKey;
  writeConfig(config);
  registerShortcuts();
  return true;
});

// Kept for backward compat (settings window from overlay gear icon)
ipcMain.on('open-settings-window', () => showLauncher());
