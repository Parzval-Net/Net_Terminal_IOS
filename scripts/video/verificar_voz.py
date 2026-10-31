#!/usr/bin/env python3
"""Verificación automática de pronunciación por ida y vuelta TTS -> ASR.

Sintetiza cada oración del corpus (corpus_voz.txt), la transcribe en español con Whisper local
(faster-whisper) y la compara con el texto esperado tras normalizar tildes, mayúsculas, puntuación
y números. Los términos del léxico se llevan a una forma canónica en ambos lados, de modo que
"SNMP", "S.N.M.P." y "ese ene eme pe" cuentan igual. Reporta WER, términos no reconocidos y
proxies de naturalidad (variación de la velocidad de habla, rango de tono, confianza del ASR).

Uso:
  ~/.venvs/kokoro/bin/python -I scripts/video/verificar_voz.py --voces ef_dora --lexico ambos
  ~/.venvs/kokoro/bin/python -I scripts/video/verificar_voz.py --voces ef_dora,em_alex,em_santa,paulina --modelo medium -d /tmp/verif

Voces: ef_dora, em_alex, em_santa (Kokoro) y paulina (macOS `say -v Paulina`, línea base).
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import unicodedata
from pathlib import Path

import numpy as np

DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(DIR))  # con -I la carpeta del script no está en sys.path
sys.dont_write_bytecode = True  # sin __pycache__ en el repositorio

import tts_kokoro as tk  # noqa: E402

LETRAS_SIGLA = re.compile(r"^[A-Z]{2,6}s?$")


# ---------------------------------------------------------------------------
# Normalización y forma canónica de términos
# ---------------------------------------------------------------------------


def sin_tildes(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def basica(s: str) -> str:
    """minúsculas, sin tildes, sin puntuación; miles y porcentaje resueltos."""
    s = re.sub(r"(?<=\d)\.(?=\d{3}\b)", "", s)
    s = s.replace("%", " por ciento ")
    s = sin_tildes(s.lower())
    s = re.sub(r"[^a-z0-9ñ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def numeros(s: str) -> str:
    s = re.sub(r"(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])", " ", s)
    s = re.sub(r"\d+", lambda m: basica(tk.numero_a_palabras(m.group(0))), s)
    return re.sub(r"\s+", " ", s).strip()


class Canon:
    """Lleva variantes de cada término (escrito, dicho, aceptadas) a un mismo token."""

    def __init__(self, entradas: list[dict]):
        padre = list(range(len(entradas)))

        def raiz(i):
            while padre[i] != i:
                padre[i] = padre[padre[i]]
                i = padre[i]
            return i

        variantes: dict[str, int] = {}
        self.variantes_de: list[set] = []
        for i, e in enumerate(entradas):
            vs = {basica(e["escrito"]), basica(re.sub(r"\\g<\d+>", "", e["dicho"]))}
            vs |= {basica(a) for a in e.get("acepta", [])}
            if LETRAS_SIGLA.match(e["escrito"]):
                vs.add(" ".join(e["escrito"].lower()))
            vs.discard("")
            self.variantes_de.append(vs)
            for v in vs:
                if v in variantes:
                    padre[raiz(i)] = raiz(variantes[v])
                else:
                    variantes[v] = i
        # Tokens sin dígitos, para que la conversión de números no los toque.
        self.token = {i: "zt" + "".join(chr(97 + int(d)) for d in str(raiz(i))) + "zz" for i in range(len(entradas))}
        self.mapa = {v: self.token[i] for v, i in variantes.items()}
        orden = sorted(self.mapa, key=lambda v: -len(v))
        self.rx = re.compile(r"(?<![a-z0-9ñ])(?:%s)(?![a-z0-9ñ])" % "|".join(re.escape(v) for v in orden))
        self.entradas = entradas

    def __call__(self, s: str) -> str:
        return numeros(self.rx.sub(lambda m: self.mapa[m.group(0)], basica(s)))

    def terminos(self, texto: str) -> list[int]:
        """Índices de entradas cuyo texto escrito aparece en la oración original."""
        tramos = {}
        for i, e in enumerate(self.entradas):
            if "patron" in e:
                rx = re.compile(e["patron"])
            else:
                rx = re.compile(rf"(?<![{tk.LETRA}]){re.escape(e['escrito'])}(?![{tk.LETRA}])", 0 if e.get("mayusculas", True) else re.I)
            ts = [m.span() for m in rx.finditer(texto)]
            if ts:
                tramos[i] = ts

        # Una aparición dentro de otro término más largo (SNMP dentro de SNMPv3) no cuenta aparte.
        def cubierto(i, t):
            return any(a <= t[0] and t[1] <= b and ((a, b) != t or j < i) for j, ts in tramos.items() if j != i for a, b in ts)

        return [i for i, ts in tramos.items() if not all(cubierto(i, t) for t in ts)]


def distancia(a: list[str], b: list[str]) -> int:
    d = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        prev, d[0] = d[0], i
        for j, y in enumerate(b, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (x != y))
    return d[len(b)]


# ---------------------------------------------------------------------------
# Proxies de naturalidad
# ---------------------------------------------------------------------------


def silabas(texto: str) -> int:
    return len(re.findall(r"[aeiouáéíóúü]+", texto.lower())) or 1


def f0_semitonos(audio: np.ndarray, sr: int) -> float:
    """Desviación estándar del tono (semitonos) en cuadros sonoros; autocorrelación simple."""
    if sr != 16000:
        n = int(len(audio) * 16000 / sr)
        audio = np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio)
        sr = 16000
    win, hop = int(0.04 * sr), int(0.01 * sr)
    lo, hi = int(sr / 400), int(sr / 70)
    umbral = np.sqrt(np.mean(audio**2)) * 0.5
    f0 = []
    for i in range(0, len(audio) - win, hop):
        x = audio[i:i + win] - np.mean(audio[i:i + win])
        if np.sqrt(np.mean(x**2)) < umbral:
            continue
        ac = np.correlate(x, x, "full")[win - 1:]
        if ac[0] <= 0:
            continue
        ac = ac / ac[0]
        k = lo + int(np.argmax(ac[lo:hi]))
        if ac[k] > 0.5:
            f0.append(sr / k)
    if len(f0) < 5:
        return float("nan")
    st = 12 * np.log2(np.array(f0))
    return float(np.std(st))


# ---------------------------------------------------------------------------
# Síntesis por condición
# ---------------------------------------------------------------------------


def audio_16k(ruta: Path) -> np.ndarray:
    """Audio mono a 16 kHz para Whisper (se decodifica con ffmpeg, no con PyAV)."""
    raw = subprocess.run([tk.FFMPEG, "-v", "error", "-i", str(ruta), "-f", "f32le", "-ac", "1", "-ar", "16000", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def sintetizar(voz: str, oraciones: list[str], lexico: tk.Lexico, carpeta: Path, sint, velocidad: float) -> list[Path]:
    carpeta.mkdir(parents=True, exist_ok=True)
    rutas = []
    for i, o in enumerate(oraciones):
        ruta = carpeta / f"{i:03d}.wav"
        if voz == "paulina":
            dicho = tk.texto_hablado(o, lexico) if lexico.entradas else o
            aiff = carpeta / f"{i:03d}.aiff"
            subprocess.run(["say", "-v", "Paulina", "-r", "175", "-o", str(aiff), dicho], check=True)
            subprocess.run([tk.FFMPEG, "-y", "-v", "error", "-i", str(aiff), "-ar", "24000", "-ac", "1", str(ruta)], check=True)
            aiff.unlink()
        else:
            if lexico.entradas:
                audio, _ = sint.narrar(o, voz, velocidad, lexico, inicio=0.1, cola=0.2)
            else:
                # Sin léxico: el texto crudo va directo a Kokoro (solo espeak-ng decide).
                audio = np.concatenate([np.zeros(2400, np.float32), tk.recortar(sint.oracion(o, voz, velocidad), tk.SR_KOKORO), np.zeros(4800, np.float32)])
            tk.escribir_wav(ruta, audio, tk.SR_KOKORO)
        rutas.append(ruta)
    return rutas


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Ida y vuelta TTS -> Whisper para medir la pronunciación.")
    ap.add_argument("--corpus", default=str(DIR / "corpus_voz.txt"))
    ap.add_argument("--voces", default="ef_dora", help="lista separada por comas: ef_dora,em_alex,em_santa,paulina")
    ap.add_argument("--lexico", choices=["con", "sin", "ambos"], default="con")
    ap.add_argument("--modelo", default="medium", help="modelo de Whisper: small o medium")
    ap.add_argument("--velocidad", type=float, default=1.0)
    ap.add_argument("-d", "--dir", default=str(Path.home() / ".cache" / "netterminal-voz" / "verificacion"), help="carpeta de audios y resultados")
    ap.add_argument("--solo", help="índices de oraciones a evaluar, p. ej. 3,7,12")
    a = ap.parse_args(argv)

    oraciones = [l.strip() for l in Path(a.corpus).read_text(encoding="utf8").splitlines() if l.strip() and not l.startswith("#")]
    indices = [int(x) for x in a.solo.split(",")] if a.solo else list(range(len(oraciones)))
    lex_con = tk.Lexico.cargar(tk.LEXICO_POR_DEFECTO)
    canon = Canon(lex_con.entradas)
    cubiertos = {i for o in oraciones for i in canon.terminos(o)}
    sin_cubrir = [e["escrito"] for i, e in enumerate(lex_con.entradas) if i not in cubiertos]
    print(f"Corpus: {len(oraciones)} oraciones; léxico: {len(lex_con.entradas)} entradas; sin cubrir: {sin_cubrir or 'ninguna'}")

    from faster_whisper import WhisperModel
    asr = WhisperModel(a.modelo, device="cpu", compute_type="int8")
    sint = None
    base = Path(a.dir)
    resumen = []
    for voz in a.voces.split(","):
        for modo in (["sin", "con"] if a.lexico == "ambos" else [a.lexico]):
            lexico = lex_con if modo == "con" else tk.Lexico()
            if voz != "paulina" and sint is None:
                sint = tk.Sintetizador()
            carpeta = base / f"{voz}-{modo}"
            t0 = time.time()
            elegidas = [oraciones[i] for i in indices]
            rutas = sintetizar(voz, elegidas, lexico, carpeta, sint, a.velocidad)
            t_tts = time.time() - t0
            errores = palabras = 0
            terminos_ok = terminos_total = 0
            fallos, filas, tasas, tonos, logprobs = [], [], [], [], []
            for i, o, ruta in zip(indices, elegidas, rutas):
                segs, _ = asr.transcribe(audio_16k(ruta), language="es", beam_size=5, condition_on_previous_text=False, without_timestamps=True)
                segs = list(segs)
                hip = " ".join(s.text.strip() for s in segs)
                logprobs += [s.avg_logprob for s in segs]
                ref_c, hip_c = canon(o).split(), canon(hip).split()
                e = distancia(ref_c, hip_c)
                errores += e
                palabras += len(ref_c)
                malos = []
                for t in canon.terminos(o):
                    tok = canon.token[t]
                    terminos_total += 1
                    if hip_c.count(tok) >= ref_c.count(tok):
                        terminos_ok += 1
                    else:
                        malos.append(lex_con.entradas[t]["escrito"])
                import soundfile as sf
                audio, sr = sf.read(str(ruta), dtype="float32")
                voz_util = tk.recortar(audio, sr)
                dur = max(0.2, len(voz_util) / sr)
                tasas.append(silabas(tk.texto_hablado(o, lex_con)) / dur)
                tonos.append(f0_semitonos(voz_util, sr))
                filas.append({"i": i, "esperado": o, "transcrito": hip, "wer": round(e / max(1, len(ref_c)), 3), "terminos_fallidos": malos})
                if malos:
                    fallos.append((i, malos, hip))
            tasas_np = np.array(tasas)
            r = {
                "voz": voz, "lexico": modo, "modelo_asr": a.modelo, "oraciones": len(indices),
                "wer": round(errores / max(1, palabras), 4),
                "terminos_reconocidos": f"{terminos_ok}/{terminos_total}",
                "silabas_por_segundo": round(float(tasas_np.mean()), 2),
                "cv_velocidad": round(float(tasas_np.std() / tasas_np.mean()), 3),
                "tono_desv_semitonos": round(float(np.nanmean(tonos)), 2),
                "asr_logprob_medio": round(float(np.mean(logprobs)), 3),
                "segundos_tts": round(t_tts, 1),
            }
            resumen.append(r)
            (carpeta / "resultado.json").write_text(json.dumps({"resumen": r, "detalle": filas}, ensure_ascii=False, indent=1), encoding="utf8")
            print(f"\n== {voz} / léxico {modo}: WER {r['wer']:.1%}, términos {r['terminos_reconocidos']}, "
                  f"{r['silabas_por_segundo']} síl/s (CV {r['cv_velocidad']}), tono ±{r['tono_desv_semitonos']} st, logprob {r['asr_logprob_medio']}")
            for i, malos, hip in fallos:
                print(f"  [{i}] {', '.join(malos)}  ->  {hip}")
    (base / "resumen.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=1), encoding="utf8")
    print("\nvoz        léxico  WER     términos  síl/s  CV     tono  logprob")
    for r in resumen:
        print(f"{r['voz']:<10}  {r['lexico']:<6}  {r['wer']:<6.1%}  {r['terminos_reconocidos']:<8}  {r['silabas_por_segundo']:<5}  {r['cv_velocidad']:<5}  {r['tono_desv_semitonos']:<4}  {r['asr_logprob_medio']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
