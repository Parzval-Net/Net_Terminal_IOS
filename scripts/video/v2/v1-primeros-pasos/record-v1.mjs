// Graba las tomas del video 1 (Primeros pasos). Basado en scripts/video/record.mjs, con lo que pide
// el storyboard: láminas y rótulos (REC+1), arrastrar y soltar (REC+2), teclas ArrowRight/ArrowLeft/"."
// (REC+3) y réplicas de tooltips (REC+4). Cada frase del guion se sincroniza con su clip de Kokoro y
// con los tiempos por oración de tts_kokoro.py (subtítulos quemados por oración).
// Requisitos: vite en PORT (1481) sirviendo el repo y la narración ya generada (tts-v1.mjs).
// Uso: node scripts/video/v2/v1-primeros-pasos/record-v1.mjs [prefijo de capítulo ...]
// Variables: REUSE=1 usa un Chrome ya abierto en CDP_PORT (9481); KEEP_FRAMES=1 conserva los cuadros.
// Salida: WORK/shots/<capítulo>-<n>.mp4 (30 fps, 1920x1080) y WORK/log/<capítulo>.json con tiempos.
import { WORK } from "./config.mjs";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, FFMPEG, connect, launchChrome, sleep } from "../../cdp.mjs";
import { makeSteps } from "./steps-v1.mjs";
import { captionChunks } from "./captions-v1.mjs";
import { chapters } from "./storyboard-v1.mjs";

const FPS = 30;
const GAP = 0.18; // silencio entre frases (s)
const CARD = 2.0; // tarjeta de capítulo visible (s)
const FIRST_CUE = 2.3; // primera frase tras la tarjeta (s)
const manifest = JSON.parse(readFileSync(join(WORK, "tts", "manifest.json"), "utf8"));
const overlay = readFileSync(fileURLToPath(new URL("../../overlay.js", import.meta.url)), "utf8");
const overlay1 = readFileSync(fileURLToPath(new URL("./overlay-v1.js", import.meta.url)), "utf8");
const only = process.argv.slice(2);

const chrome = process.env.REUSE ? null : launchChrome();
const c = await connect();
await c.send("Page.addScriptToEvaluateOnNewDocument", { source: overlay });
await c.send("Page.addScriptToEvaluateOnNewDocument", { source: overlay1 });
const pageErrors = [];
c.on("Runtime.exceptionThrown", (p) => {
  const m = p.exceptionDetails?.exception?.description?.split("\n")[0];
  pageErrors.push(m);
  console.error("  error en página:", m);
});

const { runSteps, missing, setFast } = makeSteps(c);
const J = JSON.stringify;

// ---------- Grabación ----------
mkdirSync(join(WORK, "shots"), { recursive: true });
mkdirSync(join(WORK, "log"), { recursive: true });
for (const ch of chapters) {
  if (only.length && !only.some((p) => ch.id.startsWith(p))) continue;
  const m = manifest.find((x) => x.id === ch.id);
  if (!m) throw new Error(`Sin narración para ${ch.id}: ejecuta tts-v1.mjs`);
  const nCues = ch.shots.reduce((a, s) => a + s.cues.length, 0);
  if (nCues !== m.cues.length) throw new Error(`${ch.id}: el guion tiene ${m.cues.length} frases y el storyboard ${nCues}`);
  console.log(`${ch.id}  ${m.title}`);
  const log = { id: ch.id, title: m.title, shots: [] };
  let cueIndex = 0;
  missing.length = 0;
  for (const [si, shot] of ch.shots.entries()) {
    const theme = shot.theme ?? "light";
    await c.send("Page.stopScreencast").catch(() => {});
    await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    await c.send("Page.navigate", { url: `${BASE}?scene=${shot.scene ?? "empty"}&theme=${theme}&video=1${shot.query ?? ""}` });
    await sleep(shot.wait ?? 4200);
    await c.evaluate("window.__v.sanitize()");
    setFast(true);
    await runSteps(shot.setup, Date.now());
    await c.evaluate("window.__v.sanitize(); window.__v.hl(null)");
    const [sx, sy] = shot.cursor ?? [1040, 600];
    await c.evaluate(`window.__v.cursorTo(${sx}, ${sy}, 0)`);
    setFast(false);
    const first = si === 0;
    if (first) await c.evaluate(`window.__v.card(${J(`Capítulo ${Number(ch.id.slice(0, 2))}`)}, ${J(m.title)}, ${J(ch.sub ?? "")})`);
    await sleep(300);

    const dir = resolve(WORK, "frames", `${ch.id}-${si + 1}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const frames = [];
    c.off("Page.screencastFrame");
    c.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
      c.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
      const file = join(dir, `${String(frames.length).padStart(6, "0")}.jpg`);
      writeFileSync(file, Buffer.from(data, "base64"));
      frames.push({ ts: metadata.timestamp, file });
    });
    await c.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
    const t0 = Date.now();
    // Fuerza un primer cuadro aunque la pantalla esté quieta.
    await c.evaluate("window.__v.cursorTo(...window.__v.cursor.map((v) => v + 1), 0)");
    const cues = [];
    let at = first ? FIRST_CUE : 0.3;
    if (first) {
      await sleep(CARD * 1000);
      await c.evaluate("window.__v.card(null)");
    }
    for (const stepsOfCue of shot.cues) {
      const cue = m.cues[cueIndex];
      const planned = at;
      const wait = t0 + at * 1000 - Date.now();
      if (wait > 0) await sleep(wait);
      const start = Date.now();
      const chunks = captionChunks(cue);
      // Al empezar cada frase se limpian resaltado, callouts y rótulos de la anterior (las láminas siguen).
      await c.evaluate(`window.__v.hl(null); window.__v1.clearAll(); window.__v.caption(${J(chunks.map((k) => [Math.round(k.start * 1000), k.text, Math.round(k.end * 1000)]))})`);
      await runSteps(stepsOfCue, start, cue.dur);
      const startRel = (start - t0) / 1000;
      const stepsEnd = (Date.now() - t0) / 1000;
      cues.push({ index: cueIndex, start: startRel, planned, late: startRel - planned, overrun: stepsEnd - (startRel + cue.dur), dur: cue.dur, text: cue.text, file: cue.file, speech: cue.tiempos?.oraciones?.map((o) => [o.inicio, o.fin]) });
      // La siguiente frase parte cuando termina el audio de esta (o cuando terminan sus pasos).
      at = Math.max(startRel + cue.dur + GAP, stepsEnd + 0.1);
      cueIndex++;
    }
    const last = si === ch.shots.length - 1;
    const end = at - GAP + (shot.tail ?? (last ? 0.8 : 0.35));
    const wait = t0 + end * 1000 - Date.now();
    if (wait > 0) await sleep(wait);
    await sleep(150);
    await c.send("Page.stopScreencast");
    await sleep(250);
    c.off("Page.screencastFrame");

    // Cuadros con hora de llegada -> video a 30 fps con la duración exacta de la toma.
    const t0s = t0 / 1000;
    const N = Math.round(end * FPS);
    const dur = N / FPS;
    const list = frames.filter((f) => f.ts < t0s + dur).sort((a, b) => a.ts - b.ts);
    if (!list.length) throw new Error(`${ch.id} toma ${si + 1}: sin cuadros`);
    let txt = "";
    for (let i = 0; i < list.length; i++) {
      const from = i === 0 ? t0s : list[i].ts;
      const to = i + 1 < list.length ? list[i + 1].ts : t0s + dur + 0.1;
      txt += `file '${list[i].file.replaceAll("'", "'\\''")}'\nduration ${Math.max(0.001, to - from).toFixed(4)}\n`;
    }
    txt += `file '${list.at(-1).file.replaceAll("'", "'\\''")}'\n`;
    const listFile = join(dir, "list.txt");
    writeFileSync(listFile, txt);
    const out = join(WORK, "shots", `${ch.id}-${si + 1}.mp4`);
    execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-vf", `scale=1920:1080:flags=lanczos:in_range=pc:out_range=tv,fps=${FPS},format=yuv420p`, "-frames:v", String(N), "-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "18", "-r", String(FPS), "-video_track_timescale", "15360", out]);
    if (!process.env.KEEP_FRAMES) rmSync(dir, { recursive: true, force: true });
    log.shots.push({ file: out, dur, frames: list.length, cues });
    const maxLate = Math.max(...cues.map((x) => x.late));
    console.log(`  toma ${si + 1}: ${dur.toFixed(2)} s, ${list.length} cuadros (${(list.length / dur).toFixed(1)} por s), atraso máx. ${maxLate.toFixed(2)} s`);
  }
  log.missing = [...missing];
  writeFileSync(join(WORK, "log", `${ch.id}.json`), JSON.stringify(log, null, 1));
  if (missing.length) console.warn(`  ${missing.length} selectores no encontrados: ${missing.join(" | ")}`);
}
c.close();
await chrome?.close();
