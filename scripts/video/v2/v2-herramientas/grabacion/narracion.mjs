// Narración del video 2 ("Herramientas de red a fondo"): un WAV por capítulo con Kokoro
// (voz NT_VOICE, ef_dora por defecto) y los tiempos por oración que entrega tts_kokoro.py.
// Las tomas se sincronizan con esos tiempos; los subtítulos salen de los mismos tiempos.
// Uso: node scripts/video/v2/v2-herramientas/grabacion/narracion.mjs
// Resultado: BUILD/voz/<capítulo>.wav (48 kHz mono, -16 LUFS) y BUILD/voz/<capítulo>.json.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generarKokoro, huellaKokoro, usarKokoro } from "../../../kokoro.mjs";

const AQUI = fileURLToPath(new URL(".", import.meta.url));
export const RAIZ = fileURLToPath(new URL("../../../../../", import.meta.url));
export const BUILD = process.env.BUILD ?? join(RAIZ, "videos", ".build-v2-herramientas");
const GUION = join(AQUI, "..", "guion");

/** Capítulos: [{ id, titulo, texto }]. */
export function leerGuion() {
  return readdirSync(GUION)
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .map((f) => {
      const texto = readFileSync(join(GUION, f), "utf8");
      return { id: f.replace(/\.txt$/, ""), titulo: texto.split("\n")[0].replace(/^#\s*/, "").trim(), texto };
    });
}

/** Genera lo que falte y devuelve [{ id, titulo, wav, dur, oraciones: [{ parrafo, oracion, inicio, fin, texto }] }]. */
export function generar() {
  const dir = join(BUILD, "voz");
  mkdirSync(dir, { recursive: true });
  const caps = leerGuion();
  if (!usarKokoro()) throw new Error("Este video usa Kokoro: revisa ~/.venvs/kokoro (scripts/video/README.md)");
  const huella = huellaKokoro();
  const firma = (c) => `${huella}|${c.texto}`;
  const base = (c) => join(dir, c.id);
  const vigente = (c) =>
    existsSync(`${base(c)}.wav`) && existsSync(`${base(c)}.json`) && existsSync(`${base(c)}.txt`) && readFileSync(`${base(c)}.txt`, "utf8") === firma(c);
  const pendientes = caps.filter((c) => !vigente(c));
  if (pendientes.length) {
    const trabajos = pendientes.map((c) => ({ texto: c.texto, salida: `${base(c)}.wav`, tiempos: `${base(c)}.json` }));
    if (!generarKokoro(trabajos, { lote: join(dir, "lote.json"), inicio: 0.05, cola: 0.15 })) throw new Error("Kokoro falló");
    for (const c of pendientes) writeFileSync(`${base(c)}.txt`, firma(c));
  }
  return caps.map((c) => {
    const j = JSON.parse(readFileSync(`${base(c)}.json`, "utf8"));
    return { id: c.id, titulo: c.titulo, wav: `${base(c)}.wav`, dur: j.duracion, oraciones: j.oraciones };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const caps = generar();
  let total = 0;
  for (const c of caps) {
    total += c.dur;
    const bloques = Math.max(...c.oraciones.map((o) => o.parrafo)) + 1;
    console.log(`${c.id.padEnd(32)} ${String(bloques).padStart(2)} bloques ${String(c.oraciones.length).padStart(3)} oraciones ${c.dur.toFixed(1).padStart(6)} s`);
  }
  console.log(`Voz: ${total.toFixed(1)} s (${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")})`);
}
