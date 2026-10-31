// Graba y arma el video 2, "Herramientas de red a fondo".
//
// Requisitos: vite sirviendo el repo en PORT (1482), Google Chrome, ffmpeg y Kokoro (ver
// scripts/video/README.md). Todo corre contra el backend simulado: sin equipos ni red.
//
//   node scripts/video/v2/v2-herramientas/grabacion/grabar.mjs              voz, tomas y armado
//   node scripts/video/v2/v2-herramientas/grabacion/grabar.mjs 02 06-b      solo esas tomas (prefijo del id)
//   node scripts/video/v2/v2-herramientas/grabacion/grabar.mjs --armar      solo arma con las tomas grabadas
//
// Sincronía: cada capítulo es un WAV de Kokoro con los tiempos de cada oración (tts_kokoro.py).
// Una toma cubre desde una oración hasta la oración donde parte la toma siguiente; dura
// exactamente ese tramo del audio y sus acciones esperan el inicio de su oración (ctx.at).
// Variables: PORT (vite, 1482), CDP_PORT (Chrome, 9482), BUILD (trabajo), OUT (salida final).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lanzar, pagina, grabar, sleep } from "../../../plugins/cdp.mjs";
import { BUILD, RAIZ, generar } from "./narracion.mjs";
import { TOMAS, NOMBRE } from "./tomas.mjs";
import { capa } from "./capa.mjs";

const PORT = process.env.PORT ?? 1482;
const CDP_PORT = Number(process.env.CDP_PORT ?? 9482);
const OUT = process.env.OUT ?? join(RAIZ, "..", "..", "..", "videos");
const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const BASE = `http://localhost:${PORT}/scripts/video/v2/v2-herramientas`;
export const URLS = { app: `${BASE}/demo.html`, escenario: `${BASE}/escenario.html` };
export const LEAD = 0.6; // antes de la voz de cada capítulo (s)
const TAIL = 0.3; // después de la voz de cada capítulo
const TAIL_FINAL = 1.6;
const FPS = 30;

// ---------- Línea de tiempo ----------
const caps = generar();
const capPorId = Object.fromEntries(caps.map((c) => [c.id, c]));
/** Oración (bloque b, oración o) de un capítulo. */
const oracion = (cap, b, o = 0) => {
  const x = cap.oraciones.find((s) => s.parrafo === b && s.oracion === o);
  if (!x) throw new Error(`${cap.id}: no existe la oración ${b}.${o}`);
  return x;
};
/** Duración de cada capítulo y tramo [inicio, fin) de cada toma, relativos al capítulo. */
export function planificar() {
  const out = [];
  let t = 0;
  for (const cap of caps) {
    const tomas = TOMAS.filter((x) => x.cap === cap.id);
    if (!tomas.length) {
      if (process.argv.includes("--armar")) throw new Error(`Capítulo sin tomas: ${cap.id}`);
      console.warn(`  (capítulo sin tomas: ${cap.id})`);
      continue;
    }
    const dur = LEAD + cap.dur + (cap === caps.at(-1) ? TAIL_FINAL : TAIL);
    const idx = (x) => cap.oraciones.indexOf(oracion(cap, ...(x.desde ?? [0, 0])));
    const inicios = tomas.map((x, i) => {
      if (i === 0) return 0;
      const k = idx(x);
      // Con desplazamiento (tercer valor), el corte cae dentro de la oración.
      if (x.desde.length > 2) return LEAD + cap.oraciones[k].inicio + x.desde[2];
      const prev = cap.oraciones[k - 1];
      return LEAD + (prev.fin + cap.oraciones[k].inicio) / 2;
    });
    tomas.forEach((x, i) => {
      const ini = inicios[i];
      const fin = i + 1 < tomas.length ? inicios[i + 1] : dur;
      out.push({ toma: x, cap, ini, fin, dur: fin - ini, capInicio: t });
    });
    t += dur;
  }
  return { plan: out, total: t };
}

// ---------- Grabación ----------
async function grabarTomas(lista) {
  const cdp = await lanzar(CDP_PORT);
  const p = pagina(cdp);
  capa(p);
  let enEscenario = false;
  try {
    for (const item of lista) {
      const { toma, cap, ini, dur } = item;
      const dir = join(BUILD, "tomas", toma.id);
      rmSync(dir, { recursive: true, force: true });
      process.stdout.write(`toma ${toma.id} (${dur.toFixed(1)} s)… `);
      if (toma.pagina === "escenario") {
        if (!enEscenario) {
          await p.ir(URLS.escenario, "#stage");
          for (let i = 0; i < 50 && !(await p.ev("!!window.E && !!window.D")); i++) await sleep(100);
        }
        enEscenario = true;
      } else {
        const query = new URLSearchParams({ theme: "light", video: "1", ...(toma.query ?? {}) });
        await p.ir(`${URLS.app}?${query}`);
        await sleep(toma.espera ?? 1500);
        enEscenario = false;
      }
      await p.instalarCapa();
      await p.ev(`(window.__hideCursor && window.__hideCursor(${toma.pagina === "escenario"}), 1)`);
      const ctx = contexto(p, item);
      if (toma.preparar) await toma.preparar(ctx).catch((e) => console.log(`  ✕ preparar: ${String(e.message ?? e).split("\n")[0]}`));
      await p.camara(1, undefined, undefined, 0);
      if (toma.pagina !== "escenario") await p.mover(toma.cursor ?? [1150, 640], 0);
      await sleep(350);
      const rec = await grabar(cdp, dir);
      ctx.t0 = performance.now();
      let tarde = 0;
      ctx.tarde = (x) => (tarde = Math.max(tarde, x));
      let fallo = null;
      try {
        await toma.run(ctx);
      } catch (e) {
        fallo = String(e.message ?? e).split("\n")[0];
      }
      const resta = dur * 1000 - (performance.now() - ctx.t0);
      if (resta > 0) await sleep(resta);
      else ctx.tarde(-resta / 1000);
      const frames = await rec.parar();
      writeFileSync(join(dir, "toma.json"), JSON.stringify({ id: toma.id, dur, ini, tarde, frames: frames.map((f) => ({ file: f.file, t: f.t })) }));
      console.log(`${frames.length} cuadros (${(frames.length / dur).toFixed(1)}/s)${tarde > 0.25 ? `  ⚠ acciones atrasadas ${tarde.toFixed(2)} s` : ""}${fallo ? `  ✕ ${fallo}` : ""}`);
    }
  } finally {
    await cdp.close();
  }
}

function contexto(p, item) {
  const { cap, ini } = item;
  const ctx = {
    p,
    sleep,
    E: (metodo, ...a) => p.ev(`window.E.${metodo}(...a)`, a),
    D: (metodo, ...a) => p.ev(`window.D.${metodo}(...a)`, a),
    /** Segundos desde el inicio de la toma hasta el inicio (o el fin) de la oración b.o (+ off). */
    tiempo: (b, o = 0, off = 0, fin = false) => LEAD + (fin ? oracion(cap, b, o).fin : oracion(cap, b, o).inicio) + off - ini,
    async hasta(s) {
      const falta = s * 1000 - (performance.now() - ctx.t0);
      if (falta > 0) await sleep(falta);
      else ctx.tarde?.(-falta / 1000);
    },
    /** Espera el inicio de la oración o del bloque b (+ off segundos). */
    at: (b, o = 0, off = 0) => ctx.hasta(ctx.tiempo(b, o, off)),
    /** Espera el fin de la oración o del bloque b (+ off). */
    fin: (b, o = 0, off = 0) => ctx.hasta(ctx.tiempo(b, o, off, true)),
    dur: item.dur,
  };
  return ctx;
}

// ---------- Armado ----------
const ts = (s) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Parte una oración larga en subtítulos de hasta dos líneas, cortando de preferencia en una pausa. */
export function partir(texto, max = 84) {
  if (texto.length <= max) return [texto];
  const n = Math.ceil(texto.length / max);
  const objetivo = texto.length / n;
  const piezas = [];
  let resto = texto;
  while (resto.length > max) {
    let mejor = -1, puntaje = Infinity;
    for (let i = 20; i < Math.min(resto.length - 12, max); i++) {
      if (resto[i] !== " ") continue;
      const castigo = /[,;:]/.test(resto[i - 1]) ? 0 : 24;
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
export function lineas(texto, max = 44) {
  if (texto.length <= max) return [texto];
  let mejor = -1, d = Infinity;
  for (let i = 0; i < texto.length; i++) if (texto[i] === " " && Math.abs(i - texto.length / 2) < d) (d = Math.abs(i - texto.length / 2)), (mejor = i);
  return [texto.slice(0, mejor), texto.slice(mejor + 1)];
}

/** Cómo se escribe en el subtítulo lo que el guion deja escrito como se dice. */
const texto = (t) => t.replace(/\bpuerto ochenta ochenta\b/g, "puerto 8080");

/** Subtítulos (absolutos) y capítulos a partir de los tiempos por oración. */
export function subtitulos(plan) {
  const cues = [];
  const capitulos = [];
  const vistos = new Set();
  for (const it of plan) {
    if (vistos.has(it.cap.id)) continue;
    vistos.add(it.cap.id);
    const base = it.capInicio + LEAD;
    capitulos.push({ t: it.capInicio, titulo: it.cap.titulo, num: Number(it.cap.id.slice(0, 2)) });
    for (const o of it.cap.oraciones) {
      const piezas = partir(texto(o.texto));
      const total = piezas.reduce((s, x) => s + x.length, 0);
      let a = base + o.inicio;
      const d = o.fin - o.inicio;
      for (const pz of piezas) {
        const b = a + (d * pz.length) / total;
        cues.push({ a, b, texto: pz });
        a = b;
      }
    }
  }
  // Cada subtítulo queda hasta 0,4 s después de su voz, sin pisar el siguiente.
  cues.forEach((c, i) => (c.b = Math.min(c.b + 0.4, cues[i + 1]?.a ?? Infinity)));
  return { cues, capitulos };
}

async function armar() {
  const { plan, total } = planificar();
  mkdirSync(OUT, { recursive: true });
  const dir = join(BUILD, "armado");
  mkdirSync(dir, { recursive: true });
  // Cuadros de todas las tomas con su duración.
  const lista = [];
  let t = 0;
  for (const it of plan) {
    const f = join(BUILD, "tomas", it.toma.id, "toma.json");
    if (!existsSync(f)) throw new Error(`Falta grabar la toma ${it.toma.id}`);
    const { frames } = JSON.parse(readFileSync(f, "utf8"));
    const usados = frames.filter((fr) => fr.t < it.dur);
    usados.forEach((fr, i) => {
      const fin = i + 1 < usados.length ? usados[i + 1].t : it.dur;
      if (fin - fr.t > 0) lista.push(`file '${fr.file}'`, `duration ${(fin - fr.t).toFixed(4)}`);
    });
    t += it.dur;
  }
  lista.push(lista.at(-2));
  writeFileSync(join(dir, "cuadros.txt"), lista.join("\n") + "\n");

  // Audio: cada capítulo en su lugar.
  const RATE = 48000;
  const mix = new Float32Array(Math.ceil(total * RATE) + RATE);
  const ubicados = new Set();
  for (const it of plan) {
    if (ubicados.has(it.cap.id)) continue;
    ubicados.add(it.cap.id);
    const raw = execFileSync(FFMPEG, ["-v", "error", "-i", it.cap.wav, "-f", "s16le", "-ac", "1", "-ar", String(RATE), "-"], { maxBuffer: 1 << 30 });
    const s = new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2);
    const o = Math.round((it.capInicio + LEAD) * RATE);
    for (let i = 0; i < s.length; i++) mix[o + i] += s[i] / 32768;
  }
  const pcm = Buffer.alloc(Math.ceil(total * RATE) * 2);
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(mix[i] * 32767))), i * 2);
  writeFileSync(join(dir, "voz.raw"), pcm);

  // Subtítulos y capítulos.
  const { cues, capitulos } = subtitulos(plan);
  const srt = cues.map((c, i) => `${i + 1}\n${ts(c.a)} --> ${ts(c.b)}\n${lineas(c.texto).join("\n")}\n`).join("\n");
  writeFileSync(join(OUT, `${NOMBRE}.srt`), srt);
  writeFileSync(
    join(OUT, `${NOMBRE}-capitulos.txt`),
    `NetTerminal · Herramientas de red a fondo (${mmss(total)})\n\n` + capitulos.map((c) => `${mmss(c.t)}  ${c.num}. ${c.titulo}`).join("\n") + "\n",
  );
  const meta =
    ";FFMETADATA1\ntitle=NetTerminal: Herramientas de red a fondo\nlanguage=spa\n\n" +
    capitulos.map((c, i) => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(c.t * 1000)}\nEND=${Math.round((capitulos[i + 1]?.t ?? total) * 1000)}\ntitle=${c.num}. ${c.titulo}\n`).join("\n");
  writeFileSync(join(dir, "capitulos.ffmeta"), meta);

  // Capa superpuesta (subtítulo y tarjeta de capítulo), PNG transparentes de 1920x1080.
  const capas = await renderCapas(cues, capitulos, total, join(dir, "capas"));
  writeFileSync(join(dir, "capas.txt"), capas.join("\n") + "\n");

  // Normalización a -16 LUFS en dos pasadas (lineal).
  const med = JSON.parse(
    execFileSync("/bin/sh", ["-c", `"${FFMPEG}" -hide_banner -nostats -f s16le -ar ${RATE} -ac 1 -i "${join(dir, "voz.raw")}" -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p'`]).toString(),
  );
  const ln = `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${med.input_i}:measured_TP=${med.input_tp}:measured_LRA=${med.input_lra}:measured_thresh=${med.input_thresh}:offset=${med.target_offset}:linear=true`;

  const mp4 = join(OUT, `${NOMBRE}.mp4`);
  execFileSync(
    FFMPEG,
    [
      "-y", "-v", "error",
      "-f", "concat", "-safe", "0", "-i", join(dir, "cuadros.txt"),
      "-f", "concat", "-safe", "0", "-i", join(dir, "capas.txt"),
      "-f", "s16le", "-ar", String(RATE), "-ac", "1", "-i", join(dir, "voz.raw"),
      "-i", join(dir, "capitulos.ffmeta"),
      "-filter_complex",
      [
        `[0:v]fps=${FPS},scale=1920:1080:flags=lanczos,format=rgba[v]`,
        `[1:v]fps=${FPS},format=rgba[c]`,
        `[v][c]overlay=0:0:shortest=0:eof_action=repeat:format=auto,scale=out_range=tv:out_color_matrix=bt709,format=yuv420p[out]`,
        `[2:a]${ln},aresample=48000,aformat=channel_layouts=stereo[a]`,
      ].join(";"),
      "-map", "[out]", "-map", "[a]", "-map_metadata", "3", "-map_chapters", "3",
      "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-profile:v", "high", "-level", "4.1", "-r", String(FPS), "-pix_fmt", "yuv420p",
      "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
      "-metadata:s:a:0", "language=spa", "-metadata:s:v:0", "language=spa",
      "-t", total.toFixed(3), "-movflags", "+faststart",
      mp4,
    ],
    { stdio: "inherit" },
  );
  const oraciones = [];
  for (const it of plan) if (!oraciones.some((o) => o.cap === it.cap.id)) for (const o of it.cap.oraciones) oraciones.push({ cap: it.cap.id, a: it.capInicio + LEAD + o.inicio, b: it.capInicio + LEAD + o.fin, texto: o.texto });
  const tardes = plan.map((x) => ({ id: x.toma.id, tarde: JSON.parse(readFileSync(join(BUILD, "tomas", x.toma.id, "toma.json"), "utf8")).tarde ?? 0 }));
  writeFileSync(
    join(BUILD, "plan.json"),
    JSON.stringify({ total, LEAD, capitulos, tomas: plan.map((x) => ({ id: x.toma.id, cap: x.cap.id, inicio: x.capInicio + x.ini, dur: x.dur })), tardes, oraciones, cues }, null, 1),
  );
  console.log(`\n${mp4}\nDuración: ${total.toFixed(2)} s (${mmss(total)})`);
  for (const c of capitulos) console.log(`  ${mmss(c.t)} ${c.num}. ${c.titulo}`);
}

/** Estados de la capa (subtítulo y tarjeta de capítulo) como PNG transparentes, con su duración. */
async function renderCapas(cues, capitulos, total, dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const TARJETA = [0.25, 3.6]; // visible desde/hasta (s) desde el inicio del capítulo
  const cortes = new Set([0, total]);
  for (const c of cues) cortes.add(c.a), cortes.add(c.b);
  for (const k of capitulos) cortes.add(k.t + TARJETA[0]), cortes.add(k.t + TARJETA[1]);
  const ts = [...cortes].filter((x) => x >= 0 && x <= total).sort((a, b) => a - b);
  const estado = (t) => {
    const cue = cues.find((c) => c.a <= t && t < c.b);
    const cap = capitulos.find((k) => k.t + TARJETA[0] <= t && t < k.t + TARJETA[1]);
    return { sub: cue ? lineas(cue.texto) : null, cap: cap ? { num: cap.num, titulo: cap.titulo } : null };
  };
  const cdp = await lanzar(CDP_PORT);
  const p = pagina(cdp);
  const archivos = new Map();
  const lista = [];
  try {
    await p.ir(URLS.escenario, "#stage");
    await cdp.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    await p.ev(`(() => {
      document.documentElement.style.background = "transparent";
      document.body.style.background = "transparent";
      document.body.innerHTML = '<div id="cap"></div><div id="sub"></div>';
      document.getElementById("__cursor")?.remove();
      const st = document.createElement("style");
      st.textContent = \`
        #sub { position: absolute; left: 50%; bottom: 30px; transform: translateX(-50%); max-width: 1060px; padding: 9px 22px 11px; border-radius: 12px;
          background: rgba(17, 22, 32, 0.84); color: #fff; font: 500 24px/1.36 system-ui, -apple-system, sans-serif; text-align: center; letter-spacing: .004em; white-space: nowrap; }
        #sub:empty { display: none; }
        #cap { position: absolute; right: 30px; top: 26px; display: flex; align-items: stretch; background: rgba(255,255,255,.97); border-radius: 16px;
          box-shadow: 0 14px 40px rgba(15,23,42,.22), 0 0 0 1px rgba(15,23,42,.06); overflow: hidden; font-family: system-ui, -apple-system, sans-serif; }
        #cap:empty { display: none; }
        #cap .barra { flex: 0 0 7px; align-self: stretch; background: #1d5be0; }
        #cap .txt { padding: 14px 26px 16px 20px; }
        #cap .k { color: #1d5be0; font-weight: 700; font-size: 15px; letter-spacing: .12em; text-transform: uppercase; }
        #cap .t { color: #141821; font-weight: 700; font-size: 30px; letter-spacing: -.01em; margin-top: 2px; }\`;
      document.head.appendChild(st);
    })()`);
    const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
    for (let i = 0; i + 1 < ts.length; i++) {
      const d = ts[i + 1] - ts[i];
      if (d < 0.001) continue;
      const e = estado((ts[i] + ts[i + 1]) / 2);
      const clave = JSON.stringify(e);
      if (!archivos.has(clave)) {
        const f = join(dir, `c${String(archivos.size).padStart(4, "0")}.png`);
        await p.ev(
          `(() => { document.getElementById("sub").innerHTML = a.sub; document.getElementById("cap").innerHTML = a.cap; })()`,
          {
            sub: e.sub ? e.sub.map(esc).join("<br>") : "",
            cap: e.cap ? `<div class="barra"></div><div class="txt"><div class="k">Capítulo ${e.cap.num}</div><div class="t">${esc(e.cap.titulo)}</div></div>` : "",
          },
        );
        const r = await cdp.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(f, Buffer.from(r.data, "base64"));
        archivos.set(clave, f);
      }
      lista.push(`file '${archivos.get(clave)}'`, `duration ${d.toFixed(4)}`);
    }
    lista.push(lista.at(-2));
  } finally {
    await cdp.close();
  }
  return lista;
}

// ---------- Principal ----------
const args = process.argv.slice(2);
const soloArmar = args.includes("--armar");
const solo = args.filter((a) => !a.startsWith("--"));
if (process.argv[1]?.endsWith("grabar.mjs")) {
  const { plan, total } = planificar();
  console.log(`Plan: ${plan.length} tomas, ${total.toFixed(1)} s (${mmss(total)})`);
  if (!soloArmar) {
    const lista = solo.length ? plan.filter((x) => solo.some((s) => x.toma.id.startsWith(s))) : plan;
    if (!lista.length) throw new Error(`Sin tomas para: ${solo.join(", ")}`);
    await grabarTomas(lista);
  }
  if (soloArmar || !solo.length) await armar();
}
