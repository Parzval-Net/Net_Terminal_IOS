#!/usr/bin/env python3
"""Verifica el audio del video 1 ya armado: WER con Whisper y sincronía audio/línea de tiempo.

Para cada frase de la línea de tiempo (timeline.json de assemble-v1.mjs) recorta su tramo del MP4
final, lo transcribe con faster-whisper y lo compara con el texto del guion usando la forma canónica
de scripts/video/verificar_voz.py (léxico de pronunciación, números a palabras). La sincronía se mide
como la diferencia entre el inicio de voz detectado en el audio final (energía) y el inicio esperado
(instante de la frase + inicio de la primera oración según tts_kokoro.py).

Uso:
  ~/.venvs/kokoro/bin/python -I scripts/video/v2/v1-primeros-pasos/verificar_v1.py video.mp4 timeline.json -o resultado.json
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


def audio(ruta: Path) -> np.ndarray:
    raw = subprocess.run([tk.FFMPEG, "-v", "error", "-i", str(ruta), "-vn", "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def inicio_voz(x: np.ndarray, desde: float, hasta: float) -> float | None:
    """Primer cuadro de 10 ms sobre -35 dBFS (RMS) dentro de [desde, hasta]."""
    a, b = max(0, int(desde * SR)), min(len(x), int(hasta * SR))
    seg = x[a:b]
    n = SR // 100
    if len(seg) < n:
        return None
    k = len(seg) // n
    rms = np.sqrt(np.mean(seg[: k * n].reshape(k, n) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms)
    hit = np.nonzero(db > -35)[0]
    return None if not len(hit) else desde + hit[0] / 100


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("timeline")
    ap.add_argument("-o", "--salida", default="verificacion-v1.json")
    ap.add_argument("--modelo", default="medium")
    ap.add_argument("--solo-sincronia", action="store_true", help="mide la sincronía sin transcribir")
    a = ap.parse_args(argv)

    tl = json.loads(Path(a.timeline).read_text(encoding="utf8"))
    x = audio(Path(a.video))
    lex = tk.Lexico.cargar(tk.LEXICO_POR_DEFECTO)
    canon = vv.Canon(lex.entradas)
    if not a.solo_sincronia:
        from faster_whisper import WhisperModel

        asr = WhisperModel(a.modelo, device="cpu", compute_type="int8")
    filas, errores, palabras, derivas = [], 0, 0, []
    for c in tl["cues"]:
        ini = c["at"]
        fin = ini + c["dur"]
        tramo = x[int(ini * SR): int(min(len(x) / SR, fin + 0.1) * SR)]
        if a.solo_sincronia:
            hip = c["text"]
        else:
            segs, _ = asr.transcribe(tramo, language="es", beam_size=5, condition_on_previous_text=False, without_timestamps=True)
            hip = " ".join(s.text.strip() for s in segs)
        ref_c, hip_c = canon(c["text"]).split(), canon(hip).split()
        e = vv.distancia(ref_c, hip_c)
        errores += e
        palabras += len(ref_c)
        esperado = ini + (c["speech"][0][0] if c.get("speech") else 0.05)
        # La frase anterior termina al menos GAP (0,18 s) + su cola (0,1 s) antes: se busca desde -0,2 s.
        real = inicio_voz(x, ini - 0.2, ini + 1.5)
        deriva = None if real is None else round(real - esperado, 3)
        if deriva is not None:
            derivas.append(deriva)
        filas.append({"i": c["index"], "at": round(ini, 2), "esperado": c["text"], "transcrito": hip, "wer": round(e / max(1, len(ref_c)), 3), "deriva_s": deriva})
        print(f"{ini:7.2f}  wer {e}/{len(ref_c)}  deriva {deriva}  | {hip[:90]}", flush=True)
    res = {
        "modelo": a.modelo,
        "frases": len(filas),
        "palabras": palabras,
        "errores": errores,
        "wer": round(errores / max(1, palabras), 4),
        "deriva_max_abs_s": round(max((abs(d) for d in derivas), default=0), 3),
        "deriva_media_s": round(float(np.mean(derivas)) if derivas else 0, 3),
        "filas": filas,
    }
    Path(a.salida).write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf8")
    print(f"WER {res['wer'] * 100:.2f} % ({errores}/{palabras}); deriva máx. {res['deriva_max_abs_s']} s, media {res['deriva_media_s']} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
