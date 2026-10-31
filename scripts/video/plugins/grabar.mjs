// Graba y arma el video "NetTerminal: scripts y plugins".
//
// Requisitos: vite sirviendo el repo (`npx vite --port 1462`), Google Chrome, Python 3, ffmpeg y
// la voz Paulina de macOS. Todo corre contra el backend simulado: sin equipos ni red.
//
//   node scripts/video/plugins/grabar.mjs            todo: voz, tomas, audio, subtítulos y MP4
//   node scripts/video/plugins/grabar.mjs toma1 ...  solo esas tomas (para revisar)
//   node scripts/video/plugins/grabar.mjs --armar    solo arma con las tomas ya grabadas
//
// Variables: PORT (vite, 1462), CDP_PORT (9362), BUILD (carpeta de trabajo), OUT (carpeta final).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lanzar, pagina, grabar, sleep } from "./cdp.mjs";
import { datosVideo } from "./datos.mjs";
import { BUILD, FFMPEG, generar } from "./narracion.mjs";
import { TOMAS, NOMBRE } from "./guion.mjs";

const PORT = process.env.PORT ?? 1462;
const CDP_PORT = Number(process.env.CDP_PORT ?? 9362);
const OUT = process.env.OUT ?? fileURLToPath(new URL("../../../videos/", import.meta.url));
const BASE = `http://localhost:${PORT}`;
export const URLS = { app: `${BASE}/scripts/video/plugins/demo.html`, escenario: `${BASE}/scripts/video/plugins/escenario.html` };

// Pausas de la narración (segundos).
const PAUSA_ORACION = 0.3;
const PAUSA_BLOQUE = 0.55;
const ENTRADA = 0.5; // antes de la primera frase de una toma
const SALIDA = 0.5; // después de la última

const args = process.argv.slice(2);
const soloArmar = args.includes("--armar");
const solo = args.filter((a) => !a.startsWith("--"));

// ---------- Línea de tiempo ----------
const { caps } = generar();
const capPorId = Object.fromEntries(caps.map((c) => [c.id, c]));
function planificar(toma) {
  const cap = capPorId[toma.cap];
  const tiempos = {}; // "b" -> [inicio de cada oración]
  const clips = [];
  let t = toma.entrada ?? ENTRADA;
  for (const b of toma.bloques ?? []) {
    tiempos[b] = [];
    cap.bloques[b].forEach((o, i) => {
      tiempos[b][i] = t;
      clips.push({ t, wav: o.wav, dur: o.dur, texto: o.texto });
      t += o.dur + PAUSA_ORACION;
    });
    t += PAUSA_BLOQUE - PAUSA_ORACION;
  }
  const dur = toma.bloques?.length ? t - PAUSA_BLOQUE + (toma.salida ?? SALIDA) + (toma.extra ?? 0) : toma.dur;
  return { tiempos, clips, dur: Math.max(dur, toma.min ?? 0) };
}

// ---------- Grabación ----------
async function grabarTomas(lista) {
  const cdp = await lanzar(CDP_PORT);
  const p = pagina(cdp);
  try {
    await p.datos(await datosVideo());
    let enEscenario = false;
    for (const toma of lista) {
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
        await p.ir(URLS.app);
        enEscenario = false;
      }
      await p.ev(`(window.__hideCursor && window.__hideCursor(${toma.pagina === "escenario"}), 1)`);
      const ctx = contexto(p, plan, toma);
      if (toma.preparar) await toma.preparar(ctx);
      if (toma.pagina === "app" && !toma.continuar) await p.mover([1150, 620], 0);
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
      writeFileSync(join(dir, "toma.json"), JSON.stringify({ id: toma.id, dur, plan: plan.dur, frames: frames.map((f) => ({ file: f.file, t: f.t })) }));
      console.log(`${frames.length} cuadros, ${dur.toFixed(1)} s${dur > plan.dur + 0.05 ? ` (+${(dur - plan.dur).toFixed(2)} s)` : ""}${tarde > 0.25 ? `  ⚠ acciones atrasadas ${tarde.toFixed(2)} s` : ""}`);
    }
  } finally {
    await cdp.close();
  }
}

function contexto(p, plan, toma) {
  const ctx = {
    p,
    sleep,
    /** Llama a window.E.<método>(...args) en el escenario. */
    E: (metodo, ...a) => p.ev(`window.E.${metodo}(...a)`, a),
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
    /** Inicio de la oración (segundos) para calcular velocidades de escritura. */
    tiempo: (b, o = 0) => plan.tiempos[b]?.[o] ?? 0,
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

/** Parte una oración larga en subtítulos de hasta 2 líneas (~46 caracteres c/u). */
function partir(texto, max = 88) {
  if (texto.length <= max) return [texto];
  const n = Math.ceil(texto.length / max);
  const objetivo = texto.length / n;
  const piezas = [];
  let resto = texto;
  while (resto.length > max) {
    // Corte preferido: puntuación cerca del objetivo; si no, un espacio.
    let mejor = -1, puntaje = Infinity;
    for (let i = 20; i < Math.min(resto.length - 15, max); i++) {
      if (resto[i] !== " ") continue;
      const prev = resto[i - 1];
      const castigo = /[,;:]/.test(prev) ? 0 : 26;
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

/** Dos líneas equilibradas para el subtítulo quemado. */
function lineas(texto, max = 50) {
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
      if (d <= 0) return;
      lista.push(`file '${fr.file}'`, `duration ${d.toFixed(4)}`);
    });
    for (const c of plan.clips) {
      audio.push({ t: t + c.t, wav: c.wav });
      const piezas = partir(c.texto);
      const total = piezas.reduce((s, x) => s + x.length, 0);
      let a = t + c.t;
      for (const pz of piezas) {
        const d = (c.dur * pz.length) / total;
        cues.push({ a, b: a + d, texto: pz });
        a += d;
      }
    }
    t += dur;
  }
  const total = t;
  // El último cuadro se repite para que el demuxer respete su duración.
  lista.push(lista.at(-2));
  writeFileSync(join(dir, "cuadros.txt"), lista.join("\n") + "\n");

  // Audio: mezcla en PCM de 48 kHz.
  const RATE = 48000;
  const mix = new Float32Array(Math.ceil(total * RATE) + RATE);
  for (const a of audio) {
    const raw = execFileSync(FFMPEG, ["-v", "error", "-i", a.wav, "-f", "s16le", "-ac", "1", "-ar", String(RATE), "-"], { maxBuffer: 1 << 28 });
    const s = new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2);
    const o = Math.round(a.t * RATE);
    for (let i = 0; i < s.length; i++) mix[o + i] += s[i] / 32768;
  }
  const pcm = Buffer.alloc(Math.ceil(total * RATE) * 2);
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(mix[i] * 0.95 * 32767))), i * 2);
  writeFileSync(join(dir, "voz.raw"), pcm);

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

  // Capítulos.
  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  writeFileSync(join(OUT, `${NOMBRE}-capitulos.txt`), capitulos.map((c) => `${mmss(c.t)} ${c.titulo}`).join("\n") + "\n");

  // Video final: contenido a 1664x936 sobre fondo claro, franja de subtítulos abajo.
  const mp4 = join(OUT, `${NOMBRE}.mp4`);
  execFileSync(
    FFMPEG,
    [
      "-y", "-v", "error", "-stats",
      "-f", "concat", "-safe", "0", "-i", join(dir, "cuadros.txt"),
      "-f", "concat", "-safe", "0", "-i", join(dir, "franjas.txt"),
      "-f", "s16le", "-ar", String(RATE), "-ac", "1", "-i", join(dir, "voz.raw"),
      "-filter_complex",
      [
        "[0:v]fps=30,scale=1664:936:flags=lanczos,format=rgb24,pad=1920:1080:128:12:color=0xe9ecf0,drawbox=x=127:y=11:w=1666:h=938:color=0xd3d8df:t=1[v]",
        "[1:v]fps=30,scale=1920:124,format=rgb24[s]",
        "[v][s]overlay=0:956:shortest=0:eof_action=repeat,scale=out_range=tv:out_color_matrix=bt709,format=yuv420p[out]",
      ].join(";"),
      "-map", "[out]", "-map", "2:a",
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
    await cdp.close();
  }
}

if (!soloArmar) {
  const lista = solo.length ? TOMAS.filter((t) => solo.includes(t.id)) : TOMAS;
  if (solo.length && lista.length !== solo.length) throw new Error(`Tomas desconocidas: ${solo.filter((s) => !TOMAS.some((t) => t.id === s)).join(", ")}`);
  await grabarTomas(lista);
}
if (soloArmar || !solo.length) await armar();
