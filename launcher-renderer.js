// ─── OverlayAi Launcher Renderer ─────────────────────────────────────────────

const toast = document.getElementById('toast');

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = '') {
  toast.textContent = msg;
  toast.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('show'), 2600);
}

// ── Tab navigation ────────────────────────────────────────────────────────────
const navItems = document.querySelectorAll('.nav-item');
const pages    = document.querySelectorAll('.page');

document.getElementById('navProviders').addEventListener('click', () => switchPage('pageProviders', 'navProviders'));
document.getElementById('navKeybinds').addEventListener('click',  () => switchPage('pageKeybinds',  'navKeybinds'));

function switchPage(pageId, navId) {
  pages.forEach(p => p.classList.remove('active'));
  navItems.forEach(n => n.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
  document.getElementById(navId).classList.add('active');
}

// ── Provider card expand/collapse ─────────────────────────────────────────────
document.querySelectorAll('.provider-header').forEach(header => {
  header.addEventListener('click', () => {
    const card = header.dataset.card;
    const body = document.getElementById('body' + card.charAt(0).toUpperCase() + card.slice(1));
    if (!body) return;
    body.classList.toggle('open');
    // check ollama when expanding
    if (card === 'ollama' && body.classList.contains('open')) checkOllama();
  });
});

// ── Eye toggle ────────────────────────────────────────────────────────────────
document.querySelectorAll('.eye-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
  });
});

// ── External links ────────────────────────────────────────────────────────────
document.querySelectorAll('[data-href]').forEach(el => {
  el.addEventListener('click', () => window.launcherAPI.openExternal(el.dataset.href));
});

// ── Save individual API key ───────────────────────────────────────────────────
const providerKeyMap = {
  gemini: { inputId: 'geminiKey', configKey: 'geminiApiKey',  statusId: 'statusGemini', cardId: 'cardGemini' },
  groq:   { inputId: 'groqKey',   configKey: 'groqApiKey',    statusId: 'statusGroq',   cardId: 'cardGroq'   },
  openai: { inputId: 'openaiKey', configKey: 'openaiApiKey',  statusId: 'statusOpenai', cardId: 'cardOpenai' },
  claude: { inputId: 'claudeKey', configKey: 'claudeApiKey',  statusId: 'statusClaude', cardId: 'cardClaude' },
};

document.querySelectorAll('.save-key-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const provider = btn.dataset.provider;
    const map = providerKeyMap[provider];
    if (!map) return;
    const val = document.getElementById(map.inputId).value.trim();
    if (!val) { showToast('Key cannot be empty', 'error'); return; }
    const config = await window.launcherAPI.getConfig();
    config[map.configKey] = val;
    await window.launcherAPI.saveConfig(config);
    updateProviderStatus(provider, true);
    showToast(`✅ ${providerLabel(provider)} key saved!`, 'success');
  });
});

function providerLabel(p) {
  return { gemini: 'Gemini', groq: 'Groq', openai: 'OpenAI', claude: 'Claude' }[p] || p;
}

function updateProviderStatus(provider, ok) {
  const map = providerKeyMap[provider];
  if (!map) return;
  const el = document.getElementById(map.statusId);
  const card = document.getElementById(map.cardId);
  if (!el) return;
  el.textContent = ok ? '✓ Connected' : 'Not set';
  el.className   = 'provider-status' + (ok ? ' ok' : '');
  if (card) {
    card.classList.toggle('connected', ok);
  }
}

// ── Ollama check ──────────────────────────────────────────────────────────────
const ollamaDot  = document.getElementById('ollamaDot');
const ollamaText = document.getElementById('ollamaText');
const statusOllamaEl = document.getElementById('statusOllama');

async function checkOllama() {
  ollamaText.textContent = 'Checking Ollama at localhost:11434…';
  ollamaDot.className = 'ollama-status-dot';
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      const count = (data.models || []).length;
      ollamaDot.className = 'ollama-status-dot online';
      ollamaText.textContent = `Running — ${count} model${count !== 1 ? 's' : ''} available`;
      statusOllamaEl.textContent = '✓ Running';
      statusOllamaEl.className = 'provider-status ok';
      document.getElementById('cardOllama').classList.add('connected');
    } else {
      setOllamaOffline();
    }
  } catch {
    setOllamaOffline();
  }
}

function setOllamaOffline() {
  ollamaDot.className = 'ollama-status-dot error';
  ollamaText.textContent = 'Not running — install from ollama.ai and run `ollama serve`';
  statusOllamaEl.textContent = 'Not running';
  statusOllamaEl.className = 'provider-status';
  document.getElementById('cardOllama').classList.remove('connected');
}

document.getElementById('checkOllamaBtn').addEventListener('click', checkOllama);

// ── Key Bindings ──────────────────────────────────────────────────────────────
const DEFAULT_TOGGLE     = 'CommandOrControl+Shift+Space';
const DEFAULT_SCREENSHOT = 'CommandOrControl+Shift+S';

let currentToggle     = DEFAULT_TOGGLE;
let currentScreenshot = DEFAULT_SCREENSHOT;
let activeRec         = null;

function electronToDisplay(k) {
  return k
    .replace('CommandOrControl', '⌘').replace('Command', '⌘').replace('Control', '⌃')
    .replace('Alt', '⌥').replace('Shift', '⇧').replace('Space', 'Space')
    .replace(/\+/g, '');
}

function eventToElectron(e) {
  const parts = [];
  if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl');
  if (e.altKey)   parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() :
    ({ ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down' }[e.key] || e.key);
  if (!['Control','Shift','Alt','Meta'].includes(e.key)) parts.push(key);
  return parts.join('+');
}

function startRec(rec) {
  if (activeRec) stopRec();
  activeRec = rec;
  rec.classList.add('recording');
  const hintEl = rec.querySelector('.keybind-hint');
  if (hintEl) hintEl.textContent = '🔴 Press keys…';
}
function stopRec() {
  if (!activeRec) return;
  activeRec.classList.remove('recording');
  const hintEl = activeRec.querySelector('.keybind-hint');
  if (hintEl) hintEl.textContent = 'click to record';
  activeRec = null;
}

document.getElementById('recToggle').addEventListener('click', () => {
  if (activeRec === document.getElementById('recToggle')) { stopRec(); return; }
  startRec(document.getElementById('recToggle'));
});
document.getElementById('recScreenshot').addEventListener('click', () => {
  if (activeRec === document.getElementById('recScreenshot')) { stopRec(); return; }
  startRec(document.getElementById('recScreenshot'));
});

document.addEventListener('keydown', e => {
  if (!activeRec) return;
  e.preventDefault();
  const combo = eventToElectron(e);
  if (!combo || ['CommandOrControl','Alt','Shift'].includes(combo)) return;
  if (activeRec === document.getElementById('recToggle')) {
    currentToggle = combo;
    document.getElementById('dispToggle').textContent = electronToDisplay(combo);
  } else {
    currentScreenshot = combo;
    document.getElementById('dispScreenshot').textContent = electronToDisplay(combo);
  }
  stopRec();
});

document.addEventListener('click', e => {
  if (activeRec && !activeRec.contains(e.target)) stopRec();
});

document.querySelectorAll('[data-reset]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.reset === 'toggle') {
      currentToggle = DEFAULT_TOGGLE;
      document.getElementById('dispToggle').textContent = electronToDisplay(DEFAULT_TOGGLE);
    } else {
      currentScreenshot = DEFAULT_SCREENSHOT;
      document.getElementById('dispScreenshot').textContent = electronToDisplay(DEFAULT_SCREENSHOT);
    }
  });
});

document.getElementById('saveKbBtn').addEventListener('click', async () => {
  const config = await window.launcherAPI.getConfig();
  config.shortcutToggle     = currentToggle;
  config.shortcutScreenshot = currentScreenshot;
  await window.launcherAPI.saveConfig(config);
  await window.launcherAPI.updateShortcuts({ toggleKey: currentToggle, screenshotKey: currentScreenshot });
  showToast('✅ Key bindings saved & applied!', 'success');
});

// ── Launch Overlay ────────────────────────────────────────────────────────────
document.getElementById('launchOverlayBtn').addEventListener('click', () => {
  window.launcherAPI.launchOverlay();
});

// ── Init: load saved config ───────────────────────────────────────────────────
async function init() {
  const config = await window.launcherAPI.getConfig();

  // Populate API keys (show masked)
  if (config.geminiApiKey) { document.getElementById('geminiKey').value = config.geminiApiKey; updateProviderStatus('gemini', true); }
  if (config.groqApiKey)   { document.getElementById('groqKey').value   = config.groqApiKey;   updateProviderStatus('groq',   true); }
  if (config.openaiApiKey) { document.getElementById('openaiKey').value = config.openaiApiKey; updateProviderStatus('openai', true); }
  if (config.claudeApiKey) { document.getElementById('claudeKey').value = config.claudeApiKey; updateProviderStatus('claude', true); }

  // Open cards for providers without keys
  if (!config.geminiApiKey) document.getElementById('bodyGemini').classList.add('open');

  // Key bindings
  const t = config.shortcutToggle     || DEFAULT_TOGGLE;
  const s = config.shortcutScreenshot || DEFAULT_SCREENSHOT;
  currentToggle = t; currentScreenshot = s;
  document.getElementById('dispToggle').textContent     = electronToDisplay(t);
  document.getElementById('dispScreenshot').textContent = electronToDisplay(s);

  // Check Ollama in background
  checkOllama();
}

init();
