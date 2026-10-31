// Graba y arma el video 3 "Automatización: scripts, plugins y programación".
//
// Requisitos: vite con la configuración de esta carpeta (puerto 1483), Google Chrome (CDP en el
// puerto 9483), Python 3, ffmpeg y Kokoro en ~/.venvs/kokoro. Todo corre contra el backend
// simulado: sin equipos ni red.
//
//   node scripts/video/v2/v3-automatizacion/grabar.mjs            voz, tomas, audio, subtítulos y MP4
//   node scripts/video/v2/v3-automatizacion/grabar.mjs toma1 ...  solo esas tomas (para revisar)
//   node scripts/video/v2/v3-automatizacion/grabar.mjs --armar    solo arma con las tomas ya grabadas
//
// Variables: PORT (1483), CDP_PORT (9483), BUILD (carpeta de trabajo), OUT (carpeta final).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lanzar, pagina, grabar, sleep } from "./cdp-v3.mjs";
import { datosVideo } from "./datos.mjs";
import { BUILD, FFMPEG, generar } from "./narracion.mjs";
import { TOMAS, NOMBRE, fijarCsv } from "./guion.mjs";
import { PAUSAS } from "./grabar-plan.mjs";

const PORT = process.env.PORT ?? 1483;
const CDP_PORT = Number(process.env.CDP_PORT ?? 9483);
const OUT = process.env.OUT ?? fileURLToPath(new URL("../../../../videos/", import.meta.url));
const BASE = `http://localhost:${PORT}/scripts/video/v2/v3-automatizacion`;
export const URLS = { app: `${BASE}/demo.html`, escenario: `${BASE}/escenario.html` };

// Pausas (segundos). Dentro de un bloque las da tts_kokoro.py (coma, oración).
const { BLOQUE: PAUSA_BLOQUE, ENTRADA, SALIDA } = PAUSAS;

const args = process.argv.slice(2);
const soloArmar = args.includes("--armar");
const solo = args.filter((a) => !a.startsWith("--"));

// ---------- Línea de tiempo ----------
const { caps } = generar();
const capPorId = Object.fromEntries(caps.map((c) => [c.id, c]));
/** Inicio de cada oración (tiempos de tts_kokoro.py) y clips de voz de una toma. */
export function planificar(toma) {
  const cap = capPorId[toma.cap];
  const tiempos = {}; // bloque -> [inicio de cada oración]
  const clips = [];
  const oraciones = [];
  let t = toma.entrada ?? ENTRADA;
  for (const b of toma.bloques ?? []) {
    const bl = cap.bloques[b];
    if (!bl) throw new Error(`${toma.id}: el capítulo ${toma.cap} no tiene el bloque ${b}`);
    tiempos[b] = bl.oraciones.map((o) => t + o.inicio);
    clips.push({ t, wav: bl.wav, dur: bl.dur });
    for (const o of bl.oraciones) oraciones.push({ a: t + o.inicio, b: t + o.fin, texto: o.texto });
    t += bl.dur + PAUSA_BLOQUE;
  }
  const dur = toma.bloques?.length ? t - PAUSA_BLOQUE + (toma.salida ?? SALIDA) + (toma.extra ?? 0) : toma.dur;
  return { tiempos, clips, oraciones, dur: Math.max(dur, toma.min ?? 0) };
}

// ---------- Grabación ----------
async function grabarTomas(lista) {
  const cdp = await lanzar(CDP_PORT);
  const p = pagina(cdp);
  const informe = [];
  try {
    const datos = await datosVideo();
    fijarCsv(datos.csv);
    await p.datos(datos);
    let enEscenario = false;
    for (let k = 0, intento = 0; k < lista.length; k++) {
      const toma = lista[k];
      const plan = planificar(toma);
      const dir = join(BUILD, "tomas", toma.id);
      rmSync(dir, { recursive: true, force: true });
      process.stdout.write(`toma ${toma.id} (${plan.dur.toFixed(1)} s)… `);
      // Preparación (no se graba).
      if (toma.pagina === "escenario") {
        if (!enEscenario) {
          await p.ir(URLS.escenario, "#stage");
          for (let i = 0; i < 50 && !(await p.ev("!!window.E")); i++) await sleep(100);
        }
        enEscenario = true;
      } else if (!toma.continuar) {
        await p.ir(URLS.app + (toma.query ?? ""));
        enEscenario = false;
      }
      await p.ev(`(window.__hideCursor && window.__hideCursor(${toma.pagina === "escenario" && !toma.cursor}), 1)`);
      const ctx = contexto(p, plan, toma);
      if (toma.preparar) await toma.preparar(ctx);
      if (toma.pagina === "app" && !toma.continuar && !toma.sinMover) await p.mover([1150, 620], 0);
      await sleep(300);
      const rec = await grabar(cdp, dir);
      const t0 = performance.now();
      ctx.t0 = t0;
      let tarde = 0;
      ctx.tarde = (x) => (tarde = Math.max(tarde, x));
      await toma.run(ctx);
      const resta = plan.dur * 1000 - (performance.now() - t0);
      if (resta > 0) await sleep(resta);
      const frames = await rec.parar();
      const real = (performance.now() - t0) / 1000;
      const dur = Math.max(plan.dur, real);
      writeFileSync(join(dir, "toma.json"), JSON.stringify({ id: toma.id, dur, plan: plan.dur, tarde, frames: frames.map((f) => ({ file: f.file, t: f.t })) }));
      const fps = frames.length / dur;
      console.log(`${frames.length} cuadros (${fps.toFixed(1)} fps), ${dur.toFixed(1)} s${dur > plan.dur + 0.05 ? ` (+${(dur - plan.dur).toFixed(2)} s)` : ""}${tarde > 0.25 ? `  ⚠ acciones atrasadas ${tarde.toFixed(2)} s` : ""}`);
      // Una toma que se trabó (equipo sobrecargado: pocos cuadros o mucho más larga que lo
      // planificado) se repite si no depende de la anterior ni la siguiente depende de ella.
      const suelta = !toma.continuar && !lista[k + 1]?.continuar;
      if ((fps < 6 || dur > plan.dur + 3) && suelta && intento < 2) {
        console.log(`  ↻ se repite ${toma.id}`);
        intento++;
        enEscenario = false;
        k--;
        continue;
      }
      intento = 0;
      informe.push({ id: toma.id, dur, plan: plan.dur, tarde, fps });
    }
  } finally {
    await cdp.close().catch((e) => console.error("  (cierre de Chrome)", e.code ?? e.message));
  }
  return informe;
}

function contexto(p, plan, toma) {
  const ctx = {
    p,
    sleep,
    /** Llama a window.E.<método>(...args) en el escenario. */
    E: (metodo, ...a) => p.ev(`window.E.${metodo}(...a)`, a),
    /** Lo mismo sobre la lámina que cubre la app (iframe del escenario). */
    L: (metodo, ...a) => p.ev(`window.__v3.laminaE().${metodo}(...a)`, a),
    /** Carga (sin mostrar), muestra u oculta la lámina sobre la app. */
    async lamina(on) {
      for (let i = 0; i < 60 && !(await p.ev(`window.__v3.lamina(${on === undefined ? "" : on})`)); i++) await sleep(100);
      if (on !== undefined) await p.ev(`(window.__hideCursor && window.__hideCursor(${!!on}), 1)`);
    },
    /** Espera al inicio de la oración `o` del bloque `b` (+ desplazamiento en segundos). */
    async at(b, o = 0, off = 0) {
      const t = (plan.tiempos[b]?.[o] ?? 0) + off;
      const falta = t * 1000 - (performance.now() - ctx.t0);
      if (falta > 0) await sleep(falta);
      else ctx.tarde?.(-falta / 1000);
    },
    /** Espera hasta `s` segundos desde el inicio de la toma. */
    async en(s) {
      const falta = s * 1000 - (performance.now() - ctx.t0);
      if (falta > 0) await sleep(falta);
      else ctx.tarde?.(-falta / 1000);
    },
    /** Inicio de la oración (segundos desde el inicio de la toma). */
    tiempo: (b, o = 0) => plan.tiempos[b]?.[o] ?? 0,
    /** Segundos que quedan desde ahora hasta la oración (b, o) + off. */
    hasta: (b, o = 0, off = 0) => (plan.tiempos[b]?.[o] ?? plan.dur) + off - (performance.now() - ctx.t0) / 1000,
    ahora: () => (performance.now() - ctx.t0) / 1000,
    dur: plan.dur,
    toma,
  };
  return ctx;
}

// ---------- Armado ----------
const ts = (s) => {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Parte una oración larga en subtítulos de hasta 2 líneas (~44 caracteres c/u). */
function partir(texto, max = 86) {
  if (texto.length <= max) return [texto];
  const n = Math.ceil(texto.length / max);
  const objetivo = texto.length / n;
  const piezas = [];
  let resto = texto;
  while (resto.length > max) {
    let mejor = -1, puntaje = Infinity;
    for (let i = 20; i < Math.min(resto.length - 15, max); i++) {
      if (resto[i] !== " ") continue;
      const castigo = /[,;:]/.test(resto[i - 1]) ? 0 : 26;
      const s = Math.abs(i - objetivo) + castigo;
      if (s < puntaje) (puntaje = s), (mejor = i);
    }
    if (mejor < 0) break;
    piezas.push(resto.slice(0, mejor).trim());
    resto = resto.slice(mejor + 1);
  }
  piezas.push(resto.trim());
  return piezas;
}

/** Dos líneas equilibradas. */
function lineas(texto, max = 46) {
  if (texto.length <= max) return [texto];
  let mejor = -1, d = Infinity;
  for (let i = 0; i < texto.length; i++) if (texto[i] === " " && Math.abs(i - texto.length / 2) < d) (d = Math.abs(i - texto.length / 2)), (mejor = i);
  return [texto.slice(0, mejor), texto.slice(mejor + 1)];
}

async function armar() {
  mkdirSync(OUT, { recursive: true });
  const dir = join(BUILD, "armado");
  mkdirSync(dir, { recursive: true });
  let t = 0;
  const lista = [];
  const audio = [];
  const cues = [];
  const oraciones = [];
  const capitulos = [];
  for (const toma of TOMAS) {
    const f = join(BUILD, "tomas", toma.id, "toma.json");
    if (!existsSync(f)) throw new Error(`Falta grabar la toma ${toma.id}`);
    const { dur, frames } = JSON.parse(readFileSync(f, "utf8"));
    const plan = planificar(toma);
    if (toma.capitulo) capitulos.push({ t, titulo: toma.capitulo });
    frames.forEach((fr, i) => {
      const fin = i + 1 < frames.length ? Math.min(frames[i + 1].t, dur) : dur;
      const d = fin - fr.t;
      if (d > 0) lista.push(`file '${fr.file}'`, `duration ${d.toFixed(4)}`);
    });
    for (const c of plan.clips) audio.push({ t: t + c.t, wav: c.wav });
    for (const o of plan.oraciones) {
      oraciones.push({ a: t + o.a, b: t + o.b, texto: o.texto, toma: toma.id });
      const piezas = partir(o.texto);
      const total = piezas.reduce((s, x) => s + x.length, 0);
      let a = t + o.a;
      for (const pz of piezas) {
        const d = ((o.b - o.a) * pz.length) / total;
        cues.push({ a, b: a + d, texto: pz });
        a += d;
      }
    }
    t += dur;
  }
  const total = t;
  lista.push(lista.at(-2));
  writeFileSync(join(dir, "cuadros.txt"), lista.join("\n") + "\n");
  writeFileSync(join(dir, "oraciones.json"), JSON.stringify(oraciones, null, 1));

  // Audio: mezcla en PCM de 48 kHz (los clips ya vienen a -16 LUFS de tts_kokoro.py).
  const RATE = 48000;
  const mix = new Float32Array(Math.ceil(total * RATE) + RATE);
  for (const a of audio) {
    const raw = execFileSync(FFMPEG, ["-v", "error", "-i", a.wav, "-f", "s16le", "-ac", "1", "-ar", String(RATE), "-"], { maxBuffer: 1 << 28 });
    const s = new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2);
    const o = Math.round(a.t * RATE);
    for (let i = 0; i < s.length; i++) mix[o + i] += s[i] / 32768;
  }
  const pcm = Buffer.alloc(Math.ceil(total * RATE) * 2);
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(mix[i] * 32767))), i * 2);
  writeFileSync(join(dir, "voz.raw"), pcm);
  // Normalización EBU R128 de la pista completa a -16 LUFS (dos pasadas, lineal).
  const medir = spawnSync(FFMPEG, ["-hide_banner", "-nostats", "-f", "s16le", "-ar", String(RATE), "-ac", "1", "-i", join(dir, "voz.raw"), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const m = JSON.parse(medir.match(/\{[^{}]*"input_i"[^{}]*\}/)[0]);
  const filtroAudio = `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`;

  // Subtítulos: .srt y franjas PNG para quemarlos.
  const srt = cues.map((c, i) => `${i + 1}\n${ts(c.a)} --> ${ts(Math.min(c.b + 0.15, cues[i + 1]?.a ?? Infinity))}\n${lineas(c.texto).join("\n")}\n`).join("\n");
  const srtPath = join(OUT, `${NOMBRE}.srt`);
  writeFileSync(srtPath, srt);
  const franjas = await renderFranjas(cues, join(dir, "franjas"));
  const listaSub = [];
  let cur = 0;
  cues.forEach((c, i) => {
    const fin = Math.min(c.b + 0.15, cues[i + 1]?.a ?? total);
    if (c.a > cur + 0.001) listaSub.push(`file '${franjas.vacia}'`, `duration ${(c.a - cur).toFixed(4)}`);
    listaSub.push(`file '${franjas.cues[i]}'`, `duration ${(fin - c.a).toFixed(4)}`);
    cur = fin;
  });
  listaSub.push(`file '${franjas.vacia}'`, `duration ${Math.max(0.05, total - cur).toFixed(4)}`, `file '${franjas.vacia}'`);
  writeFileSync(join(dir, "franjas.txt"), listaSub.join("\n") + "\n");

  // Capítulos: texto y metadatos del MP4.
  writeFileSync(join(OUT, `${NOMBRE}-capitulos.txt`), capitulos.map((c) => `${mmss(c.t)} ${c.titulo}`).join("\n") + "\n");
  const meta = [";FFMETADATA1", `title=NetTerminal · Automatización: scripts, plugins y programación`, "artist=NetTerminal", "language=spa", ""];
  capitulos.forEach((c, i) => {
    const fin = capitulos[i + 1]?.t ?? total;
    meta.push("[CHAPTER]", "TIMEBASE=1/1000", `START=${Math.round(c.t * 1000)}`, `END=${Math.round(fin * 1000)}`, `title=${c.titulo}`, "");
  });
  writeFileSync(join(dir, "capitulos.ffmeta"), meta.join("\n"));

  // Video final: contenido a 1664x936 sobre fondo claro y franja de subtítulos abajo.
  const mp4 = join(OUT, `${NOMBRE}.mp4`);
  execFileSync(
    FFMPEG,
    [
      "-y", "-v", "error", "-stats",
      "-f", "concat", "-safe", "0", "-i", join(dir, "cuadros.txt"),
      "-f", "concat", "-safe", "0", "-i", join(dir, "franjas.txt"),
      "-f", "s16le", "-ar", String(RATE), "-ac", "1", "-i", join(dir, "voz.raw"),
      "-i", join(dir, "capitulos.ffmeta"),
      "-filter_complex",
      [
        "[0:v]fps=30,scale=1664:936:flags=lanczos,format=rgb24,pad=1920:1080:128:12:color=0xe9ecf0,drawbox=x=127:y=11:w=1666:h=938:color=0xd3d8df:t=1[v]",
        "[1:v]fps=30,scale=1920:124,format=rgb24[s]",
        "[v][s]overlay=0:956:shortest=0:eof_action=repeat,scale=out_range=tv:out_color_matrix=bt709,format=yuv420p[out]",
        `[2:a]${filtroAudio}[a]`,
      ].join(";"),
      "-map", "[out]", "-map", "[a]", "-map_metadata", "3", "-map_chapters", "3",
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high", "-r", "30", "-pix_fmt", "yuv420p",
      "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
      "-t", total.toFixed(3), "-movflags", "+faststart",
      mp4,
    ],
    { stdio: "inherit" },
  );
  console.log(`\n${mp4}\nDuración: ${total.toFixed(1)} s (${mmss(total)})\n${srtPath}\n${join(OUT, `${NOMBRE}-capitulos.txt`)}`);
  for (const c of capitulos) console.log(`  ${mmss(c.t)} ${c.titulo}`);
}

/** Franjas de 1920x124 con el texto del subtítulo (Chrome, misma tipografía del escenario). */
async function renderFranjas(cues, dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cdp = await lanzar(CDP_PORT);
  const p = pagina(cdp);
  try {
    await p.ir(URLS.escenario, "#stage");
    await p.ev(`(() => {
      document.body.innerHTML = '<div id="f" style="position:absolute;left:0;top:0;width:1440px;height:93px;background:#e9ecf0;display:flex;align-items:center;justify-content:center;text-align:center;font:500 25px/1.3 system-ui,-apple-system,sans-serif;color:#15181d;letter-spacing:0.005em;padding:0 120px"></div>';
      document.getElementById("__cursor")?.remove();
    })()`);
    const shot = async (file, texto) => {
      await p.ev(`document.getElementById("f").innerHTML = a`, texto);
      const r = await cdp.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1440, height: 93, scale: 1 } });
      writeFileSync(file, Buffer.from(r.data, "base64"));
    };
    const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
    const vacia = join(dir, "vacia.png");
    await shot(vacia, "");
    const out = [];
    for (const [i, c] of cues.entries()) {
      const f = join(dir, `c${String(i).padStart(4, "0")}.png`);
      await shot(f, lineas(c.texto).map(esc).join("<br>"));
      out.push(f);
    }
    return { vacia, cues: out };
  } finally {
    await cdp.close().catch((e) => console.error("  (cierre de Chrome)", e.code ?? e.message));
  }
}

if (!soloArmar) {
  // Una toma que continúa la anterior necesita grabar también las previas de su cadena.
  const pedidas = new Set(TOMAS.filter((t) => solo.includes(t.id) || solo.some((s) => s.endsWith("*") && t.id.startsWith(s.slice(0, -1)))).map((t) => t.id));
  for (let i = TOMAS.length - 1; i > 0; i--) if (pedidas.has(TOMAS[i].id) && TOMAS[i].continuar) pedidas.add(TOMAS[i - 1].id);
  const lista = solo.length ? TOMAS.filter((t) => pedidas.has(t.id)) : TOMAS;
  if (!lista.length) throw new Error(`Tomas desconocidas: ${solo.join(", ")}`);
  const informe = await grabarTomas(lista);
  if (!solo.length) writeFileSync(join(BUILD, "informe-tomas.json"), JSON.stringify(informe, null, 1));
}
if (soloArmar || !solo.length) await armar();
