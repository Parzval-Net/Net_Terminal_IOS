#!/usr/bin/env python3
"""Verificación del MP4 final del video 2 ("Herramientas de red a fondo").

1. Formato: 1920x1080, H.264 High, 30 fps, yuv420p, AAC 48 kHz, capítulos, duración (13 a 15 min).
2. Volumen integrado (EBU R128) del audio final.
3. Sincronía A/V: el inicio de cada oración en el audio final contra los tiempos de tts_kokoro.py
   (plan.json de grabar.mjs). Reporta la deriva máxima.
4. Pantallas negras (blackdetect) y video congelado (freezedetect).
5. Transcripción del audio final con Whisper (faster-whisper) por oración y WER contra el guion,
   con la misma normalización de términos que verificar_voz.py.
6. Cuadros cada 30 s y al inicio de cada capítulo (hojas de contacto en BUILD/verificacion).

Uso:
  ~/.venvs/kokoro/bin/python -I scripts/video/v2/v2-herramientas/grabacion/verificar_video.py VIDEO.mp4 BUILD/plan.json [--modelo medium]
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

AQUI = Path(__file__).resolve().parent
VIDEO_DIR = AQUI.parents[2]  # scripts/video
sys.path.insert(0, str(VIDEO_DIR))
sys.dont_write_bytecode = True

import tts_kokoro as tk  # noqa: E402
import verificar_voz as vv  # noqa: E402

FFMPEG = tk.FFMPEG
FFPROBE = str(Path(FFMPEG).with_name("ffprobe"))


def sh(args: list[str]) -> str:
    r = subprocess.run(args, capture_output=True, text=True)
    return r.stdout + r.stderr


def formato(mp4: Path) -> dict:
    j = json.loads(subprocess.run([FFPROBE, "-v", "error", "-show_streams", "-show_format", "-show_chapters", "-of", "json", str(mp4)], capture_output=True, text=True, check=True).stdout)
    v = next(s for s in j["streams"] if s["codec_type"] == "video")
    a = next(s for s in j["streams"] if s["codec_type"] == "audio")
    return {
        "duracion": float(j["format"]["duration"]),
        "video": f"{v['codec_name']} {v.get('profile')} {v['width']}x{v['height']} {v['pix_fmt']} {v['r_frame_rate']}",
        "audio": f"{a['codec_name']} {a['sample_rate']} Hz {a['channels']} canales",
        "capitulos": [(round(float(c["start_time"]), 2), c["tags"].get("title", "")) for c in j.get("chapters", [])],
    }


def volumen(mp4: Path) -> dict:
    out = sh([FFMPEG, "-hide_banner", "-nostats", "-i", str(mp4), "-map", "0:a", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"])
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", out)
    d = json.loads(m.group(0))
    return {"LUFS": float(d["input_i"]), "true_peak": float(d["input_tp"]), "LRA": float(d["input_lra"])}


def detectar(mp4: Path) -> dict:
    out = sh([FFMPEG, "-hide_banner", "-nostats", "-i", str(mp4), "-map", "0:v", "-vf", "blackdetect=d=0.5:pix_th=0.10,freezedetect=n=0.001:d=8", "-an", "-f", "null", "-"])
    negros = re.findall(r"black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)", out)
    cong = re.findall(r"freeze_start: ([\d.]+).*?freeze_duration: ([\d.]+)", out, re.S)
    return {"negros": [(float(a), float(c)) for a, _, c in negros], "congelados": [(float(a), float(d)) for a, d in cong]}


def audio(mp4: Path, sr: int) -> np.ndarray:
    raw = subprocess.run([FFMPEG, "-v", "error", "-i", str(mp4), "-map", "0:a", "-f", "f32le", "-ac", "1", "-ar", str(sr), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def deriva(a: np.ndarray, sr: int, oraciones: list[dict]) -> dict:
    """Inicio de voz medido (envolvente de 5 ms) contra el inicio esperado de cada oración."""
    hop = sr // 200
    n = len(a) // hop
    env = np.sqrt(np.mean(a[: n * hop].reshape(n, hop) ** 2, axis=1))
    umbral = float(np.percentile(env, 99)) * 10 ** (-32 / 20)
    res = []
    for o in oraciones:
        esp = o["a"]
        i0, i1 = int((esp - 0.35) * 200), int((esp + 0.35) * 200)
        seg = env[max(0, i0): max(0, i1)]
        hit = np.nonzero(seg > umbral)[0]
        if hit.size:
            res.append(((max(0, i0) + hit[0]) / 200 - esp, o["texto"][:50]))
    d = [abs(x) for x, _ in res]
    peor = max(res, key=lambda x: abs(x[0])) if res else (None, "")
    return {"medidas": len(res), "de": len(oraciones), "max_ms": round(max(d) * 1000, 1) if d else None, "media_ms": round(float(np.mean(d)) * 1000, 1) if d else None, "peor": peor}


def wer(a16: np.ndarray, oraciones: list[dict], modelo: str) -> dict:
    from faster_whisper import WhisperModel

    lex = json.loads((VIDEO_DIR / "pronunciacion.json").read_text(encoding="utf8"))["entradas"]
    canon = vv.Canon(lex)
    asr = WhisperModel(modelo, device="cpu", compute_type="int8")
    errores = palabras = 0
    filas = []
    for o in oraciones:
        seg = a16[int(max(0, o["a"] - 0.15) * 16000): int((o["b"] + 0.25) * 16000)]
        partes, _ = asr.transcribe(seg, language="es", beam_size=5, condition_on_previous_text=False, without_timestamps=True)
        oido = " ".join(p.text for p in partes).strip()
        ref, hip = canon(o["texto"]).split(), canon(oido).split()
        e = vv.distancia(ref, hip)
        errores += e
        palabras += len(ref)
        filas.append({"texto": o["texto"], "oido": oido, "wer": round(e / max(1, len(ref)), 3)})
    return {"wer": round(errores / max(1, palabras), 4), "palabras": palabras, "errores": errores, "oraciones": filas}


def cuadros(mp4: Path, tiempos: list[float], carpeta: Path, nombre: str) -> Path:
    carpeta.mkdir(parents=True, exist_ok=True)
    args = []
    for t in tiempos:
        args += ["-ss", f"{t:.2f}", "-i", str(mp4)]
    n = len(tiempos)
    cols = 4
    filtro = ";".join(f"[{i}:v]trim=end_frame=1,scale=480:270,setpts=PTS-STARTPTS[v{i}]" for i in range(n))
    filtro += ";" + "".join(f"[v{i}]" for i in range(n)) + f"xstack=inputs={n}:layout=" + "|".join(f"{(i % cols) * 480}_{(i // cols) * 270}" for i in range(n)) + ":fill=black"
    out = carpeta / nombre
    subprocess.run([FFMPEG, "-v", "error", "-y", *args, "-filter_complex", filtro, "-frames:v", "1", str(out)], check=True)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("mp4")
    ap.add_argument("plan")
    ap.add_argument("--modelo", default="medium")
    ap.add_argument("--sin-wer", action="store_true")
    a = ap.parse_args()
    mp4, plan = Path(a.mp4), json.loads(Path(a.plan).read_text(encoding="utf8"))
    dest = Path(a.plan).parent / "verificacion"
    rep = {"formato": formato(mp4), "volumen": volumen(mp4), "deteccion": detectar(mp4)}
    a48 = audio(mp4, 48000)
    rep["sincronia"] = deriva(a48, 48000, plan["oraciones"])
    dur = rep["formato"]["duracion"]
    t30 = [t for t in np.arange(0.5, dur, 30.0)]
    hojas = []
    for k in range(0, len(t30), 16):
        hojas.append(str(cuadros(mp4, t30[k: k + 16], dest, f"cada30-{k // 16 + 1}.png")))
    hojas.append(str(cuadros(mp4, [c["t"] + 1.2 for c in plan["capitulos"]], dest, "capitulos.png")))
    rep["hojas"] = hojas
    if not a.sin_wer:
        rep["transcripcion"] = wer(audio(mp4, 16000), plan["oraciones"], a.modelo)
    (dest / "reporte.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf8")
    resumen = {k: v for k, v in rep.items() if k != "transcripcion"}
    if "transcripcion" in rep:
        t = rep["transcripcion"]
        resumen["WER"] = t["wer"]
        resumen["peores"] = sorted(t["oraciones"], key=lambda x: -x["wer"])[:8]
    print(json.dumps(resumen, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
