# Narración de los videos de NetTerminal

Los dos pipelines de video (`build.sh` con `tts.mjs` y `plugins/` con `narracion.mjs`) generan la voz con
Kokoro TTS local (modelo `hexgrad/Kokoro-82M`, licencia Apache-2.0). La voz del sistema de macOS
(`say -v Paulina`) queda como respaldo.

## Entorno

```sh
brew install espeak-ng ffmpeg
uv venv --python 3.12 ~/.venvs/kokoro
uv pip install --python ~/.venvs/kokoro/bin/python kokoro==0.9.4 soundfile num2words
# Solo para verificar la pronunciación:
uv pip install --python ~/.venvs/kokoro/bin/python faster-whisper
```

El modelo de Kokoro (unos 330 MB) y el de Whisper `medium` (unos 1,5 GB) se descargan de Hugging Face la
primera vez y quedan en `~/.cache/huggingface`. No se suben al repositorio, como tampoco los audios ni el venv.

Python siempre se ejecuta con `-I` (modo aislado).

## Variables

| Variable | Valores | Por defecto |
|---|---|---|
| `NT_TTS` | `kokoro` o `say` | `kokoro` |
| `NT_VOICE` | `ef_dora`, `em_alex`, `em_santa` | `ef_dora` |
| `NT_SPEED` | velocidad de Kokoro | `1.0` |
| `KOKORO_PY` | intérprete del venv | `~/.venvs/kokoro/bin/python` |

Con `NT_TTS=say` se usan `VOICE`/`RATE` (tts.mjs) y `VOZ`/`PPM` (narracion.mjs), como antes. Si el venv
no existe o Kokoro falla, el pipeline avisa y usa `say`.

## Uso

```sh
# Pipelines (generan solo los clips cuyo texto, voz o léxico cambió)
node scripts/video/tts.mjs
node scripts/video/plugins/narracion.mjs
NT_TTS=say node scripts/video/tts.mjs

# Un texto suelto: WAV mono 24 kHz a -16 LUFS y tiempos por oración en JSON
~/.venvs/kokoro/bin/python -I scripts/video/tts_kokoro.py guion.txt -v ef_dora -s 1.0 -o voz.wav -j voz.json

# Ver qué se le envía a la voz después del léxico, sin sintetizar
~/.venvs/kokoro/bin/python -I scripts/video/tts_kokoro.py guion.txt --solo-texto
```

`tts_kokoro.py` divide el texto en párrafos (línea en blanco) y oraciones, aplica `pronunciacion.json`,
convierte números (punto de miles, coma decimal), usa espeak-ng `es-419` (seseo latinoamericano) e inserta
pausas de 250 ms en comas, 450 ms entre oraciones y 700 ms entre párrafos. Las líneas que parten con `#`
no se leen. Con `--lote` genera muchos clips cargando el modelo una sola vez (así lo usan los pipelines).

## Léxico

`pronunciacion.json` mapea cómo se escribe un término a cómo se dice. Cada entrada tiene `escrito`,
`dicho`, `modo` (`deletreo`, `palabra`, `ingles`) y `acepta` (transcripciones de Whisper que cuentan como
reconocidas). `patron` permite expresiones regulares (unidades como `100 Mb/s`). Gana el término más largo.

## Verificación de pronunciación

```sh
~/.venvs/kokoro/bin/python -I scripts/video/verificar_voz.py --voces ef_dora --lexico ambos
~/.venvs/kokoro/bin/python -I scripts/video/verificar_voz.py --voces ef_dora,em_alex,em_santa,paulina --lexico ambos -d /tmp/verif
```

Sintetiza cada oración de `corpus_voz.txt`, la transcribe con Whisper y reporta WER, términos del léxico
no reconocidos y proxies de naturalidad (sílabas por segundo, su variación, rango de tono y confianza del
ASR). Después de cambiar el léxico, correrla y revisar las líneas con términos fallidos.
