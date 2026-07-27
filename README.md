# OverlayAi

A lightweight, always-on-top AI assistant overlay for macOS — built with Electron. Supports **Ollama** (local models), **Google Gemini**, and **Groq** with real-time streaming responses and screenshot analysis.

Toggle it instantly from anywhere with **⌘⇧Space**.

![OverlayAi Demo](https://img.shields.io/badge/platform-macOS-lightgrey?logo=apple) ![Electron](https://img.shields.io/badge/built%20with-Electron-47848F?logo=electron) ![License](https://img.shields.io/badge/license-MIT-green)

---

## Features

- **⌘⇧Space** — toggle the overlay on/off from any app, any workspace
- **Multi-provider** — switch between Ollama (local), Gemini, and Groq in one click
- **Streaming responses** — answers appear token-by-token in real time
- **Stop generation** — click the stop button mid-response to cancel instantly
- **Screenshot analysis** — capture your screen with **⌘⇧S** and ask the AI about it
- **Vision models** — supports multimodal models (marked with 👁)
- **Cloud models** — Ollama cloud models (minimax-m3, GLM-5.2, Kimi, Nemotron) always available
- **Multi-turn conversations** — full context carried across messages
- **Frameless & transparent** — floats above all windows, minimal footprint
- **Always on top** — stays visible across all spaces and full-screen apps
- **Menu bar icon** — quick access via system tray

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | [Electron](https://electronjs.org/) |
| AI — Local | [Ollama](https://ollama.com/) (any model) |
| AI — Cloud | [Google Gemini API](https://ai.google.dev/) |
| AI — Fast inference | [Groq API](https://console.groq.com/) |
| UI | Vanilla HTML/CSS/JS (no frameworks) |
| Streaming | Fetch API with ReadableStream / SSE |

---

## Getting Started

### Prerequisites

- macOS (10.15+)
- [Node.js](https://nodejs.org/) (v18+)
- [Ollama](https://ollama.com/) (optional, for local models)

### Installation

```bash
git clone https://github.com/VividhDesign/OverlayAi.git
cd OverlayAi
npm install
```

### Configuration

Create a `config.json` file in the project root (this file is gitignored — your keys stay local):

```json
{
  "geminiApiKey": "YOUR_GEMINI_API_KEY",
  "groqApiKey": "YOUR_GROQ_API_KEY"
}
```

Get your keys:
- **Gemini** → [Google AI Studio](https://aistudio.google.com/app/apikey) (free tier available)
- **Groq** → [console.groq.com](https://console.groq.com/) (free tier, very fast)
- **Ollama** → [ollama.com](https://ollama.com/) (fully local, no key needed)

### Run

```bash
npm start
```

---

## Usage

| Shortcut | Action |
|----------|--------|
| `⌘⇧Space` | Show / hide overlay |
| `⌘⇧S` | Capture screenshot & attach to next message |
| `Enter` | Send message |
| `Shift+Enter` | New line in message |
| `⌘N` | New chat |

- **Switch providers** using the tab bar (Ollama / Gemini / Groq)
- **Add API keys** via the ⚙ settings button
- **Stop a response** by clicking the red ■ button while it's generating

---

## Project Structure

```
OverlayAi/
├── main.js          # Electron main process — window, shortcuts, tray, IPC
├── preload.js       # Context bridge — secure renderer ↔ main communication
├── renderer.js      # UI logic — AI streaming, provider switching, DOM
├── index.html       # App shell
├── style.css        # Glassmorphism dark UI
└── config.json      # API keys (gitignored — create locally)
```

---

## How It Works

1. **Main process** (`main.js`) creates a frameless, transparent, always-on-top window and registers global keyboard shortcuts via Electron's `globalShortcut` API.
2. **Renderer process** (`renderer.js`) handles all AI communication directly using the Fetch API with streaming — no backend server needed.
3. **Ollama** is called via its local REST API (`localhost:11434`). Gemini and Groq use their respective REST APIs with SSE streaming.
4. **Screenshots** are captured using Electron's `desktopCapturer`, temporarily hiding the overlay so it doesn't appear in the capture.
5. **IPC** (Inter-Process Communication) via `contextBridge` keeps the renderer sandboxed while allowing it to trigger window-level actions.

---

## Screenshots

> Toggle, ask, get answers — all without leaving your current app.

---

## License

MIT — free to use, modify, and distribute.

---

## Author

Built by [VividhDesign](https://github.com/VividhDesign)
