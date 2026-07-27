// ─── EPIPE Nuclear Fix — must be the very first lines of code ────────────────
// When launched without a terminal (login item, double-click), stdout/stderr
// pipes are closed. Electron's internal browser_init calls console.error()
// which tries to write to the dead pipe → EPIPE → Electron's native dialog.
//
// process.on('uncaughtException') is NOT enough because Electron's native
// crash reporter fires *independently* of Node's exception listener system.
//
// The ONLY reliable fix: replace the write() method itself with a no-op so
// the broken pipe is never written to and EPIPE can never be triggered.

const _safeWrite = () => true; // always report "write succeeded"

if (!process.stdout.isTTY) {
  try { process.stdout.write = _safeWrite; } catch {}
}
if (!process.stderr.isTTY) {
  try { process.stderr.write = _safeWrite; } catch {}
}

// Belt-and-suspenders: also catch anything that slips through
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE' || (err.message && err.message.includes('EPIPE'))) return;
  try {
    require('fs').appendFileSync(
      require('path').join(require('os').homedir(), 'AiOverlay-error.log'),
      `[${new Date().toISOString()}] ${err.stack || err}\n`
    );
  } catch {}
});
try { process.stdout.on('error', () => {}); } catch {}
try { process.stderr.on('error', () => {}); } catch {}

const { app, BrowserWindow, globalShortcut, ipcMain, screen, desktopCapturer, Tray, Menu, nativeImage, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let tray = null;
let toggleLock = false; // debounce guard — prevents double-trigger on rapid keypresses

// ─── TRAY ICON: programmatic 16×16 white circle (no asset file needed) ───
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
  icon.setTemplateImage(true); // auto-adapts to dark/light menu bar
  return icon;
}

function updateTrayMenu() {
  if (!tray) return;
  const visible = mainWindow ? mainWindow.isVisible() : false;
  tray.setToolTip(visible ? 'AiOverlay — Visible' : 'AiOverlay — Hidden');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: visible ? '● Overlay is ON' : '○ Overlay is OFF', enabled: false },
    { label: '⌘⇧Space to toggle anywhere', enabled: false },
    { type: 'separator' },
    {
      label: visible ? 'Hide Overlay' : 'Show Overlay  ⌘⇧Space',
      click: () => toggleWindow(),
    },
    { label: 'Screenshot  ⌘⇧S', enabled: false },
    { type: 'separator' },
    { label: 'Force Quit AiOverlay', click: () => { globalShortcut.unregisterAll(); app.exit(0); } },
  ]));
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.on('click', () => toggleWindow());
  updateTrayMenu();
}

const CONFIG_PATH = path.join(__dirname, 'config.json');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return {}; }
}

function writeConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
}

function createWindow() {
  // Guard: never create more than one window
  if (mainWindow && !mainWindow.isDestroyed()) return;

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 480,
    height: 620,
    x: width - 500,
    y: Math.floor(height / 2) - 310,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    show: false,
    hasShadow: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Always visible — including in screen share and recordings
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Keep tray menu in sync with actual window visibility
  mainWindow.on('show', updateTrayMenu);
  mainWindow.on('hide', updateTrayMenu);

  // Clean up reference if window is destroyed
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.loadFile('index.html');
}

function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  // Debounce: ignore calls within 300 ms of each other to prevent double-trigger
  if (toggleLock) return;
  toggleLock = true;
  setTimeout(() => { toggleLock = false; }, 300);

  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
  // updateTrayMenu() is called automatically via the 'show'/'hide' window events
}

// ─── Check Screen Recording permission and notify renderer ───────────────────
function checkScreenPermission() {
  if (process.platform !== 'darwin') return;
  const status = systemPreferences.getMediaAccessStatus('screen');
  if (status !== 'granted') {
    // Delay slightly so the renderer is ready
    setTimeout(() => {
      if (mainWindow) {
        mainWindow.webContents.send(
          'screenshot-error',
          'Screen Recording permission not granted. Open System Settings → Privacy & Security → Screen Recording and enable AiOverlay, then relaunch.'
        );
      }
    }, 2000);
  }
}

// ─── Hide dock icon & set name BEFORE app is ready so "Electron" never shows ─
if (app.dock) app.dock.hide();
app.setName('OverlayAi');

app.whenReady().then(() => {
  createWindow();
  createTray(); // ─── Menu-bar icon with Show/Hide button ───

  // ─── Auto-launch at login so ⌘⇧Space always works system-wide ───
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: true, // start hidden; user reveals with ⌘⇧Space
  });

  // Check screen recording permission after window is ready
  mainWindow.webContents.once('did-finish-load', () => checkScreenPermission());

  // ─── TOGGLE: Cmd+Shift+Space ───
  const ret = globalShortcut.register('CommandOrControl+Shift+Space', () => {
    toggleWindow();
  });
  if (!ret) {
    globalShortcut.register('CommandOrControl+Shift+G', () => toggleWindow());
  }

  // ─── NEW CHAT: Cmd+N ───
  globalShortcut.register('CommandOrControl+N', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) { mainWindow.show(); mainWindow.focus(); }
    mainWindow.webContents.send('new-chat');
  });
  // ─── SCREENSHOT: Cmd+Shift+S ───
  globalShortcut.register('CommandOrControl+Shift+S', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const wasVisible = mainWindow.isVisible();

    // 1. Hide the overlay so it won't appear in the screenshot
    if (wasVisible) mainWindow.hide();

    // 2. Capture the screen
    await new Promise((r) => setTimeout(r, 250));

    try {
      const { width, height } = screen.getPrimaryDisplay().size;
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width, height },
      });



      if (sources.length > 0) {
        const dataUrl = sources[0].thumbnail.toDataURL();
        if (wasVisible) { mainWindow.show(); mainWindow.focus(); }
        mainWindow.webContents.send('screenshot-captured', dataUrl);
      } else {
        if (wasVisible) { mainWindow.show(); mainWindow.focus(); }
        mainWindow.webContents.send('screenshot-error', 'No screen source found');
      }
    } catch (err) {
      // Re-enable protection even on failure
      if (wasVisible) { mainWindow.show(); mainWindow.focus(); }
      // err.message may be undefined on macOS permission denial — provide a clear fallback
      const errMsg = (err && (err.message || err.toString())) ||
        'Screen Recording permission denied. Open System Settings → Privacy & Security → Screen Recording and enable AiOverlay, then relaunch.';
      mainWindow.webContents.send('screenshot-error', errMsg);
    }
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', (e) => e.preventDefault());
// macOS: clicking the dock icon must never open a second window
app.on('activate', () => { if (!mainWindow || mainWindow.isDestroyed()) createWindow(); });

// ─── IPC ───
ipcMain.on('hide-window', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide(); });
ipcMain.on('quit-app', () => { globalShortcut.unregisterAll(); app.exit(0); });
ipcMain.on('resize-window', (_, { width, height }) => { if (mainWindow) mainWindow.setSize(width, height, true); });

ipcMain.handle('get-config', () => readConfig());
ipcMain.handle('save-config', (_, data) => { writeConfig(data); return true; });
