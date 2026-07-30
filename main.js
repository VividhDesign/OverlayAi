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
const os   = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

// ─── Disable macOS 14 ScreenCaptureKit per-session picker ────────────────────
// Without this, desktopCapturer.getSources() shows a screen picker dialog
// EVERY TIME it is called, even after permission is granted — by macOS design.
// Disabling these flags reverts to classic TCC one-time permission behaviour.
app.commandLine.appendSwitch('disable-features', 'ScreenCaptureKitPickerScreen,ScreenCaptureKitStreamPickerSonoma');


let launcherWindow = null;   // Home / provider-config window
let overlayWindow  = null;   // Floating frameless overlay
let tray           = null;
let toggleLock     = false;
let screenshotCaptureInFlight = false;

// ─── Config ───────────────────────────────────────────────────────────────────
// Use app.getPath('userData') so config is writable in BOTH dev and packaged app.
// __dirname inside app.asar is read-only — writing there silently fails.
let CONFIG_PATH = null;
function getConfigPath() {
  if (!CONFIG_PATH) {
    CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
    // One-time migration: copy keys from old location if userData config doesn't exist yet
    const legacyPaths = [
      path.join(__dirname, 'config.json'),
      '/Users/vividhyadav/Projects/OverlayAi/config.json',
    ];
    if (!fs.existsSync(CONFIG_PATH)) {
      for (const lp of legacyPaths) {
        try {
          if (fs.existsSync(lp)) {
            fs.copyFileSync(lp, CONFIG_PATH);
            console.log('[OverlayAi] Migrated config from', lp);
            break;
          }
        } catch {}
      }
    }
  }
  return CONFIG_PATH;
}
function readConfig()  { try { return JSON.parse(fs.readFileSync(getConfigPath(), 'utf8')); } catch { return {}; } }
function writeConfig(d) {
  try { fs.writeFileSync(getConfigPath(), JSON.stringify(d, null, 2)); }
  catch (e) { console.error('[OverlayAi] writeConfig FAILED:', e); throw e; }
}

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

// ─── Screenshot capture ──────────────────────────────────────────────────────
// desktopCapturer triggers macOS's native Screen Recording dialog if it is called
// without an approved TCC grant. Check the grant first so a denied permission
// results in one actionable in-app message instead of a system dialog per hotkey.
function getScreenRecordingPermission() {
  if (process.platform !== 'darwin') return 'granted';
  return systemPreferences.getMediaAccessStatus('screen');
}

function screenRecordingPermissionMessage(status) {
  const action = 'Enable OverlayAi in System Settings → Privacy & Security → Screen & System Audio Recording, then quit and reopen OverlayAi.';
  if (status === 'denied' || status === 'restricted') {
    return `Screen Recording permission is ${status}. ${action}`;
  }
  return `Screen Recording permission has not been granted yet. ${action}`;
}

function sendScreenshotError(targetWindow, message) {
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send('screenshot-error', message);
  }
}

async function captureScreenDataUrl() {
  // Electron's desktopCapturer requests Screen & System Audio on recent macOS
  // releases, which can show a native prompt on each use. screencapture needs
  // only the already-approved Screen Recording grant and never requests audio.
  if (process.platform === 'darwin') {
    const tempPath = path.join(os.tmpdir(), `overlayai-${process.pid}-${Date.now()}.png`);
    try {
      await execFileAsync('/usr/sbin/screencapture', ['-x', '-t', 'png', tempPath]);
      const image = await fs.promises.readFile(tempPath);
      return `data:image/png;base64,${image.toString('base64')}`;
    } finally {
      await fs.promises.unlink(tempPath).catch(() => {});
    }
  }

  const { width, height } = screen.getPrimaryDisplay().size;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
  });
  if (!sources.length) throw new Error('No screen source found.');
  return sources[0].thumbnail.toDataURL();
}

async function capturePrimaryScreen() {
  const targetWindow = overlayWindow;
  if (!targetWindow || targetWindow.isDestroyed() || screenshotCaptureInFlight) return;

  const permission = getScreenRecordingPermission();
  if (permission !== 'granted') {
    sendScreenshotError(targetWindow, screenRecordingPermissionMessage(permission));
    return;
  }

  screenshotCaptureInFlight = true;
  const wasVisible = targetWindow.isVisible();
  try {
    if (wasVisible) targetWindow.hide();
    await new Promise(resolve => setTimeout(resolve, 250));

    if (!targetWindow.isDestroyed()) {
      targetWindow.webContents.send('screenshot-captured', await captureScreenDataUrl());
    }
  } catch (err) {
    const message = (err && (err.message || err.toString())) || 'Screen capture failed.';
    sendScreenshotError(targetWindow, message);
  } finally {
    if (wasVisible && !targetWindow.isDestroyed()) targetWindow.showInactive();
    screenshotCaptureInFlight = false;
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
  globalShortcut.register(screenshotKey, capturePrimaryScreen);
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
ipcMain.on('capture-screenshot', capturePrimaryScreen);

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
ipcMain.handle('get-config', () => {
  try { return readConfig(); }
  catch (e) { console.error('[OverlayAi] get-config error:', e); return {}; }
});
ipcMain.handle('save-config', (_, data) => {
  try {
    writeConfig(data);
    console.log('[OverlayAi] Config saved to:', getConfigPath());
    return { ok: true };
  } catch (e) {
    console.error('[OverlayAi] save-config FAILED:', e);
    throw new Error('Save failed: ' + e.message);
  }
});
ipcMain.handle('update-shortcuts', (_, { toggleKey, screenshotKey }) => {
  try {
    const config = readConfig();
    config.shortcutToggle     = toggleKey;
    config.shortcutScreenshot = screenshotKey;
    writeConfig(config);
    registerShortcuts();
    return true;
  } catch (e) {
    throw new Error('Shortcut save failed: ' + e.message);
  }
});

// Kept for backward compat (settings window from overlay gear icon)
ipcMain.on('open-settings-window', () => showLauncher());
