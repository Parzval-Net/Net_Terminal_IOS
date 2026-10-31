// Narración del video 3: un clip de Kokoro por párrafo (bloque) de guion/*.txt, con el JSON de
// tiempos por oración que entrega tts_kokoro.py. Las tomas se sincronizan con esos tiempos y los
// subtítulos usan el inicio y el fin de cada oración. Solo se regeneran los clips cuyo texto,
// voz o léxico cambió. Resultado: BUILD/narracion.json.
// Uso: node scripts/video/v2/v3-automatizacion/narracion.mjs   (BUILD, NT_TTS=kokoro, NT_VOICE=ef_dora)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MOTOR, VOZ_KOKORO, generarKokoro, huellaKokoro, usarKokoro } from "../../kokoro.mjs";

export const BUILD = process.env.BUILD ?? join(tmpdir(), "nt-video-v3");
export const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
export const FFPROBE = process.env.FFPROBE ?? "/opt/homebrew/bin/ffprobe";
const GUION = fileURLToPath(new URL("./guion/", import.meta.url));

/** Capítulos: id, título (línea #) y párrafos (texto tal cual, sin el título). */
export function leerGuion() {
  return readdirSync(GUION)
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .map((f) => {
      const raw = readFileSync(join(GUION, f), "utf8").trim();
      const lineas = raw.split("\n");
      const titulo = lineas.find((l) => l.startsWith("#")).replace(/^#\s*/, "");
      const cuerpo = lineas.filter((l) => !l.trimStart().startsWith("#")).join("\n");
      const parrafos = cuerpo.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
      return { id: f.replace(/\.txt$/, ""), titulo, parrafos };
    });
}

export const duracion = (file) => Number(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());

export function generar() {
  if (MOTOR !== "kokoro" || !usarKokoro()) throw new Error("El video 3 se narra con Kokoro (NT_TTS=kokoro y ~/.venvs/kokoro)");
  const dir = join(BUILD, "voz");
  mkdirSync(dir, { recursive: true });
  const caps = leerGuion();
  const huella = huellaKokoro();
  const vigente = (base, texto) =>
    existsSync(`${base}.wav`) && existsSync(`${base}.json`) && existsSync(`${base}.txt`) && readFileSync(`${base}.txt`, "utf8") === `${huella}|${texto}`;
  const pendientes = [];
  for (const c of caps)
    c.parrafos.forEach((texto, b) => {
      const base = join(dir, `${c.id}-${b}`);
      if (!vigente(base, texto)) pendientes.push({ base, texto });
    });
  if (pendientes.length) {
    console.log(`Kokoro (${VOZ_KOKORO}): ${pendientes.length} clips…`);
    const ok = generarKokoro(
      pendientes.map((p) => ({ texto: p.texto, salida: `${p.base}.wav`, tiempos: `${p.base}.json` })),
      { lote: join(dir, "lote-kokoro.json"), inicio: 0.05, cola: 0.1 },
    );
    if (!ok) throw new Error("Kokoro falló: el video 3 no usa la voz del sistema como respaldo");
    for (const p of pendientes) writeFileSync(`${p.base}.txt`, `${huella}|${p.texto}`);
  }
  let palabras = 0;
  for (const c of caps)
    c.bloques = c.parrafos.map((texto, b) => {
      const base = join(dir, `${c.id}-${b}`);
      const t = JSON.parse(readFileSync(`${base}.json`, "utf8"));
      palabras += texto.split(/\s+/).length;
      return { texto, wav: `${base}.wav`, dur: duracion(`${base}.wav`), oraciones: t.oraciones.map((o) => ({ inicio: o.inicio, fin: o.fin, texto: o.texto })) };
    });
  writeFileSync(join(BUILD, "narracion.json"), JSON.stringify(caps, null, 1));
  return { caps, palabras };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { caps, palabras } = generar();
  let total = 0;
  for (const c of caps) {
    const d = c.bloques.reduce((s, b) => s + b.dur, 0);
    total += d;
    console.log(`${c.id.padEnd(22)} ${c.bloques.length} bloques ${c.bloques.map((b) => b.oraciones.length).join("+")} oraciones  ${d.toFixed(1)} s`);
  }
  console.log(`Voz: ${total.toFixed(1)} s (${(total / 60).toFixed(2)} min), ${palabras} palabras`);
}
