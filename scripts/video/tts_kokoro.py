#!/usr/bin/env python3
"""Narración con Kokoro TTS (hexgrad/Kokoro-82M, local) para los videos de NetTerminal.

Lee un texto (archivo o stdin), lo divide en párrafos y oraciones, aplica el léxico de
pronunciación (pronunciacion.json), sintetiza cada oración, inserta pausas naturales y
normaliza el volumen a -16 LUFS con ffmpeg loudnorm. Deja un WAV mono (24 kHz por defecto)
y un JSON con el inicio y fin de cada oración, para sincronizar subtítulos y visuales.

Uso:
  ~/.venvs/kokoro/bin/python -I scripts/video/tts_kokoro.py guion.txt -o voz.wav
  echo "Hola." | ~/.venvs/kokoro/bin/python -I scripts/video/tts_kokoro.py - -v ef_dora -s 1.0 -o voz.wav -j voz.json
  ~/.venvs/kokoro/bin/python -I scripts/video/tts_kokoro.py --lote lote.json   (muchos clips, un solo modelo cargado)

Formato de --lote: [{"texto": "...", "salida": "a.wav", "tiempos": "a.json" (opcional)}, ...]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

DIR = Path(__file__).resolve().parent
LEXICO_POR_DEFECTO = DIR / "pronunciacion.json"
SR_KOKORO = 24000
# Cada unidad de duración que predice Kokoro equivale a 600 muestras a 24 kHz (25 ms).
MUESTRAS_POR_UNIDAD = 600

PAUSA_COMA = 0.25
PAUSA_ORACION = 0.45
PAUSA_PARRAFO = 0.70
VOZ_POR_DEFECTO = "ef_dora"
FFMPEG = os.environ.get("FFMPEG") or shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"


# ---------------------------------------------------------------------------
# Léxico y normalización del texto
# ---------------------------------------------------------------------------

LETRA = r"A-Za-z0-9_ÁÉÍÓÚÜÑáéíóúüñ"


@dataclass
class Lexico:
    """Reemplazos de lo escrito por lo dicho. Primero los patrones, luego los términos literales."""

    patrones: list = field(default_factory=list)  # [(regex, reemplazo)]
    literal: re.Pattern | None = None
    mapa: dict = field(default_factory=dict)  # escrito exacto -> dicho
    mapa_ci: dict = field(default_factory=dict)  # escrito en minúsculas -> dicho (sin distinguir mayúsculas)
    entradas: list = field(default_factory=list)

    @classmethod
    def cargar(cls, ruta: Path | str | None) -> "Lexico":
        lx = cls()
        if not ruta:
            return lx
        datos = json.loads(Path(ruta).read_text(encoding="utf8"))
        lx.entradas = datos["entradas"]
        literales = []
        for e in lx.entradas:
            if "patron" in e:
                lx.patrones.append((re.compile(e["patron"]), e["dicho"]))
            elif e.get("mayusculas", True):
                lx.mapa[e["escrito"]] = e["dicho"]
                literales.append((e["escrito"], False))
            else:
                lx.mapa_ci[e["escrito"].lower()] = e["dicho"]
                literales.append((e["escrito"], True))
        # Más largo primero, para que SNMPv3 gane a SNMP y "show ip interface brief" a "show".
        literales.sort(key=lambda x: -len(x[0]))
        partes = [("(?i:%s)" if ci else "%s") % re.escape(t) for t, ci in literales]
        if partes:
            lx.literal = re.compile(rf"(?<![{LETRA}])(?:{'|'.join(partes)})(?![{LETRA}])")
        return lx

    def aplicar(self, texto: str) -> str:
        for rx, rep in self.patrones:
            texto = rx.sub(rep, texto)
        if self.literal:
            def cambio(m: re.Match) -> str:
                t = m.group(0)
                return self.mapa.get(t) or self.mapa_ci.get(t.lower(), t)
            texto = self.literal.sub(cambio, texto)
        return texto


def numero_a_palabras(n: str) -> str:
    try:
        from num2words import num2words
        return num2words(int(n), lang="es")
    except Exception:  # sin num2words se deja el número a espeak
        return n


def normalizar_numeros(texto: str) -> str:
    """Números en palabras, con convenciones de Chile y LatAm: punto de miles y coma decimal."""
    # 1.776 -> 1776 (punto de miles), sin tocar versiones como 0.9.5 ni IPs.
    texto = re.sub(r"(?<![\d.])(\d{1,3})((?:\.\d{3})+)(?![\d.])", lambda m: m.group(1) + m.group(2).replace(".", ""), texto)
    # 2,5 -> dos coma cinco
    texto = re.sub(r"(?<!\d)(\d+),(\d+)(?!\d)", lambda m: f"{numero_a_palabras(m.group(1))} coma {numero_a_palabras(m.group(2))}", texto)
    # Secuencias con puntos (IPs, versiones): 192.0.2.10 -> ciento noventa y dos punto cero ...
    texto = re.sub(r"\d+(?:\.\d+)+", lambda m: " punto ".join("cero" if p == "0" else numero_a_palabras(p) for p in m.group(0).split(".")), texto)
    texto = re.sub(r"\d+", lambda m: numero_a_palabras(m.group(0)), texto)
    return texto


def texto_hablado(texto: str, lexico: Lexico) -> str:
    """Lo que realmente se envía al sintetizador."""
    t = lexico.aplicar(texto)
    t = normalizar_numeros(t)
    # Puntos internos que sobrevivan (archivo.ext) cortarían la oración dentro de Kokoro.
    t = re.sub(rf"(?<=[{LETRA}])\.(?=[{LETRA}])", " punto ", t)
    t = t.replace("/", " ").replace("_", " ").replace("+", " ")
    return re.sub(r"\s+", " ", t).strip()


ABREVIATURAS = ("p. ej.", "etc.", "Sr.", "Sra.", "aprox.", "núm.", "pág.")


def dividir(texto: str) -> list[list[str]]:
    """Párrafos (separados por línea en blanco) con sus oraciones."""
    parrafos = []
    # Las líneas que parten con # son títulos o comentarios y no se leen.
    texto = "\n".join("" if l.lstrip().startswith("#") else l for l in texto.splitlines())
    for p in re.split(r"\n\s*\n", texto.strip()):
        p = re.sub(r"\s+", " ", p).strip()
        if not p:
            continue
        prot = p
        for i, a in enumerate(ABREVIATURAS):
            prot = prot.replace(a, a.replace(".", f"\u0000{i}"))
        oraciones = re.split(r"(?<=[.!?…])\s+(?=[\"'¿¡(A-ZÁÉÍÓÚÑ0-9])", prot)
        oraciones = [re.sub(r"\u0000\d", ".", o).strip() for o in oraciones]
        parrafos.append([o for o in oraciones if o])
    return parrafos


# ---------------------------------------------------------------------------
# Síntesis
# ---------------------------------------------------------------------------


def _rms_cuadros(audio: np.ndarray, sr: int, ms: float = 10.0) -> np.ndarray:
    n = max(1, int(sr * ms / 1000))
    k = len(audio) // n
    if k == 0:
        return np.array([float(np.sqrt(np.mean(audio**2))) if len(audio) else 0.0])
    return np.sqrt(np.mean(audio[: k * n].reshape(k, n) ** 2, axis=1))


def _umbral(audio: np.ndarray, sr: int, db: float = -40.0) -> float:
    rms = _rms_cuadros(audio, sr)
    return float(rms.max()) * 10 ** (db / 20) if rms.size else 0.0


def recortar(audio: np.ndarray, sr: int, margen: float = 0.02) -> np.ndarray:
    """Quita el silencio inicial y final, dejando un margen corto."""
    rms = _rms_cuadros(audio, sr)
    u = _umbral(audio, sr)
    voz = np.nonzero(rms > u)[0]
    if voz.size == 0:
        return audio[:0]
    n = len(audio) // max(1, len(rms))
    ini = max(0, voz[0] * n - int(margen * sr))
    fin = min(len(audio), (voz[-1] + 1) * n + int(margen * sr * 2))
    return audio[ini:fin]


def _fundido(audio: np.ndarray, en: int, sr: int, ms: float = 4.0) -> None:
    """Suaviza un corte en `en` para evitar clics al insertar silencio."""
    n = int(sr * ms / 1000)
    a, b = max(0, en - n), min(len(audio), en + n)
    if en - a > 0:
        audio[a:en] *= np.linspace(1, 0, en - a)
    if b - en > 0:
        audio[en:b] *= np.linspace(0, 1, b - en)


class Sintetizador:
    def __init__(self, g2p: str = "es-419", repo: str = "hexgrad/Kokoro-82M"):
        import warnings
        warnings.filterwarnings("ignore")
        from kokoro import KPipeline
        self.pipe = KPipeline(lang_code="e", repo_id=repo)
        if g2p != "es":
            # Español latinoamericano neutro: seseo (cielo = "sielo", no "θielo").
            from misaki.espeak import EspeakG2P
            self.pipe.g2p = EspeakG2P(language=g2p)
        self.vocab = self.pipe.model.vocab

    def oracion(self, texto: str, voz: str, velocidad: float, pausa_coma: float = PAUSA_COMA, semilla: int | None = 0) -> np.ndarray:
        """Sintetiza una oración e inserta silencio en comas, punto y coma y dos puntos."""
        if semilla is not None:
            # Kokoro tiene una fuente de ruido aleatoria: con semilla fija, el mismo texto da el mismo audio.
            import torch
            torch.manual_seed(semilla)
        partes = []
        for r in self.pipe(texto, voice=voz, speed=velocidad, split_pattern=None):
            if r.audio is None:
                continue
            audio = r.audio.detach().cpu().numpy().astype(np.float32).copy()
            if pausa_coma > 0 and r.pred_dur is not None:
                audio = self._pausas(audio, r.phonemes, r.pred_dur.tolist(), pausa_coma)
            partes.append(audio)
        return np.concatenate(partes) if partes else np.zeros(0, np.float32)

    def _pausas(self, audio: np.ndarray, fonemas: str, dur: list, pausa: float) -> np.ndarray:
        # Solo los caracteres presentes en el vocabulario llegan al modelo (más BOS y EOS).
        validos = [c for c in fonemas if c in self.vocab]
        if len(dur) != len(validos) + 2:
            return audio
        acum = np.cumsum([0] + dur) * MUESTRAS_POR_UNIDAD  # acum[i] = inicio del token i
        rms = _rms_cuadros(audio, SR_KOKORO)
        u = _umbral(audio, SR_KOKORO)
        n = SR_KOKORO // 100
        inserciones = []
        for i, c in enumerate(validos):
            if c not in ",;:" or i == len(validos) - 1:
                continue
            tok = i + 1
            centro = int((acum[tok] + acum[tok + 1]) / 2)
            # Mide el silencio natural alrededor del signo y completa hasta la pausa deseada.
            f = min(len(rms) - 1, centro // n)
            a = b = f
            while a > 0 and rms[a - 1] <= u:
                a -= 1
            while b < len(rms) - 1 and rms[b + 1] <= u:
                b += 1
            natural = (b - a + 1) * n / SR_KOKORO if rms[f] <= u else 0.0
            punto = (a + b + 1) * n // 2 if rms[f] <= u else centro
            extra = pausa - natural
            if extra > 0.02:
                inserciones.append((punto, int(extra * SR_KOKORO)))
        if not inserciones:
            return audio
        trozos, prev = [], 0
        for punto, largo in inserciones:
            punto = min(max(punto, prev), len(audio))
            _fundido(audio, punto, SR_KOKORO)
            trozos += [audio[prev:punto], np.zeros(largo, np.float32)]
            prev = punto
        trozos.append(audio[prev:])
        return np.concatenate(trozos)

    def narrar(self, texto: str, voz: str, velocidad: float, lexico: Lexico, pausas=(PAUSA_COMA, PAUSA_ORACION, PAUSA_PARRAFO),
               inicio: float = 0.15, cola: float = 0.25) -> tuple[np.ndarray, list[dict]]:
        """Texto completo -> (audio a 24 kHz, tiempos por oración)."""
        coma, entre_oraciones, entre_parrafos = pausas
        sr = SR_KOKORO
        trozos = [np.zeros(int(inicio * sr), np.float32)]
        t = inicio
        tiempos = []
        for p, oraciones in enumerate(dividir(texto)):
            for o, original in enumerate(oraciones):
                if tiempos:
                    hueco = entre_parrafos if o == 0 else entre_oraciones
                    trozos.append(np.zeros(int(hueco * sr), np.float32))
                    t += int(hueco * sr) / sr
                dicho = texto_hablado(original, lexico)
                audio = recortar(self.oracion(dicho, voz, velocidad, coma), sr)
                trozos.append(audio)
                tiempos.append({"parrafo": p, "oracion": o, "inicio": round(t, 3), "fin": round(t + len(audio) / sr, 3), "texto": original, "dicho": dicho})
                t += len(audio) / sr
        trozos.append(np.zeros(int(cola * sr), np.float32))
        return np.concatenate(trozos), tiempos


# ---------------------------------------------------------------------------
# Salida: loudnorm a -16 LUFS
# ---------------------------------------------------------------------------


def escribir_wav(ruta: Path, audio: np.ndarray, sr: int) -> None:
    import soundfile as sf
    sf.write(str(ruta), audio, sr, subtype="PCM_16")


def loudnorm(entrada: Path, salida: Path, sr: int, lufs: float = -16.0, tp: float = -1.5, lra: float = 11.0) -> None:
    """Normalización EBU R128 en dos pasadas (lineal). Si la medición falla, una pasada."""
    filtro = f"loudnorm=I={lufs}:TP={tp}:LRA={lra}"
    medida = None
    try:
        r = subprocess.run([FFMPEG, "-hide_banner", "-nostats", "-i", str(entrada), "-af", filtro + ":print_format=json", "-f", "null", "-"],
                           capture_output=True, text=True, check=True)
        m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", r.stderr)
        medida = json.loads(m.group(0)) if m else None
        if medida and not all(np.isfinite(float(medida[k])) for k in ("input_i", "input_tp", "input_lra", "input_thresh")):
            medida = None
    except (subprocess.CalledProcessError, ValueError):
        medida = None
    if medida:
        filtro += (f":measured_I={medida['input_i']}:measured_TP={medida['input_tp']}:measured_LRA={medida['input_lra']}"
                   f":measured_thresh={medida['input_thresh']}:offset={medida['target_offset']}:linear=true")
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", str(entrada), "-af", filtro,
                    "-ar", str(sr), "-ac", "1", "-c:a", "pcm_s16le", str(salida)], check=True)


def guardar(audio: np.ndarray, salida: Path, sr: int, normalizar: bool) -> None:
    salida.parent.mkdir(parents=True, exist_ok=True)
    if not normalizar and sr == SR_KOKORO:
        escribir_wav(salida, audio, sr)
        return
    with tempfile.TemporaryDirectory() as tmp:
        crudo = Path(tmp) / "crudo.wav"
        escribir_wav(crudo, audio, SR_KOKORO)
        if normalizar:
            loudnorm(crudo, salida, sr)
        else:
            subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", str(crudo), "-ar", str(sr), "-ac", "1", "-c:a", "pcm_s16le", str(salida)], check=True)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Narración con Kokoro TTS: WAV mono + tiempos por oración.")
    ap.add_argument("entrada", nargs="?", default="-", help="archivo de texto o - para stdin")
    ap.add_argument("-v", "--voz", default=os.environ.get("NT_VOICE", VOZ_POR_DEFECTO), help="ef_dora, em_alex o em_santa")
    ap.add_argument("-s", "--velocidad", type=float, default=1.0)
    ap.add_argument("-o", "--salida", help="WAV de salida")
    ap.add_argument("-j", "--tiempos", help="JSON de tiempos (por defecto se imprime en stdout)")
    ap.add_argument("--lote", help="JSON con [{texto, salida, tiempos?}] para generar muchos clips cargando el modelo una vez")
    ap.add_argument("--sr", type=int, default=SR_KOKORO, help="frecuencia de salida (24000 por defecto)")
    ap.add_argument("--lexico", default=str(LEXICO_POR_DEFECTO), help="léxico de pronunciación; '' para no usarlo")
    ap.add_argument("--g2p", default="es-419", help="idioma de espeak-ng: es-419 (LatAm, por defecto) o es (España)")
    ap.add_argument("--sin-loudnorm", action="store_true")
    ap.add_argument("--pausas", default=f"{PAUSA_COMA},{PAUSA_ORACION},{PAUSA_PARRAFO}", help="coma,oración,párrafo en segundos")
    ap.add_argument("--inicio", type=float, default=0.15, help="silencio inicial en segundos")
    ap.add_argument("--cola", type=float, default=0.25, help="silencio final en segundos")
    ap.add_argument("--solo-texto", action="store_true", help="solo muestra el texto hablado, sin sintetizar")
    a = ap.parse_args(argv)

    lexico = Lexico.cargar(a.lexico or None)
    pausas = tuple(float(x) for x in a.pausas.split(","))

    if a.lote:
        trabajos = json.loads(Path(a.lote).read_text(encoding="utf8"))
    else:
        if not a.salida and not a.solo_texto:
            ap.error("falta -o/--salida")
        texto = sys.stdin.read() if a.entrada == "-" else Path(a.entrada).read_text(encoding="utf8")
        trabajos = [{"texto": texto, "salida": a.salida, "tiempos": a.tiempos}]

    if a.solo_texto:
        for tr in trabajos:
            for p in dividir(tr["texto"]):
                for o in p:
                    print(texto_hablado(o, lexico))
        return 0

    sint = Sintetizador(g2p=a.g2p)
    for tr in trabajos:
        audio, tiempos = sint.narrar(tr["texto"], a.voz, a.velocidad, lexico, pausas, a.inicio, a.cola)
        guardar(audio, Path(tr["salida"]), a.sr, not a.sin_loudnorm)
        doc = {"motor": "kokoro", "voz": a.voz, "velocidad": a.velocidad, "sr": a.sr, "lufs": None if a.sin_loudnorm else -16,
               "duracion": round(len(audio) / SR_KOKORO, 3), "oraciones": tiempos}
        js = json.dumps(doc, ensure_ascii=False, indent=1)
        if tr.get("tiempos"):
            Path(tr["tiempos"]).write_text(js, encoding="utf8")
        elif not a.lote:
            print(js)
        if a.lote:
            print(f"{tr['salida']}  {doc['duracion']:.2f} s", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
