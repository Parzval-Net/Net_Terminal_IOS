#!/bin/zsh
# Genera el video 1 "Primeros pasos y uso diario" (MP4 1920x1080 H.264 + AAC, .srt y capítulos).
# Requisitos: Kokoro local (scripts/video/README.md), Google Chrome, ffmpeg y `npm install` hecho.
# Puertos propios para no chocar con los otros videos: vite 1481 y Chrome por CDP 9481.
# Uso: zsh scripts/video/v2/v1-primeros-pasos/build-v1.sh [prefijos de capítulo para regrabar, p. ej. 03 07]
# Variables: WORK (trabajo, videos/.build-v1), OUT_DIR (salida, videos/), NT_VOICE (ef_dora).
set -euo pipefail
cd "$(dirname "$0")/../../../.."
export PORT=${PORT:-1481} CDP_PORT=${CDP_PORT:-9481} NT_TTS=${NT_TTS:-kokoro} NT_VOICE=${NT_VOICE:-ef_dora}
D=scripts/video/v2/v1-primeros-pasos

npx vite --port "$PORT" --strictPort > /dev/null 2>&1 &
VITE=$!
trap 'kill $VITE 2>/dev/null' EXIT
for i in {1..50}; do curl -sf "http://localhost:$PORT/$D/demo-v1.html" > /dev/null && break; sleep 0.2; done

node $D/tts-v1.mjs
node $D/record-v1.mjs "$@"
node $D/assemble-v1.mjs
node $D/verificar-video.mjs
# Whisper: ~/.venvs/kokoro/bin/python -I $D/verificar_v1.py videos/NetTerminal-v1-primeros-pasos.mp4 videos/.build-v1/final/timeline.json
