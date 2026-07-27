#!/bin/bash
# AiOverlay Launcher
DIR="$(cd "$(dirname "$0")" && pwd)"
"$DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" "$DIR"
