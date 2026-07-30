// ─── Constants ────────────────────────────────────────────────────────────────
const OLLAMA_BASE  = 'http://localhost:11434';
const GEMINI_BASE  = 'https://generativelanguage.googleapis.com/v1beta';
const GROQ_BASE    = 'https://api.groq.com/openai/v1';

// Gemini models — fetched dynamically, these are fallbacks
const GEMINI_FALLBACK_MODELS = [
  { id: 'gemini-2.5-flash',      name: 'Gemini 2.5 Flash ⚡'  },
  { id: 'gemini-2.5-pro',        name: 'Gemini 2.5 Pro 🧠'   },
  { id: 'gemini-2.0-flash',      name: 'Gemini 2.0 Flash'    },
  { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite'},
  { id: 'gemini-1.5-flash',      name: 'Gemini 1.5 Flash'    },
  { id: 'gemini-1.5-pro',        name: 'Gemini 1.5 Pro'      },
];

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const messagesEl       = document.getElementById('messages');
const inputEl          = document.getElementById('userInput');
const sendBtn          = document.getElementById('sendBtn');
const modelSelect      = document.getElementById('modelSelect');
const statusDot        = document.getElementById('statusDot');
const modelLabel       = document.getElementById('modelLabel');
const clearBtn         = document.getElementById('clearBtn');
const hideBtn          = document.getElementById('hideBtn');
const quitBtn          = document.getElementById('quitBtn');
const tabOllama        = document.getElementById('tabOllama');
const tabGemini        = document.getElementById('tabGemini');
const tabGroq          = document.getElementById('tabGroq');
const settingsBtn         = document.getElementById('settingsBtn');
const settingsModal       = document.getElementById('settingsModal');
const settingsCloseBtn    = document.getElementById('settingsCloseBtn');
const apiKeyInput         = document.getElementById('apiKeyInput');
const groqKeyInput        = document.getElementById('groqKeyInput');
const toggleGeminiKey     = document.getElementById('toggleGeminiKey');
const toggleGroqKey       = document.getElementById('toggleGroqKey');
const saveAllBtn          = document.getElementById('saveAllBtn');
const toggleShortcutRecorder   = document.getElementById('toggleShortcutRecorder');
const screenshotShortcutRecorder = document.getElementById('screenshotShortcutRecorder');
const toggleShortcutDisplay    = document.getElementById('toggleShortcutDisplay');
const screenshotShortcutDisplay = document.getElementById('screenshotShortcutDisplay');
const resetToggleShortcut      = document.getElementById('resetToggleShortcut');
const resetScreenshotShortcut  = document.getElementById('resetScreenshotShortcut');
const screenshotPreview= document.getElementById('screenshotPreview');
const ssThumbnails     = document.getElementById('ssThumbnails');
const ssCount          = document.getElementById('ssCount');
const ssRemoveAll      = document.getElementById('ssRemoveAll');
const imgLimitBadge    = document.getElementById('imgLimitBadge');
const inputWrapper     = document.querySelector('.input-wrapper');
const welcomeTitle     = document.getElementById('welcomeTitle');
const welcomeIcon      = document.getElementById('welcomeIcon');

// ─── State ────────────────────────────────────────────────────────────────────
let currentProvider    = 'gemini';   // 'ollama' | 'gemini' | 'groq'
let geminiApiKey       = '';
let groqApiKey         = '';
let conversationHistory= [];
let isStreaming        = false;
let abortController    = null;   // cancels in-flight stream
let pendingScreenshots = [];  // array of base64 data URLs
let welcomeEl          = document.getElementById('welcomeEl');
let screenPermissionNotice = null;

const DEFAULT_SCREEN_PROMPT = [
  'Analyze this screen and help me with what is shown.',
  'Identify the task, issue, or important information, explain what it means, and recommend the most useful next steps.',
  'If it is a coding problem, provide a correct solution using the language and template shown.',
  'If important details are unreadable, tell me exactly what additional information is needed.',
].join(' ');


// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const config = await window.electronAPI.getConfig();
  geminiApiKey = config.geminiApiKey || '';
  if (geminiApiKey) apiKeyInput.value = geminiApiKey;
  groqApiKey = config.groqApiKey || '';
  if (groqApiKey) groqKeyInput.value = groqApiKey;

  // Load saved keybindings into the recorder displays
  const savedToggle = config.shortcutToggle || 'Control+Alt+Space';
  const savedScreenshot = config.shortcutScreenshot || 'CommandOrControl+Shift+S';
  toggleShortcutDisplay.textContent = electronKeyToDisplay(savedToggle);
  screenshotShortcutDisplay.textContent = electronKeyToDisplay(savedScreenshot);
  toggleShortcutRecorder.dataset.value = savedToggle;
  screenshotShortcutRecorder.dataset.value = savedScreenshot;

  await switchProvider('gemini');
  inputEl.focus();
}

// ─── Provider switching ───────────────────────────────────────────────────────
tabOllama.addEventListener('click', () => switchProvider('ollama'));
tabGemini.addEventListener('click', () => switchProvider('gemini'));
tabGroq.addEventListener('click',   () => switchProvider('groq'));

async function switchProvider(p) {
  currentProvider = p;

  // Update tab styles
  tabOllama.classList.toggle('active', p === 'ollama');
  tabGemini.classList.toggle('active', p === 'gemini');
  tabGroq.classList.toggle('active',   p === 'groq');

  // Update send button + input wrapper color
  sendBtn.classList.toggle('gemini-send', p === 'gemini');
  sendBtn.classList.toggle('groq-send',   p === 'groq');
  inputWrapper.classList.toggle('gemini-focus', p === 'gemini');
  inputWrapper.classList.toggle('groq-focus',   p === 'groq');

  // Update welcome screen
  if (welcomeEl && welcomeEl.parentNode) {
    welcomeIcon.textContent  = p === 'gemini' ? '✦' : p === 'groq' ? '⚡' : '🦙';
    welcomeTitle.textContent = p === 'gemini' ? 'Gemini AI Assistant' : p === 'groq' ? 'Groq AI Assistant' : 'Ollama AI Assistant';
  }

  // Clear chat when switching
  clearChat(false);

  if (p === 'ollama') {
    setStatus('');
    await loadOllamaModels();
  } else if (p === 'groq') {
    setStatus('groq-active');
    if (!groqApiKey) {
      // Re-check disk before prompting — key may be saved but not yet in memory
      const cfg = await window.electronAPI.getConfig();
      if (cfg.groqApiKey) {
        groqApiKey = cfg.groqApiKey;
        groqKeyInput.value = cfg.groqApiKey;
        await loadGroqModels();
      } else {
        window.electronAPI.openSettings();
        showInfo('Enter your Groq API key in the Settings window ⚙');
      }
    } else {
      await loadGroqModels();
    }
  } else {
    setStatus('gemini-active');
    if (!geminiApiKey) {
      // Re-check disk before prompting — key may be saved but not yet in memory
      const cfg = await window.electronAPI.getConfig();
      if (cfg.geminiApiKey) {
        geminiApiKey = cfg.geminiApiKey;
        apiKeyInput.value = cfg.geminiApiKey;
        await loadGeminiModels();
      } else {
        window.electronAPI.openSettings();
        showInfo('Enter your Gemini API key in the Settings window ⚙');
      }
    } else {
      await loadGeminiModels();
    }
  }
}

// ─── Settings Window ──────────────────────────────────────────────────────────

// Open the Launcher (settings) window — also always re-populate inline modal fields
// so that saved API keys are visible whenever the user opens settings.
async function openSettingsAndPopulate() {
  // Always re-read config fresh so fields show current saved values
  const freshConfig = await window.electronAPI.getConfig();
  if (freshConfig.geminiApiKey) {
    geminiApiKey = freshConfig.geminiApiKey;
    apiKeyInput.value = freshConfig.geminiApiKey;
  }
  if (freshConfig.groqApiKey) {
    groqApiKey = freshConfig.groqApiKey;
    groqKeyInput.value = freshConfig.groqApiKey;
  }
  window.electronAPI.openSettings();
}

settingsBtn.addEventListener('click', openSettingsAndPopulate);
settingsCloseBtn.addEventListener('click', closeSettings);
function closeSettings() {
  settingsModal.style.display = 'none';
  stopRecording(); // cancel any active keybind recording
}

// Eye-toggle for API key fields
function makeEyeToggle(btn, input) {
  btn.addEventListener('click', () => {
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    btn.style.color = isHidden ? 'var(--accent)' : '';
  });
}
makeEyeToggle(toggleGeminiKey, apiKeyInput);
makeEyeToggle(toggleGroqKey, groqKeyInput);

// External links
document.getElementById('geminiLink').addEventListener('click', () =>
  window.electronAPI.openExternal('https://aistudio.google.com/app/apikey'));
document.getElementById('groqLink').addEventListener('click', () =>
  window.electronAPI.openExternal('https://console.groq.com/keys'));

// ─── Keybinding Recorder ─────────────────────────────────────────────────────
const DEFAULTS = {
  toggle:     { electron: 'Control+Alt+Space', display: '⌃⌥Space' },
  screenshot: { electron: 'CommandOrControl+Shift+S', display: '⌘⇧S' },
};

let activeRecorder = null; // which recorder is listening

function electronKeyToDisplay(electronKey) {
  return electronKey
    .replace('CommandOrControl', '⌘')
    .replace('Command', '⌘')
    .replace('Control', '⌃')
    .replace('Alt', '⌥')
    .replace('Shift', '⇧')
    .replace(/\+/g, '');
}

function displayToElectronKey(display) {
  return display
    .replace('⌘', 'CommandOrControl+')
    .replace('⌃', 'Control+')
    .replace('⌥', 'Alt+')
    .replace('⇧', 'Shift+');
}

function keyEventToElectron(e) {
  const parts = [];
  if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  const key = e.key.toUpperCase();
  if (!['META','CONTROL','SHIFT','ALT'].includes(e.key.toUpperCase())) {
    // Convert special keys
    const specialMap = { ' ': 'Space', 'ARROWUP': 'Up', 'ARROWDOWN': 'Down', 'ARROWLEFT': 'Left', 'ARROWRIGHT': 'Right' };
    parts.push(specialMap[e.key] || key);
  }
  return parts.join('+');
}

function startRecording(recorder, displayEl) {
  if (activeRecorder) stopRecording();
  activeRecorder = recorder;
  recorder.classList.add('recording');
  displayEl.textContent = '…press keys…';

  const onKey = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const electronKey = keyEventToElectron(e);
    if (!electronKey || electronKey === '' || ['CommandOrControl', 'Shift', 'Alt', 'Control'].includes(electronKey)) return;
    recorder.dataset.value = electronKey;
    displayEl.textContent = electronKeyToDisplay(electronKey);
    stopRecording();
  };

  recorder._keyHandler = onKey;
  window.addEventListener('keydown', onKey, { capture: true });
}

function stopRecording() {
  if (!activeRecorder) return;
  activeRecorder.classList.remove('recording');
  if (activeRecorder._keyHandler) {
    window.removeEventListener('keydown', activeRecorder._keyHandler, { capture: true });
    delete activeRecorder._keyHandler;
  }
  activeRecorder = null;
}

toggleShortcutRecorder.addEventListener('click', () => {
  if (toggleShortcutRecorder.classList.contains('recording')) { stopRecording(); return; }
  startRecording(toggleShortcutRecorder, toggleShortcutDisplay);
});
screenshotShortcutRecorder.addEventListener('click', () => {
  if (screenshotShortcutRecorder.classList.contains('recording')) { stopRecording(); return; }
  startRecording(screenshotShortcutRecorder, screenshotShortcutDisplay);
});

resetToggleShortcut.addEventListener('click', () => {
  stopRecording();
  toggleShortcutRecorder.dataset.value = DEFAULTS.toggle.electron;
  toggleShortcutDisplay.textContent = DEFAULTS.toggle.display;
});
resetScreenshotShortcut.addEventListener('click', () => {
  stopRecording();
  screenshotShortcutRecorder.dataset.value = DEFAULTS.screenshot.electron;
  screenshotShortcutDisplay.textContent = DEFAULTS.screenshot.display;
});

// ─── Save All Settings ────────────────────────────────────────────────────────
saveAllBtn.addEventListener('click', async () => {
  stopRecording();
  const gKey = apiKeyInput.value.trim();
  const rKey = groqKeyInput.value.trim();
  const toggleKey     = toggleShortcutRecorder.dataset.value     || DEFAULTS.toggle.electron;
  const screenshotKey = screenshotShortcutRecorder.dataset.value || DEFAULTS.screenshot.electron;

  // Update in-memory keys
  if (gKey) geminiApiKey = gKey;
  if (rKey) groqApiKey   = rKey;

  // Save all to config
  const config = await window.electronAPI.getConfig();
  await window.electronAPI.saveConfig({
    ...config,
    geminiApiKey: gKey || config.geminiApiKey,
    groqApiKey:   rKey || config.groqApiKey,
  });

  // Update shortcuts in main process (saves + re-registers live)
  await window.electronAPI.updateShortcuts({ toggleKey, screenshotKey });

  // Refresh models if provider changed
  if (gKey && currentProvider === 'gemini') await loadGeminiModels();
  if (rKey && currentProvider === 'groq')   await loadGroqModels();

  // Visual feedback
  saveAllBtn.textContent = '✓ Saved!';
  saveAllBtn.classList.add('saved');
  setTimeout(() => {
    saveAllBtn.textContent = 'Save Settings';
    saveAllBtn.classList.remove('saved');
    closeSettings();
  }, 1200);
});



// ─── Known Ollama cloud models ────────────────────────────────────────────────
const OLLAMA_CLOUD_MODELS = [
  { id: 'minimax-m3:cloud',        name: 'MiniMax M3 ☁'       },
  { id: 'glm-5.2:cloud',           name: 'GLM-5.2 ☁'          },
  { id: 'kimi-k2.7-code:cloud',    name: 'Kimi K2.7 Code ☁'   },
  { id: 'nemotron-3-super:cloud',  name: 'Nemotron-3 Super ☁' },
];

// ─── Load Ollama models ───────────────────────────────────────────────────────
async function loadOllamaModels() {
  modelSelect.innerHTML = '<option value="">Loading…</option>';

  let localModels = [];
  let ollamaOnline = false;

  try {
    const res  = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    localModels  = data.models || [];
    ollamaOnline = true;
  } catch {
    // Ollama offline — still show cloud models
  }

  modelSelect.innerHTML = '';

  if (localModels.length) {
    const grpLocal = document.createElement('optgroup');
    grpLocal.label = '💾 Local';
    localModels.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.name;
      const isCloud  = /:cloud$/i.test(m.name);
      const isVision = /llava|vision|vl\b|vlm|moondream|gemma3|gemma4|qwen2-vl|minicpm|bakllava|phi3|phi4|internvl|cogvlm|idefics|paligemma|florence/i.test(m.name);
      const display  = m.name.replace(':latest', '').replace(':cloud', '');
      opt.textContent = display + (isCloud ? ' ☁' : '') + (isVision ? ' 👁' : '');
      grpLocal.appendChild(opt);
    });
    modelSelect.appendChild(grpLocal);
  }

  // Always show cloud models (skip any already returned by /api/tags)
  const localIds = new Set(localModels.map(m => m.name));
  const grpCloud = document.createElement('optgroup');
  grpCloud.label = '☁ Cloud (via Ollama)';
  OLLAMA_CLOUD_MODELS.forEach(m => {
    if (localIds.has(m.id)) return;
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    grpCloud.appendChild(opt);
  });
  if (grpCloud.children.length) modelSelect.appendChild(grpCloud);

  if (!modelSelect.options.length) {
    modelSelect.innerHTML = '<option value="">No models available</option>';
    setStatus('error');
    if (!ollamaOnline) showError('⚠️ Ollama is not running. Run: ollama serve');
    return;
  }

  setStatus(ollamaOnline ? 'online' : 'error');
  if (!ollamaOnline) showError('⚠️ Ollama offline — cloud models still selectable');
  updateModelLabel();
}

// ─── Load Gemini models ───────────────────────────────────────────────────────
async function loadGeminiModels() {
  if (!geminiApiKey) return;
  modelSelect.innerHTML = '<option value="">Fetching models…</option>';

  try {
    const res = await fetch(`${GEMINI_BASE}/models?key=${geminiApiKey}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Filter to generative models only
    const models = (data.models || []).filter(m =>
      m.supportedGenerationMethods?.includes('generateContent') &&
      /gemini/i.test(m.name)
    );

    if (!models.length) throw new Error('No Gemini models returned');

    modelSelect.innerHTML = '';
    models.forEach((m) => {
      const opt = document.createElement('option');
      // m.name = "models/gemini-2.5-flash" → strip prefix
      opt.value = m.name.replace('models/', '');
      const hasVision = m.supportedGenerationMethods?.includes('generateContent');
      opt.textContent = (m.displayName || opt.value);
      modelSelect.appendChild(opt);
    });

    // Default to 2.5 flash if present
    const flash = [...modelSelect.options].find(o => /2\.5.*flash/i.test(o.value));
    if (flash) flash.selected = true;

    setStatus('gemini-active');
    updateModelLabel();
  } catch (err) {
    // Fallback to hardcoded list
    modelSelect.innerHTML = '';
    GEMINI_FALLBACK_MODELS.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id; opt.textContent = m.name;
      modelSelect.appendChild(opt);
    });
    setStatus('gemini-active');
    updateModelLabel();
    showInfo('Using default model list (could not fetch from API)');
  }
}

// ─── Load Groq models ─────────────────────────────────────────────────────────
const GROQ_FALLBACK_MODELS = [
  { id: 'llama-3.3-70b-versatile',        name: 'Llama 3.3 70B ⚡'           },
  { id: 'llama-3.1-8b-instant',           name: 'Llama 3.1 8B Instant ⚡'    },
  { id: 'llama-3.2-90b-vision-preview',   name: 'Llama 3.2 90B Vision 👁'    },
  { id: 'llama-3.2-11b-vision-preview',   name: 'Llama 3.2 11B Vision 👁'    },
  { id: 'gemma2-9b-it',                   name: 'Gemma2 9B'                  },
  { id: 'mixtral-8x7b-32768',             name: 'Mixtral 8x7B'               },
];

async function loadGroqModels() {
  if (!groqApiKey) return;
  modelSelect.innerHTML = '<option value="">Fetching Groq models…</option>';
  try {
    const res = await fetch(`${GROQ_BASE}/models`, {
      headers: { 'Authorization': `Bearer ${groqApiKey}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.data || []).filter(m => m.id && /llama|gemma|mixtral|whisper|qwen|deepseek/i.test(m.id));
    if (!models.length) throw new Error('No models');

    modelSelect.innerHTML = '';
    // Sort: vision models first, then by id
    models.sort((a, b) => {
      const av = /vision/i.test(a.id), bv = /vision/i.test(b.id);
      if (av && !bv) return -1; if (!av && bv) return 1;
      return a.id.localeCompare(b.id);
    });
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      const isVision = /vision|vl\b|vlm/i.test(m.id);
      opt.textContent = m.id + (isVision ? ' 👁' : '');
      modelSelect.appendChild(opt);
    });
    // Default to 70b versatile
    const best = [...modelSelect.options].find(o => /70b-versatile/i.test(o.value));
    if (best) best.selected = true;
    setStatus('groq-active');
    updateModelLabel();
  } catch {
    modelSelect.innerHTML = '';
    GROQ_FALLBACK_MODELS.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id; opt.textContent = m.name;
      modelSelect.appendChild(opt);
    });
    setStatus('groq-active');
    updateModelLabel();
  }
}

function setStatus(state) {
  statusDot.className = 'status-dot' + (state ? ' ' + state : '');
}

function updateModelLabel() {
  const val = modelSelect.value;
  if (!val) { modelLabel.textContent = 'No model selected'; return; }
  const name = val.replace(':latest', '');
  if (currentProvider === 'gemini') {
    modelLabel.textContent = '✦ ' + name;
  } else if (currentProvider === 'groq') {
    const isVision = /vision|vl\b|vlm/i.test(val);
    modelLabel.textContent = '⚡ ' + name + (isVision ? ' · vision ✓' : '');
  } else {
    const isCloud  = /:cloud$/i.test(val);
    const isVision = /llava|vision|vl\b|vlm|moondream|gemma3|gemma4|qwen2-vl|minicpm|bakllava|phi3|phi4|internvl|cogvlm|idefics|paligemma|florence/i.test(val);
    const cleanName = name.replace(':cloud', '');
    modelLabel.textContent = cleanName + (isCloud ? ' · ☁ cloud' : '') + (isVision ? ' · vision ✓' : '');
  }
}

// ─── Model image limits ─────────────────────────────────────────
function getModelImageLimit(provider, modelId) {
  const id = (modelId || '').toLowerCase();
  if (provider === 'gemini') {
    const visionModels = ['gemini-2.5', 'gemini-2.0', 'gemini-1.5', 'gemini-pro-vision', 'gemini-flash', 'gemini-pro'];
    return visionModels.some(m => id.includes(m)) ? 16 : 0;
  }
  if (provider === 'groq') {
    const visionModels = ['llama-3.2', 'llama-4', 'llava', 'vision'];
    return visionModels.some(m => id.includes(m)) ? 1 : 0;
  }
  if (provider === 'ollama') {
    const visionKeywords = ['llava', 'vision', 'moondream', 'bakllava', 'minicpm', 'gemma3', 'qwen2-vl', 'qvq', 'cogvlm'];
    return visionKeywords.some(k => id.includes(k)) ? 1 : 0;
  }
  return 0;
}

function updateImgLimitBadge() {
  const limit = getModelImageLimit(currentProvider, modelSelect.value);
  if (limit > 0) {
    imgLimitBadge.textContent = `🖼 max ${limit} image${limit > 1 ? 's' : ''}`;
    imgLimitBadge.style.display = 'inline';
  } else {
    imgLimitBadge.style.display = 'none';
  }
}

modelSelect.addEventListener('change', () => {
    updateModelLabel();
    updateImgLimitBadge();
});

// ─── Multi-thumbnail rendering ────────────────────────────────────
function renderScreenshotThumbnails() {
  ssThumbnails.innerHTML = '';
  pendingScreenshots.forEach((dataUrl, idx) => {
    const item = document.createElement('div');
    item.className = 'ss-thumb-item';
    item.innerHTML = `
      <img src="${dataUrl}" alt="image ${idx+1}" />
      <button class="ss-thumb-remove" title="Remove" data-idx="${idx}">×</button>
    `;
    item.querySelector('.ss-thumb-remove').addEventListener('click', () => {
      pendingScreenshots.splice(idx, 1);
      if (pendingScreenshots.length === 0) {
        screenshotPreview.style.display = 'none';
        inputEl.placeholder = 'Ask anything… (Enter to send, Shift+Enter for newline)';
      } else {
        renderScreenshotThumbnails();
      }
      inputEl.focus();
    });
    ssThumbnails.appendChild(item);
  });
  ssCount.textContent = pendingScreenshots.length;
}

ssRemoveAll.addEventListener('click', () => {
  pendingScreenshots = [];
  screenshotPreview.style.display = 'none';
  ssThumbnails.innerHTML = '';
  inputEl.placeholder = 'Ask anything… (Enter to send, Shift+Enter for newline)';
  inputEl.focus();
});

window.electronAPI.onScreenshot((dataUrl) => {
  if (screenPermissionNotice?.isConnected) {
    screenPermissionNotice.remove();
    screenPermissionNotice = null;
  }
  const limit = getModelImageLimit(currentProvider, modelSelect.value);
  if (limit > 0 && pendingScreenshots.length >= limit) {
    showError(`⚠️ ${modelSelect.value} supports max ${limit} image${limit > 1 ? 's' : ''}. Remove one first.`);
    return;
  }
  pendingScreenshots.push(dataUrl);
  renderScreenshotThumbnails();
  screenshotPreview.style.display = 'block';
  if (welcomeEl && welcomeEl.parentNode) { welcomeEl.remove(); welcomeEl = null; }
  inputEl.placeholder = 'Ask about the image… or press Enter to auto-solve';
  inputEl.focus();
  scrollToBottom();
});

// ─── Auto-resize textarea ──────────────────────────────────────────────────────
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
});

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!isStreaming) sendMessage(); }
});

sendBtn.addEventListener('click', () => {
  if (isStreaming) {
    // Stop the current stream
    if (abortController) abortController.abort();
  } else {
    sendMessage();
  }
});

// ─── Toolbar buttons ──────────────────────────────────────────────────────────
hideBtn.addEventListener('click', () => window.electronAPI.hideWindow());
quitBtn.addEventListener('click', () => window.electronAPI.quitApp());
// clearBtn wired below alongside onNewChat


window.electronAPI.onScreenshotError((err) => {
  const isPermissionErr = err && (err.includes('denied') || err.includes('permission') || err.includes('Permission'));
  if (isPermissionErr) {
    const detail = screenPermissionNotice?.isConnected
      ? screenPermissionNotice.querySelector('[data-permission-detail]')
      : null;
    if (detail) {
      detail.textContent = err;
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return;
    }

    // Keep a single actionable notice visible while permission is unavailable.
    const errDiv = document.createElement('div');
    errDiv.className = 'msg assistant';
    errDiv.innerHTML = `
      <div class="bubble error-bubble" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);padding:12px 14px;border-radius:10px;">
        <div style="color:#f87171;font-weight:600;margin-bottom:6px;">📵 Screen Recording Permission Required</div>
        <div data-permission-detail style="color:#fca5a5;font-size:12px;margin-bottom:10px;"></div>
        <button type="button" data-open-privacy style="background:#3b82f6;color:#fff;border:none;border-radius:6px;padding:7px 12px;font-size:12px;cursor:pointer;">
          Open System Settings → Screen Recording
        </button>
      </div>`;
    errDiv.querySelector('[data-permission-detail]').textContent = err;
    errDiv.querySelector('[data-open-privacy]').addEventListener('click', () => {
      window.electronAPI.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    });
    screenPermissionNotice = errDiv;
    messagesEl.appendChild(errDiv);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  } else {
    showError('Screenshot failed: ' + err);
  }
});


// New Chat via ⌘N shortcut or button
window.electronAPI.onNewChat(() => clearChat(true));
clearBtn.addEventListener('click', () => clearChat(true));

// ─── Clear chat ───────────────────────────────────────────────────────────────
function clearChat(showWelcome = true) {
  conversationHistory = [];
  pendingScreenshots  = [];
  screenPermissionNotice = null;
  screenshotPreview.style.display = 'none';
  ssThumbnails.innerHTML = '';
  inputEl.placeholder = 'Ask anything… (Enter to send, Shift+Enter for newline)';
  messagesEl.innerHTML = '';

  if (showWelcome) {
    const el = document.createElement('div');
    el.id = 'welcomeEl';
    el.className = 'welcome';
    const icon  = currentProvider === 'gemini' ? '✦' : currentProvider === 'groq' ? '⚡' : '🦙';
    const title = currentProvider === 'gemini' ? 'Gemini AI Assistant' : currentProvider === 'groq' ? 'Groq AI Assistant' : 'Ollama AI Assistant';
    const sub   = currentProvider === 'groq' ? 'Ultra-fast inference · Powered by Groq API' : currentProvider === 'gemini' ? 'Powered by Google Gemini API' : 'Running 100% locally · Powered by Ollama';
    el.innerHTML = `
      <div class="welcome-icon">${icon}</div>
      <div class="welcome-title">${title}</div>
      <div class="welcome-sub">Running ${sub}</div>
      <div class="shortcut-hint"><kbd>⌃⌥Space</kbd> hide &nbsp;·&nbsp; <kbd>⌘⇧S</kbd> screenshot</div>
    `;
    messagesEl.appendChild(el);
    welcomeEl = el;
  }
}

// ─── SEND MESSAGE ─────────────────────────────────────────────────────────────
async function sendMessage() {
  const text = inputEl.value.trim();
  const hasImages = pendingScreenshots.length > 0;
  if (!text && !hasImages) return;

  const model = modelSelect.value;
  if (!model) { showError('Please select a model first.'); return; }
  if (currentProvider === 'gemini' && !geminiApiKey) {
    window.electronAPI.openSettings();
    showError('⚠️ Enter your Gemini API key first.'); return;
  }
  if (currentProvider === 'groq' && !groqApiKey) {
    window.electronAPI.openSettings();
    showError('⚠️ Enter your Groq API key first.'); return;
  }

  const userText = text || DEFAULT_SCREEN_PROMPT;

  if (welcomeEl && welcomeEl.parentNode) { welcomeEl.remove(); welcomeEl = null; }

  // Build history entry
  const userMsg = { role: 'user', content: userText };
  if (hasImages) userMsg.images = pendingScreenshots.map(d => d.replace(/^data:image\/\w+;base64,/, ''));
  conversationHistory.push(userMsg);

  appendUserMessage(userText, hasImages ? [...pendingScreenshots] : []);

  // Reset input
  inputEl.value = '';
  inputEl.style.height = 'auto';
  inputEl.placeholder = 'Ask anything… (Enter to send, Shift+Enter for newline)';
  pendingScreenshots = [];
  screenshotPreview.style.display = 'none';
  ssThumbnails.innerHTML = '';

  setStreaming(true);
  const typingEl = appendTyping();

  try {
    let fullResponse = '';

    abortController = new AbortController();
    const signal = abortController.signal;

    if (currentProvider === 'ollama') {
      fullResponse = await streamOllama(model, typingEl, signal);
    } else if (currentProvider === 'groq') {
      fullResponse = await streamGroq(model, typingEl, signal);
    } else {
      fullResponse = await streamGemini(model, typingEl, signal);
    }

    conversationHistory.push({ role: 'assistant', content: fullResponse });

  } catch (err) {
    if (err.name === 'AbortError') {
      // User stopped the stream — not an error, just clean up
      if (typingEl.parentNode) typingEl.remove();
    } else {
      if (typingEl.parentNode) typingEl.remove();
      const msg = err.message || 'Unknown error';
      const isVisionErr = /does not support|multimodal|image/i.test(msg);
      showError(isVisionErr
        ? '⚠️ This model doesn\'t support images. Use a vision model for screenshots.'
        : '❌ ' + msg
      );
    }
  } finally {
    abortController = null;
    setStreaming(false);
  }
}

// ─── Ollama streaming ─────────────────────────────────────────────────────────
async function streamOllama(model, typingEl, signal) {
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: conversationHistory, stream: true }),
    signal,
  });

  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);

  const reader  = res.body.getReader();
  signal?.addEventListener('abort', () => reader.cancel());
  const decoder = new TextDecoder();

  typingEl.remove();
  const msgEl  = appendMessage('assistant', '');
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = decoder.decode(value).split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const json = JSON.parse(line);
        if (json.message?.content) {
          fullText += json.message.content;
          msgEl.querySelector('.bubble').innerHTML = formatMarkdown(fullText);
          scrollToBottom();
        }
      } catch {}
    }
  }

  return fullText;
}

// ─── Gemini streaming (SSE) ───────────────────────────────────────────────────
async function streamGemini(model, typingEl, signal) {
  const url = `${GEMINI_BASE}/models/${model}:streamGenerateContent?alt=sse&key=${geminiApiKey}`;

  // Convert conversation to Gemini format
  const contents = conversationHistory.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: buildGeminiParts(msg),
  }));

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents }),
    signal,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error?.message || `HTTP ${res.status}`);
  }

  const reader  = res.body.getReader();
  signal?.addEventListener('abort', () => reader.cancel());
  const decoder = new TextDecoder();

  typingEl.remove();
  const msgEl  = appendMessage('assistant', '');
  let fullText = '';
  let buffer   = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') continue;
      try {
        const json = JSON.parse(raw);
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          fullText += text;
          msgEl.querySelector('.bubble').innerHTML = formatMarkdown(fullText);
          scrollToBottom();
        }
      } catch {}
    }
  }

  return fullText;
}

// ─── Groq streaming (OpenAI-compatible SSE) ──────────────────────────────────────
async function streamGroq(model, typingEl, signal) {
  // Build messages in OpenAI format (no images for non-vision models)
  const messages = conversationHistory.map(msg => {
    if (msg.images && msg.images.length > 0) {
      // Vision message format
      return {
        role: msg.role,
        content: [
          { type: 'text', text: msg.content },
          ...msg.images.map(b64 => ({
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${b64}` },
          })),
        ],
      };
    }
    return { role: msg.role, content: msg.content };
  });

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${groqApiKey}`,
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error?.message || `HTTP ${res.status}`);
  }

  const reader  = res.body.getReader();
  signal?.addEventListener('abort', () => reader.cancel());
  const decoder = new TextDecoder();

  typingEl.remove();
  const msgEl  = appendMessage('assistant', '');
  let fullText = '';
  let buffer   = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') continue;
      try {
        const json = JSON.parse(raw);
        const text = json.choices?.[0]?.delta?.content;
        if (text) {
          fullText += text;
          msgEl.querySelector('.bubble').innerHTML = formatMarkdown(fullText);
          scrollToBottom();
        }
      } catch {}
    }
  }

  return fullText;
}

function buildGeminiParts(msg) {
  const parts = [];
  if (msg.content) parts.push({ text: msg.content });
  if (msg.images) {
    msg.images.forEach(b64 => {
      parts.push({ inline_data: { mime_type: 'image/png', data: b64 } });
    });
  }
  return parts.length ? parts : [{ text: '' }];
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────
function appendUserMessage(text, images = []) {
  const msg = document.createElement('div');
  msg.className = `msg user${currentProvider === 'gemini' ? ' gemini-msg' : currentProvider === 'groq' ? ' groq-msg' : ''}`;
  let inner = `<div class="bubble">${escapeHtml(text)}`;
  if (images && images.length > 0) {
    inner += `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">`;
    images.forEach((url, i) => { inner += `<img class="ss-chat-img" src="${url}" alt="image ${i+1}" />`; });
    inner += `</div>`;
  }
  inner += `</div>`;
  msg.innerHTML = inner;
  messagesEl.appendChild(msg);
  scrollToBottom();
}

function appendMessage(role, text) {
  const msg = document.createElement('div');
  msg.className = `msg ${role}`;
  msg.innerHTML = `<div class="bubble">${role === 'assistant' ? formatMarkdown(text) : escapeHtml(text)}</div>`;
  messagesEl.appendChild(msg);
  scrollToBottom();
  return msg;
}

function appendTyping() {
  const w = document.createElement('div');
  w.className = 'msg assistant';
  w.innerHTML = `<div class="typing"><span></span><span></span><span></span></div>`;
  messagesEl.appendChild(w);
  scrollToBottom();
  return w;
}

function showError(msg) {
  const el = document.createElement('div');
  el.className = 'error-toast';
  el.textContent = msg;
  messagesEl.appendChild(el);
  scrollToBottom();
  setTimeout(() => el.remove(), 7000);
}

function showInfo(msg) {
  const el = document.createElement('div');
  el.className = 'info-toast';
  el.textContent = msg;
  messagesEl.appendChild(el);
  scrollToBottom();
  setTimeout(() => el.remove(), 5000);
}

const SEND_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
const STOP_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`;

function setStreaming(val) {
  isStreaming = val;
  // Keep button enabled so user can click it to stop
  sendBtn.disabled = false;
  inputEl.disabled = val;
  sendBtn.innerHTML = val ? STOP_ICON : SEND_ICON;
  sendBtn.title = val ? 'Stop (click to cancel)' : 'Send';
  sendBtn.classList.toggle('stop-mode', val);
  if (!val) inputEl.focus();
}

function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

// ─── Reliable two-finger scroll on macOS (explicit wheel handler) ─────────────
// Electron at floating/screen-saver window level can drop native scroll events;
// this listener ensures trackpad scroll always reaches the messages container.
messagesEl.addEventListener('wheel', (e) => {
  e.stopPropagation();
  // deltaMode 0 = pixels, 1 = lines, 2 = pages
  const delta = e.deltaMode === 0 ? e.deltaY : e.deltaY * 20;
  messagesEl.scrollTop += delta;
}, { passive: true });






function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatMarkdown(text) {
  return text
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, __, code) => `<pre><code>${escapeHtml(code.trim())}</code></pre>`)
    .replace(/`([^`]+)`/g, (_, c) => `<code>${escapeHtml(c)}</code>`)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
