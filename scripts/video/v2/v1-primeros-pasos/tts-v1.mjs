// Narración del video 1 (Primeros pasos): un clip por línea de guion con Kokoro (voz ef_dora por
// defecto) y el JSON de tiempos por oración que deja tts_kokoro.py.
// Uso: node scripts/video/v2/v1-primeros-pasos/tts-v1.mjs   (variables: NT_VOICE, NT_SPEED, WORK)
// Lee guion/*.txt (primera línea "# Título", luego una frase por línea) y deja WORK/tts/<capítulo>-<n>.wav
// (48 kHz mono, -16 LUFS), <n>.wav.json (tiempos por oración) y WORK/tts/manifest.json.
import { WORK } from "./config.mjs";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FFPROBE } from "../../cdp.mjs";
import { generarKokoro, huellaKokoro, usarKokoro } from "../../kokoro.mjs";

const GUION = fileURLToPath(new URL("./guion/", import.meta.url));

/** Lee los guiones: [{ id, title, lines[] }]. */
export function readScripts() {
  return readdirSync(GUION)
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .map((f) => {
      const [head, ...rest] = readFileSync(join(GUION, f), "utf8").split("\n");
      return { id: f.replace(/\.txt$/, ""), title: head.replace(/^#\s*/, "").trim(), lines: rest.map((l) => l.trim()).filter((l) => l && !l.startsWith("#")) };
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!usarKokoro()) throw new Error("Este video se narra con Kokoro: instala el venv (scripts/video/README.md)");
  const dir = join(WORK, "tts");
  mkdirSync(dir, { recursive: true });
  const huella = huellaKokoro();
  const firma = (text) => `${huella}|${text}`;
  const vigente = (c) => existsSync(c.file) && existsSync(`${c.file}.json`) && existsSync(`${c.file}.txt`) && readFileSync(`${c.file}.txt`, "utf8") === firma(c.text);
  const capitulos = readScripts().map((ch) => {
    for (const t of ch.lines) if (/—/.test(t)) throw new Error(`Guion ${ch.id}: no usar raya larga`);
    return { ch, cues: ch.lines.map((text, i) => ({ text, file: join(dir, `${ch.id}-${String(i + 1).padStart(2, "0")}.wav`) })) };
  });
  const pendientes = capitulos.flatMap((c) => c.cues).filter((c) => !vigente(c));
  if (pendientes.length) {
    console.log(`Kokoro: ${pendientes.length} clips`);
    const ok = generarKokoro(pendientes.map((c) => ({ texto: c.text, salida: c.file, tiempos: `${c.file}.json` })), { lote: join(dir, "lote-kokoro.json") });
    if (!ok) throw new Error("Kokoro falló");
    for (const c of pendientes) writeFileSync(`${c.file}.txt`, firma(c.text));
  }
  const manifest = capitulos.map(({ ch, cues }) => {
    const list = cues.map(({ text, file }) => {
      const dur = Number(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
      const tiempos = JSON.parse(readFileSync(`${file}.json`, "utf8"));
      return { text, file, dur, tiempos };
    });
    console.log(`${ch.id}  ${list.length} frases  ${list.reduce((a, c) => a + c.dur, 0).toFixed(1)} s`);
    return { id: ch.id, title: ch.title, cues: list };
  });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 1));
  const all = manifest.flatMap((c) => c.cues);
  const words = all.reduce((a, c) => a + c.text.split(/\s+/).length, 0);
  const secs = all.reduce((a, c) => a + c.dur, 0);
  console.log(`Total ${secs.toFixed(1)} s de voz, ${words} palabras, ${((words / secs) * 60).toFixed(0)} palabras por minuto`);
}
