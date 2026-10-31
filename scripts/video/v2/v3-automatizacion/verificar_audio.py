#!/usr/bin/env python3
"""Verifica el audio del MP4 final del video 3 contra la línea de tiempo planificada.

- Sincronía: para cada oración (BUILD/armado/oraciones.json, tiempos de tts_kokoro.py llevados
  al video) busca el inicio real de la voz en la pista final y reporta el desfase.
- Transcripción: corta cada oración del MP4, la transcribe con Whisper (faster-whisper, el mismo
  verificador de scripts/video/verificar_voz.py) y calcula el WER con la misma normalización y
  forma canónica de términos del léxico.

Uso:
  ~/.venvs/kokoro/bin/python -I scripts/video/v2/v3-automatizacion/verificar_audio.py VIDEO.mp4 BUILD/armado/oraciones.json [-o informe.json]
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

VIDEO_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(VIDEO_DIR))  # con -I la carpeta del script no está en sys.path
sys.dont_write_bytecode = True

import tts_kokoro as tk  # noqa: E402
import verificar_voz as vv  # noqa: E402

SR = 16000


def pista(mp4: str) -> np.ndarray:
    raw = subprocess.run([tk.FFMPEG, "-v", "error", "-i", mp4, "-map", "0:a", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def inicio_voz(audio: np.ndarray, t: float, ventana=(-0.6, 0.8), umbral_db=-38.0, silencio=0.15) -> float | None:
    """Inicio de voz (paso de silencio a voz) más cercano a t, en cuadros de 10 ms.

    Cuenta como inicio un cuadro con tres cuadros seguidos sobre el umbral precedido por al menos
    `silencio` segundos bajo el umbral (entre oraciones hay 0,25 a 0,7 s de pausa)."""
    a, b = max(0, int((t + ventana[0]) * SR)), min(len(audio), int((t + ventana[1]) * SR))
    trozo = audio[a:b]
    n = SR // 100
    if len(trozo) < n:
        return None
    cuadros = trozo[: len(trozo) // n * n].reshape(-1, n)
    db = 20 * np.log10(np.sqrt((cuadros ** 2).mean(axis=1)) + 1e-9)
    sobre = db > umbral_db
    k = int(silencio * 100)
    candidatos = [i for i in range(k, len(sobre) - 2) if sobre[i] and sobre[i + 1] and sobre[i + 2] and not sobre[i - k:i].any()]
    if not candidatos:
        return None
    return min(((a + i * n) / SR for i in candidatos), key=lambda x: abs(x - t))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("mp4")
    ap.add_argument("oraciones")
    ap.add_argument("--modelo", default="medium")
    ap.add_argument("-o", "--salida")
    ap.add_argument("--sin-asr", action="store_true", help="solo la sincronía, sin transcribir")
    a = ap.parse_args(argv)

    oraciones = json.loads(Path(a.oraciones).read_text(encoding="utf8"))
    audio = pista(a.mp4)

    # 1. Sincronía: inicio de la voz frente al inicio planificado (cada clip trae 50 ms de silencio
    # inicial, ya incluido en el tiempo de la oración que entrega tts_kokoro.py).
    desfases = []
    for o in oraciones:
        r = inicio_voz(audio, o["a"])
        if r is not None:
            desfases.append(r - o["a"])
    d = np.array(desfases)
    sinc = {"inicios_detectados": int(len(d)), "desfase_ms": {"mediana": round(float(np.median(d)) * 1000, 1), "p95": round(float(np.percentile(np.abs(d), 95)) * 1000, 1), "max_abs": round(float(np.abs(d).max()) * 1000, 1)}}
    if a.sin_asr:
        print(json.dumps(sinc, ensure_ascii=False, indent=1))
        return 0

    # 2. Transcripción por oración.
    from faster_whisper import WhisperModel
    asr = WhisperModel(a.modelo, device="cpu", compute_type="int8")
    canon = vv.Canon(tk.Lexico.cargar(tk.LEXICO_POR_DEFECTO).entradas)
    errores = palabras = 0
    detalle = []
    for o in oraciones:
        i0, i1 = int(max(0, o["a"] - 0.15) * SR), int(min(len(audio) / SR, o["b"] + 0.25) * SR)
        segs, _ = asr.transcribe(audio[i0:i1], language="es", beam_size=5, condition_on_previous_text=False, without_timestamps=True)
        hip = " ".join(s.text.strip() for s in segs)
        ref_c, hip_c = canon(o["texto"]).split(), canon(hip).split()
        e = vv.distancia(ref_c, hip_c)
        errores += e
        palabras += len(ref_c)
        detalle.append({"t": round(o["a"], 2), "toma": o.get("toma"), "esperado": o["texto"], "transcrito": hip, "wer": round(e / max(1, len(ref_c)), 3)})
    wer = errores / max(1, palabras)
    informe = {
        "oraciones": len(oraciones),
        "inicios_detectados": int(len(d)),
        "desfase_ms": {"mediana": round(float(np.median(d)) * 1000, 1), "p95": round(float(np.percentile(np.abs(d), 95)) * 1000, 1), "max_abs": round(float(np.abs(d).max()) * 1000, 1)},
        "wer": round(wer, 4),
        "palabras": palabras,
        "peores": sorted(detalle, key=lambda x: -x["wer"])[:12],
    }
    texto = json.dumps({"resumen": informe, "detalle": detalle}, ensure_ascii=False, indent=1)
    if a.salida:
        Path(a.salida).write_text(texto, encoding="utf8")
    print(json.dumps(informe, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
