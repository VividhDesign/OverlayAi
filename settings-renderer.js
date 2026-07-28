// ─── Settings Window Renderer ──────────────────────────────────────────────
// Handles API key persistence, key binding recording, and saving settings.

const geminiKeyInput    = document.getElementById('geminiKeyInput');
const groqKeyInput      = document.getElementById('groqKeyInput');
const toggleGeminiKey   = document.getElementById('toggleGeminiKey');
const toggleGroqKey     = document.getElementById('toggleGroqKey');
const saveGeminiKey     = document.getElementById('saveGeminiKey');
const saveGroqKey       = document.getElementById('saveGroqKey');
const geminiLink        = document.getElementById('geminiLink');
const groqLink          = document.getElementById('groqLink');
const saveAllBtn        = document.getElementById('saveAllBtn');
const toast             = document.getElementById('toast');

const toggleRecorder     = document.getElementById('toggleRecorder');
const screenshotRecorder = document.getElementById('screenshotRecorder');
const toggleDisplay      = document.getElementById('toggleDisplay');
const screenshotDisplay  = document.getElementById('screenshotDisplay');
const toggleHint         = document.getElementById('toggleHint');
const screenshotHint     = document.getElementById('screenshotHint');
const resetToggle        = document.getElementById('resetToggle');
const resetScreenshot    = document.getElementById('resetScreenshot');

// Stored Electron-format shortcut strings
let currentToggleKey     = 'CommandOrControl+Shift+Space';
let currentScreenshotKey = 'CommandOrControl+Shift+S';
let activeRecorder       = null;

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, type = '') {
  toast.textContent = msg;
  toast.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ─── Eye toggle ───────────────────────────────────────────────────────────────
toggleGeminiKey.addEventListener('click', () => {
  geminiKeyInput.type = geminiKeyInput.type === 'password' ? 'text' : 'password';
});
toggleGroqKey.addEventListener('click', () => {
  groqKeyInput.type = groqKeyInput.type === 'password' ? 'text' : 'password';
});

// ─── External links ───────────────────────────────────────────────────────────
geminiLink.addEventListener('click', () => window.settingsAPI.openExternal('https://aistudio.google.com/app/apikey'));
groqLink.addEventListener('click',   () => window.settingsAPI.openExternal('https://console.groq.com/keys'));

// ─── Key Binding Helpers ──────────────────────────────────────────────────────
const DEFAULT_TOGGLE_KEY     = 'CommandOrControl+Shift+Space';
const DEFAULT_SCREENSHOT_KEY = 'CommandOrControl+Shift+S';

// Convert Electron key string to nice display glyphs
function electronKeyToDisplay(k) {
  return k
    .replace('CommandOrControl', '⌘')
    .replace('Command',   '⌘')
    .replace('Control',   '⌃')
    .replace('Alt',       '⌥')
    .replace('Shift',     '⇧')
    .replace('Space',     'Space')
    .replace(/\+/g, '');
}

// Convert DOM keydown event to Electron format
function eventToElectronKey(e) {
  const parts = [];
  if (e.metaKey  || e.ctrlKey)  parts.push('CommandOrControl');
  if (e.altKey)                  parts.push('Alt');
  if (e.shiftKey)                parts.push('Shift');
  const key = e.key.length === 1 ? e.key.toUpperCase()
    : { ' ': 'Space', 'ArrowLeft': 'Left', 'ArrowRight': 'Right',
        'ArrowUp': 'Up', 'ArrowDown': 'Down' }[e.key] || e.key;
  if (!['Control','Shift','Alt','Meta'].includes(e.key)) parts.push(key);
  return parts.join('+');
}

// Start recording a key combo for a recorder element
function startRecording(recorder) {
  if (activeRecorder) stopRecording();
  activeRecorder = recorder;
  recorder.classList.add('recording');
  const hintEl = recorder === toggleRecorder ? toggleHint : screenshotHint;
  hintEl.textContent = '🔴 Press keys…';
}

function stopRecording() {
  if (!activeRecorder) return;
  activeRecorder.classList.remove('recording');
  const hintEl = activeRecorder === toggleRecorder ? toggleHint : screenshotHint;
  hintEl.textContent = 'click to record';
  activeRecorder = null;
}

toggleRecorder.addEventListener('click', () => {
  if (activeRecorder === toggleRecorder) { stopRecording(); return; }
  startRecording(toggleRecorder);
});
screenshotRecorder.addEventListener('click', () => {
  if (activeRecorder === screenshotRecorder) { stopRecording(); return; }
  startRecording(screenshotRecorder);
});

document.addEventListener('keydown', (e) => {
  if (!activeRecorder) return;
  e.preventDefault();
  const combo = eventToElectronKey(e);
  if (!combo || ['CommandOrControl', 'Alt', 'Shift'].includes(combo)) return;

  if (activeRecorder === toggleRecorder) {
    currentToggleKey = combo;
    toggleDisplay.textContent = electronKeyToDisplay(combo);
  } else {
    currentScreenshotKey = combo;
    screenshotDisplay.textContent = electronKeyToDisplay(combo);
  }
  stopRecording();
});

document.addEventListener('click', (e) => {
  if (activeRecorder && !activeRecorder.contains(e.target)) stopRecording();
});

resetToggle.addEventListener('click', () => {
  currentToggleKey = DEFAULT_TOGGLE_KEY;
  toggleDisplay.textContent = electronKeyToDisplay(DEFAULT_TOGGLE_KEY);
});
resetScreenshot.addEventListener('click', () => {
  currentScreenshotKey = DEFAULT_SCREENSHOT_KEY;
  screenshotDisplay.textContent = electronKeyToDisplay(DEFAULT_SCREENSHOT_KEY);
});

// ─── Save individual keys ─────────────────────────────────────────────────────
async function saveKey(field, value) {
  if (!value.trim()) { showToast('Key cannot be empty', 'error'); return; }
  const config = await window.settingsAPI.getConfig();
  config[field] = value.trim();
  await window.settingsAPI.saveConfig(config);
  showToast('✅ Saved!', 'success');
}

saveGeminiKey.addEventListener('click', () => saveKey('geminiApiKey', geminiKeyInput.value));
saveGroqKey.addEventListener('click',   () => saveKey('groqApiKey',   groqKeyInput.value));

// ─── Save All ─────────────────────────────────────────────────────────────────
saveAllBtn.addEventListener('click', async () => {
  const config = await window.settingsAPI.getConfig();

  if (geminiKeyInput.value.trim()) config.geminiApiKey = geminiKeyInput.value.trim();
  if (groqKeyInput.value.trim())   config.groqApiKey   = groqKeyInput.value.trim();
  config.shortcutToggle     = currentToggleKey;
  config.shortcutScreenshot = currentScreenshotKey;

  await window.settingsAPI.saveConfig(config);
  await window.settingsAPI.updateShortcuts({
    toggleKey:     currentToggleKey,
    screenshotKey: currentScreenshotKey,
  });

  showToast('✅ All settings saved & shortcuts updated!', 'success');
});

// ─── Init — load existing config ──────────────────────────────────────────────
async function init() {
  const config = await window.settingsAPI.getConfig();
  if (config.geminiApiKey) geminiKeyInput.value = config.geminiApiKey;
  if (config.groqApiKey)   groqKeyInput.value   = config.groqApiKey;

  const savedToggle     = config.shortcutToggle     || DEFAULT_TOGGLE_KEY;
  const savedScreenshot = config.shortcutScreenshot || DEFAULT_SCREENSHOT_KEY;
  currentToggleKey     = savedToggle;
  currentScreenshotKey = savedScreenshot;
  toggleDisplay.textContent     = electronKeyToDisplay(savedToggle);
  screenshotDisplay.textContent = electronKeyToDisplay(savedScreenshot);
}

init();
