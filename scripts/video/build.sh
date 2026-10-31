#!/bin/zsh
# Genera el tutorial narrado de NetTerminal (MP4 1920x1080 H.264 + AAC, .srt y capítulos).
# Requisitos: Kokoro local (ver scripts/video/README.md; NT_TTS=say usa la voz Paulina de macOS),
# Google Chrome, ffmpeg y `npm install` hecho.
# Usa vite en el puerto 1461 y Chrome por CDP en el 9361 para no chocar con otras instancias.
# Uso: zsh scripts/video/build.sh [prefijos de capítulo para regrabar solo esos, p. ej. 03 07]
# Variables: OUT_DIR (salida, por defecto videos/), WORK (trabajo, videos/.build), RATE (voz, 185).
set -euo pipefail
cd "$(dirname "$0")/../.."
export PORT=${PORT:-1461} CDP_PORT=${CDP_PORT:-9361}

npx vite --port "$PORT" --strictPort > /dev/null 2>&1 &
VITE=$!
trap 'kill $VITE 2>/dev/null' EXIT
for i in {1..50}; do curl -sf "http://localhost:$PORT/scripts/screenshots/demo.html" > /dev/null && break; sleep 0.2; done

node scripts/video/tts.mjs
node scripts/video/record.mjs "$@"
node scripts/video/assemble.mjs
