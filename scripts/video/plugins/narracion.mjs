// Narración: lee guion/*.txt (un párrafo = un bloque), separa oraciones, genera la voz y mide cada
// clip. Motor por defecto: Kokoro local (ver ../kokoro.mjs); respaldo: `say -v Paulina -r 175` (es_MX).
// Resultado: BUILD/narracion.json.
// Uso: node scripts/video/plugins/narracion.mjs   (BUILD, NT_TTS=kokoro|say, NT_VOICE, NT_SPEED; VOZ y PPM para say)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generarKokoro, huellaKokoro, usarKokoro } from "../kokoro.mjs";

export const BUILD = process.env.BUILD ?? join(tmpdir(), "nt-video-plugins");
const GUION = fileURLToPath(new URL("./guion/", import.meta.url));
export const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
export const FFPROBE = process.env.FFPROBE ?? "/opt/homebrew/bin/ffprobe";
const VOZ = process.env.VOZ ?? "Paulina";
const PPM = process.env.PPM ?? "175";

/** Cómo se dice en voz alta lo que en pantalla y subtítulos va escrito tal cual. */
const PRONUNCIA = [
  [/import netterminal as nt/g, "import net terminal as ene te"],
  [/netterminal-commands/g, "net terminal commands"],
  [/NetTerminal/g, "Net Terminal"],
  [/\bnetterminal\b/g, "net terminal"],
  [/plugin\.json/g, "plugin punto yéison"],
  [/main\.py/g, "méin punto pai"],
  [/\.py\b/g, "punto pai"],
  [/\.zip\b/g, "punto zip"],
  [/\.pth\b/g, "punto pe te hache"],
  [/\bJSON\b/g, "yéison"],
  [/NT_ACTION/g, "ene te, guion bajo, áction"],
  [/wait_for/g, "wait for"],
  [/UTF-8/g, "u te efe ocho"],
  [/SHA-256/g, "sha doscientos cincuenta y seis"],
  [/20 MB/g, "20 megabytes"],
  [/docs\/ejemplos/g, "docs, ejemplos"],
  [/\bREADME\b/g, "ridmi"],
  [/\bMCP\b/g, "eme ce pe"],
  [/\bIA\b/g, "i a"],
  [/\bIPs\b/g, "i pes"],
  [/show version; reload/g, "show version, punto y coma, reload"],
  [/\bid\b/g, "i de"],
  [/\bAPI\b/g, "a pe i"],
  [/Python 3/g, "Python tres"],
];
export const voz = (t) => PRONUNCIA.reduce((s, [re, r]) => s.replace(re, r), t);

/** Capítulos con sus bloques y oraciones. */
export function leerGuion() {
  return readdirSync(GUION)
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .map((f) => {
      const raw = readFileSync(join(GUION, f), "utf8").trim();
      const [head, ...rest] = raw.split("\n");
      const bloques = rest
        .join("\n")
        .split(/\n\s*\n/)
        .map((p) => p.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .map((p) => p.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/));
      return { id: f.replace(/\.txt$/, ""), titulo: head.replace(/^#\s*/, ""), bloques };
    });
}

export function duracion(file) {
  return Number(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
}

export function generar() {
  const dir = join(BUILD, "voz");
  mkdirSync(dir, { recursive: true });
  const caps = leerGuion();
  let kokoro = usarKokoro();
  const huella = kokoro ? huellaKokoro() : "";
  // Firma del clip: si cambia el texto, el motor, la voz o el léxico, se regenera.
  const firma = (texto, k = kokoro) => (k ? `${huella}|${texto}` : voz(texto));
  const vigente = (base, texto) => existsSync(`${base}.wav`) && existsSync(`${base}.txt`) && readFileSync(`${base}.txt`, "utf8") === firma(texto);
  const pendientes = [];
  for (const c of caps)
    c.bloques.forEach((oraciones, b) =>
      oraciones.forEach((texto, o) => {
        const base = join(dir, `${c.id}-${b}-${o}`);
        if (!vigente(base, texto)) pendientes.push({ base, texto });
      }),
    );
  // Kokoro genera todos los clips pendientes en un solo lote; Kokoro aplica su propio léxico.
  if (kokoro && pendientes.length) {
    const ok = generarKokoro(pendientes.map((p) => ({ texto: p.texto, salida: `${p.base}.wav`, tiempos: `${p.base}.json` })), { lote: join(dir, "lote-kokoro.json") });
    if (ok) for (const p of pendientes) writeFileSync(`${p.base}.txt`, firma(p.texto));
    else kokoro = false;
  }
  let palabras = 0;
  for (const c of caps)
    c.bloques = c.bloques.map((oraciones, b) =>
      oraciones.map((texto, o) => {
        palabras += texto.split(/\s+/).length;
        const base = join(dir, `${c.id}-${b}-${o}`);
        if (!vigente(base, texto)) {
          // Respaldo: voz del sistema de macOS.
          execFileSync("say", ["-v", VOZ, "-r", PPM, "-o", `${base}.aiff`, voz(texto)]);
          execFileSync(FFMPEG, ["-y", "-v", "error", "-i", `${base}.aiff`, "-ar", "48000", "-ac", "1", `${base}.wav`]);
          writeFileSync(`${base}.txt`, firma(texto, false));
        }
        return { texto, wav: `${base}.wav`, dur: duracion(`${base}.wav`) };
      }),
    );
  writeFileSync(join(BUILD, "narracion.json"), JSON.stringify(caps, null, 2));
  return { caps, palabras };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { caps, palabras } = generar();
  let total = 0;
  for (const c of caps) {
    const d = c.bloques.flat().reduce((s, o) => s + o.dur, 0);
    total += d;
    console.log(`${c.id.padEnd(26)} ${c.bloques.length} bloques  ${d.toFixed(1)} s`);
  }
  console.log(`Voz: ${total.toFixed(1)} s (${(total / 60).toFixed(2)} min), ${palabras} palabras`);
}
